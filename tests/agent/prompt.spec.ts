import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const promptPath = resolve(import.meta.dirname, '../../src/agent/prompt.md');
const prompt = readFileSync(promptPath, 'utf-8');

describe('Helena prompt v15', () => {
	it('is under 18k characters (enxuto)', () => {
		// Teto pra manter o prompt enxuto (foco + custo de tokens). Cresceu com
		// regras de produção (anti-alucinação, VIP, recesso, serviços da Camila,
		// captura de nome não-pessoal). ~15k chars ≈ 3,7k tokens — folgado pro
		// gpt-4.1-mini. Subiu de 16k -> 18k em 28/08/2026 pra caber a seção
		// "Horário que a cliente pediu" (hora_minima/hora_maxima + proibição de
		// inventar que a vaga foi ocupada). O teto existe pra segurar bloat: se
		// for subir de novo, corte algo antes.
		expect(prompt.length).toBeLessThan(18000);
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
			'{{cliente_vip}}',
			'{{sinal_pago}}',
			'{{pdf_catalogo_enviado_h}}',
			'{{horario_expediente}}',
			'{{recesso_info}}',
			'{{catalogo_precos}}',
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

// Regressão 28/08/2026 — a Helena não sabia pedir "após as 17h" e inventava
// que a vaga tinha sido ocupada quando a tool devolvia menos opções.
describe('prompt: horário pedido pela cliente', () => {
	it('ensina a usar hora_minima/hora_maxima', () => {
		expect(prompt).toContain('hora_minima');
		expect(prompt).toContain('hora_maxima');
	});

	it('proíbe afirmar que a vaga foi ocupada com base em lista mais curta', () => {
		expect(prompt).toContain('alternativas');
		expect(prompt.toLowerCase()).toContain('nunca invente que um horário foi ocupado');
	});
});
