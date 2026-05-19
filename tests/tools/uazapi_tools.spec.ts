import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../src/agent/tools/_registry.js';
import { createEnviarCatalogo } from '../../src/agent/tools/enviar_catalogo.js';
import { createEnvioPix } from '../../src/agent/tools/envio_pix.js';
import { createNotificarTime } from '../../src/agent/tools/notificar_time.js';
import { createTransferirHumano } from '../../src/agent/tools/transferir_humano.js';
import { createValidarComprovante } from '../../src/agent/tools/validar_comprovante.js';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({});
const ctx: ToolContext = {
	telefone: '5571999999999',
	lead: { nome: 'Maria', etiquetas: [], sinal_pago: false },
};

describe('enviar_catalogo', () => {
	it('sends PDF and marks as sent', async () => {
		const uazapi = { sendMedia: vi.fn().mockResolvedValue(undefined) };
		const supabase = { downloadFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) };
		const leadManager = {
			getLead: vi.fn().mockResolvedValue(null),
			wasCatalogoSentRecently: vi.fn().mockReturnValue(false),
			markPdfCatalogoEnviado: vi.fn().mockResolvedValue(undefined),
		};

		const tool = createEnviarCatalogo({
			uazapi: uazapi as never,
			supabase: supabase as never,
			leadManager: leadManager as never,
		});
		const r = await tool.handler({ telefone: '5571999' }, ctx);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') expect(r.ja_enviado).toBe(false);
		expect(uazapi.sendMedia).toHaveBeenCalled();
	});

	it('returns ja_enviado if sent recently', async () => {
		const leadManager = {
			getLead: vi.fn().mockResolvedValue({ pdf_catalogo_enviado_em: new Date().toISOString() }),
			wasCatalogoSentRecently: vi.fn().mockReturnValue(true),
			markPdfCatalogoEnviado: vi.fn(),
		};

		const tool = createEnviarCatalogo({
			uazapi: {} as never,
			supabase: {} as never,
			leadManager: leadManager as never,
		});
		const r = await tool.handler({ telefone: '5571999' }, ctx);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') expect(r.ja_enviado).toBe(true);
	});
});

describe('envio_pix', () => {
	it('sends PIX button with correct key', async () => {
		const uazapi = { sendPixButton: vi.fn().mockResolvedValue(undefined) };
		const tool = createEnvioPix({ uazapi: uazapi as never });
		const r = await tool.handler({ telefone: '5571999', valor: 48 }, ctx);
		expect(r.status).toBe('ok');
		expect(uazapi.sendPixButton).toHaveBeenCalledWith(
			expect.objectContaining({
				pixKey: 'bf673a9f-8117-49c0-ad9e-82e318f665b1',
				pixName: 'CAMILA SILVA DO ROSARIO',
			}),
		);
	});
});

describe('notificar_time', () => {
	it('sends formatted message to group', async () => {
		const uazapi = { sendText: vi.fn().mockResolvedValue(undefined) };
		const tool = createNotificarTime({ uazapi: uazapi as never });
		const r = await tool.handler(
			{ motivo: 'Encaixe', contexto: 'Cliente quer VB', urgencia: 'alta' },
			ctx,
		);
		expect(r.status).toBe('ok');
		expect(uazapi.sendText).toHaveBeenCalled();
		const text = uazapi.sendText.mock.calls[0]?.[1] as string;
		expect(text).toContain('🔴');
		expect(text).toContain('Encaixe');
	});
});

describe('transferir_humano', () => {
	it('disables IA + notifies team + sends message to client', async () => {
		const uazapi = { sendText: vi.fn().mockResolvedValue(undefined) };
		const leadManager = { setIaAtiva: vi.fn().mockResolvedValue(undefined) };
		const tool = createTransferirHumano({
			uazapi: uazapi as never,
			leadManager: leadManager as never,
		});
		const r = await tool.handler({ telefone: '5571999', motivo: 'Desconto' }, ctx);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') expect(r.ia_ativa).toBe(false);
		expect(leadManager.setIaAtiva).toHaveBeenCalledWith('5571999', false);
		// Should have sent 2 messages: team notification + client message
		expect(uazapi.sendText).toHaveBeenCalledTimes(2);
	});
});

describe('validar_comprovante', () => {
	it('validates correct comprovante', async () => {
		const uazapi = { fetchMedia: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) };
		const openai = {
			analyzeImage: vi.fn().mockResolvedValue({
				text: JSON.stringify({
					valor: 48.0,
					destinatario: 'CAMILA SILVA DO ROSARIO',
					chave_pix: 'bf673a9f-8117-49c0-ad9e-82e318f665b1',
					status: 'Concluído',
				}),
			}),
		};

		const tool = createValidarComprovante({ openai: openai as never, uazapi: uazapi as never });
		const r = await tool.handler({ imagem_url: 'https://cdn/img.jpg', valor_esperado: 48 }, ctx);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') {
			expect(r.valido).toBe(true);
		}
	});

	it('rejects wrong destinatário', async () => {
		const uazapi = { fetchMedia: vi.fn().mockResolvedValue(new Uint8Array([1])) };
		const openai = {
			analyzeImage: vi.fn().mockResolvedValue({
				text: JSON.stringify({
					valor: 48,
					destinatario: 'OUTRA PESSOA',
					chave_pix: 'xxx',
					status: 'Concluído',
				}),
			}),
		};

		const tool = createValidarComprovante({ openai: openai as never, uazapi: uazapi as never });
		const r = await tool.handler({ imagem_url: 'https://cdn/img.jpg', valor_esperado: 48 }, ctx);
		if (r.status === 'ok') {
			expect(r.valido).toBe(false);
			expect((r.problemas as string[])?.[0]).toContain('Destinatário');
		}
	});

	it('rejects wrong valor beyond tolerance', async () => {
		const uazapi = { fetchMedia: vi.fn().mockResolvedValue(new Uint8Array([1])) };
		const openai = {
			analyzeImage: vi.fn().mockResolvedValue({
				text: JSON.stringify({
					valor: 100,
					destinatario: 'CAMILA SILVA DO ROSARIO',
					chave_pix: 'xxx',
					status: 'Concluído',
				}),
			}),
		};

		const tool = createValidarComprovante({ openai: openai as never, uazapi: uazapi as never });
		const r = await tool.handler({ imagem_url: 'https://cdn/img.jpg', valor_esperado: 48 }, ctx);
		if (r.status === 'ok') {
			expect(r.valido).toBe(false);
		}
	});
});
