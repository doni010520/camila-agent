import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../src/agent/tools/_registry.js';
import { createEnviarPdfCurso } from '../../src/agent/tools/enviar_pdf_curso.js';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({});
const ctx: ToolContext = {
	telefone: '5571999',
	lead: { nome: 'Maria', etiquetas: [], sinal_pago: false },
};

function makeDeps(overrides?: { pdfEnviadoEm?: string | null; downloadFails?: boolean }) {
	const uazapi = { sendMedia: vi.fn().mockResolvedValue(undefined) };
	const supabase = {
		downloadFile: overrides?.downloadFails
			? vi.fn().mockRejectedValue(new Error('not found'))
			: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
	};
	const leadManager = {
		getLead: vi
			.fn()
			.mockResolvedValue(
				overrides?.pdfEnviadoEm !== undefined
					? { pdf_curso_enviado_em: overrides.pdfEnviadoEm }
					: null,
			),
		markPdfCursoEnviado: vi.fn().mockResolvedValue(undefined),
	};
	return {
		tool: createEnviarPdfCurso({
			uazapi: uazapi as never,
			supabase: supabase as never,
			leadManager: leadManager as never,
		}),
		uazapi,
		supabase,
		leadManager,
	};
}

describe('enviar_pdf_curso', () => {
	it('sends all 5 documents and marks as sent', async () => {
		const { tool, uazapi, leadManager } = makeDeps();
		const r = await tool.handler({ telefone: '5571999' }, ctx);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') {
			expect(r.ja_enviado).toBe(false);
			expect(r.total_enviados).toBe(5);
			expect(r.total_esperado).toBe(5);
		}
		expect(uazapi.sendMedia).toHaveBeenCalledTimes(5);
		expect(leadManager.markPdfCursoEnviado).toHaveBeenCalled();
	});

	it('returns ja_enviado if sent within 6h', async () => {
		const { tool, uazapi } = makeDeps({ pdfEnviadoEm: new Date().toISOString() });
		const r = await tool.handler({ telefone: '5571999' }, ctx);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') expect(r.ja_enviado).toBe(true);
		expect(uazapi.sendMedia).not.toHaveBeenCalled();
	});

	it('resends if last send was >6h ago', async () => {
		const oldDate = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
		const { tool, uazapi } = makeDeps({ pdfEnviadoEm: oldDate });
		const r = await tool.handler({ telefone: '5571999' }, ctx);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') expect(r.ja_enviado).toBe(false);
		expect(uazapi.sendMedia).toHaveBeenCalled();
	});

	it('continues sending remaining files if one download fails', async () => {
		const uazapi = { sendMedia: vi.fn().mockResolvedValue(undefined) };
		let callCount = 0;
		const supabase = {
			downloadFile: vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 2) throw new Error('download failed');
				return new Uint8Array([1, 2, 3]);
			}),
		};
		const leadManager = { getLead: vi.fn().mockResolvedValue(null), markPdfCursoEnviado: vi.fn() };

		const tool = createEnviarPdfCurso({
			uazapi: uazapi as never,
			supabase: supabase as never,
			leadManager: leadManager as never,
		});
		const r = await tool.handler({ telefone: '5571999' }, ctx);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') {
			expect(r.total_enviados).toBe(4); // 5 - 1 failed
		}
	});
});
