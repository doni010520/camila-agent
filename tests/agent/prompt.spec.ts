import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const promptPath = resolve(import.meta.dirname, '../../src/agent/prompt.md');
const prompt = readFileSync(promptPath, 'utf-8');

describe('Helena prompt v14', () => {
	it('is under 14k characters (enxuto)', () => {
		// Teto pra manter o prompt enxuto (foco + custo de tokens). Subiu de 12k
		// pra 14k após regras críticas de produção (anti-alucinação de serviço,
		// saudação, serviço obrigatório antes de consultar, não expor VIP).
		// ~14k chars ≈ 3,5k tokens de system prompt — folgado pro gpt-4.1-mini.
		expect(prompt.length).toBeLessThan(14000);
	});

	it('does NOT reference ghost tool names (SPEC §10)', () => {
		const ghostTools = ['editar_agendamento', 'avisa_camila', 'transferir_para_camila'];
		for (const ghost of ghostTools) {
			expect(prompt).not.toContain(ghost);
		}
	});

	it('references all 13 real tools', () => {
		const realTools = [
			'consultar_disponibilidade',
			'criar_agendamento',
			'cancelar_agendamento',
			'reagendar_agendamento',
			'listar_agendamentos',
			'enviar_catalogo',
			'enviar_pdf_curso',
			'envio_pix',
			'validar_comprovante',
			'atualizar_sinal',
			'marcar_falta',
			'notificar_time',
			'transferir_humano',
		];
		for (const tool of realTools) {
			expect(prompt).toContain(tool);
		}
	});

	it('contains anti-ghost rule', () => {
		expect(prompt.toLowerCase()).toContain('anti-fantasma');
		expect(prompt).toContain('status: "ok"');
		expect(prompt).toContain('status: "erro"');
	});

	it('contains all template variables', () => {
		const vars = [
			'{{data_atual}}',
			'{{cliente_nome}}',
			'{{lead_etiquetas}}',
			'{{sinal_pago}}',
			'{{pdf_catalogo_enviado_h}}',
			'{{horario_expediente}}',
			'{{historico_cliente}}',
		];
		for (const v of vars) {
			expect(prompt).toContain(v);
		}
	});

	it('does NOT reference leads_energia_solar (SPEC §17)', () => {
		expect(prompt).not.toContain('leads_energia_solar');
		expect(prompt).not.toContain('levesol');
	});
});
