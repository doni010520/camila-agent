import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../../src/infra/env.js';
import { handleButton } from '../../src/routes/webhook-button.js';

setTestEnv({});

function makeDeps(overrides?: {
	getAfterPatch?: ReturnType<typeof vi.fn>;
	confirmFn?: ReturnType<typeof vi.fn>;
	finalizeFn?: ReturnType<typeof vi.fn>;
}) {
	const sentTexts: string[] = [];
	return {
		trinks: {
			confirmarAgendamento: overrides?.confirmFn ?? vi.fn().mockResolvedValue({ ok: true }),
			finalizarAgendamento: overrides?.finalizeFn ?? vi.fn().mockResolvedValue({ ok: true }),
			getAgendamento:
				overrides?.getAfterPatch ??
				vi.fn().mockResolvedValue({
					id: 500,
					status: { id: 4, nome: 'Confirmado' },
					cliente: { id: 100, nome: 'Maria' },
					servico: { id: 10, nome: 'VB' },
					profissional: { id: 170223, nome: 'Camila' },
					dataHoraInicio: '2026-05-20T14:00:00',
					duracaoEmMinutos: 120,
					valor: 160,
				}),
		},
		uazapi: {
			sendText: vi.fn().mockImplementation(async (_n: string, text: string) => {
				sentTexts.push(text);
			}),
		},
		supabase: { upsertAgendamento: vi.fn().mockResolvedValue(undefined) },
		openai: {},
		postgres: {},
		toolRegistry: {},
		sentTexts,
	};
}

function makeParams(buttonOrListid: string, deps: ReturnType<typeof makeDeps>) {
	return {
		telefone: '5571999999999',
		buttonOrListid,
		deps: deps as never,
		leadManager: { registrarCompromisso: vi.fn().mockResolvedValue(undefined) } as never,
	};
}

describe('handleButton', () => {
	// ── confirmar ──

	describe('confirmar (Id_sim)', () => {
		it('✅ happy: confirms + verifies status=4 + sends "Te aguardo"', async () => {
			const deps = makeDeps();
			await handleButton(makeParams('Id_sim500', deps));

			expect(deps.trinks.confirmarAgendamento).toHaveBeenCalledWith(500);
			expect(deps.trinks.getAgendamento).toHaveBeenCalledWith(500);
			expect(deps.supabase.upsertAgendamento).toHaveBeenCalledWith({ id: 500, status_id: 4 });
			expect(deps.sentTexts.some((t) => t.includes('Te aguardo'))).toBe(true);
		});

		it('🔴 GHOST: PATCH ok + GET shows status≠4 → error message sent', async () => {
			const deps = makeDeps({
				getAfterPatch: vi.fn().mockResolvedValue({
					id: 500,
					status: { id: 1, nome: 'Agendado' }, // NOT 4!
					cliente: { id: 100, nome: 'Maria' },
					servico: { id: 10, nome: 'VB' },
					profissional: { id: 170223, nome: 'Camila' },
					dataHoraInicio: '2026-05-20T14:00:00',
					duracaoEmMinutos: 120,
					valor: 160,
				}),
			});
			await handleButton(makeParams('Id_sim500', deps));

			expect(deps.sentTexts.some((t) => t.includes('probleminha'))).toBe(true);
			expect(deps.sentTexts.every((t) => !t.includes('Te aguardo'))).toBe(true);
		});

		it('🔴 GHOST: PATCH ok + GET 404 → error message sent', async () => {
			const deps = makeDeps({
				getAfterPatch: vi.fn().mockRejectedValue(new Error('404')),
			});
			await handleButton(makeParams('Id_sim500', deps));

			expect(deps.sentTexts.some((t) => t.includes('probleminha'))).toBe(true);
		});
	});

	// ── recusar ──

	describe('recusar (Id_nao)', () => {
		it('sends reagendamento offer', async () => {
			const deps = makeDeps();
			await handleButton(makeParams('Id_nao500', deps));

			expect(deps.sentTexts.some((t) => t.includes('reagendar'))).toBe(true);
		});
	});

	// ── enquete_sim ──

	describe('enquete_sim (id_sim)', () => {
		it('✅ happy: finalizes + verifies status=8 + sends confirmation', async () => {
			const deps = makeDeps({
				getAfterPatch: vi.fn().mockResolvedValue({
					id: 500,
					status: { id: 8, nome: 'Finalizado' }, // status real medido na API
					cliente: { id: 100, nome: 'Maria' },
					servico: { id: 10, nome: 'VB' },
					profissional: { id: 170223, nome: 'Camila' },
					dataHoraInicio: '2026-05-20T14:00:00',
					duracaoEmMinutos: 120,
					valor: 160,
				}),
			});
			await handleButton(makeParams('id_sim500', deps));

			expect(deps.trinks.finalizarAgendamento).toHaveBeenCalledWith(500);
			expect(deps.supabase.upsertAgendamento).toHaveBeenCalledWith({ id: 500, status_id: 8 });
			expect(deps.sentTexts.some((t) => t.includes('amado o resultado'))).toBe(true);
		});

		it('🔴 GHOST: finalize ok + GET shows status≠8 → no confirmation sent', async () => {
			const deps = makeDeps({
				getAfterPatch: vi.fn().mockResolvedValue({
					id: 500,
					status: { id: 4, nome: 'Confirmado' }, // NOT 6!
					cliente: { id: 100, nome: 'Maria' },
					servico: { id: 10, nome: 'VB' },
					profissional: { id: 170223, nome: 'Camila' },
					dataHoraInicio: '2026-05-20T14:00:00',
					duracaoEmMinutos: 120,
					valor: 160,
				}),
			});
			await handleButton(makeParams('id_sim500', deps));

			// Should NOT send "amado o resultado" — ghost detected
			expect(deps.sentTexts.every((t) => !t.includes('amado o resultado'))).toBe(true);
		});
	});

	// ── enquete_nao ──

	describe('enquete_nao (id_nao)', () => {
		it('sends acknowledgement', async () => {
			const deps = makeDeps();
			await handleButton(makeParams('id_nao', deps));

			expect(deps.sentTexts.some((t) => t.includes('Quando finalizar'))).toBe(true);
		});
	});
});

// ── Regressão de produção (28/08/2026) ──
// A Camila clicou "Sim, finalizei ✅" 5 vezes e NENHUMA oferta de manutenção saiu.
// Causa: a Trinks grava status 8 ("Finalizado"), mas o código verificava contra 6.
// A verificação falhava sempre e o fluxo dava return antes de ofertar a manutenção.
describe('finalizar_sim (Fin_sim) — status real da Trinks é 8', () => {
	function makeFinalizarDeps(
		vagos: string[] = ['14:00', '14:30', '15:00', '15:30'],
		vagosEm?: string,
	) {
		const base = makeDeps();
		const agendamento = {
			id: 521608805,
			status: { id: 8, nome: 'Finalizado' }, // ← o que a Trinks devolve de verdade
			cliente: { id: 100, nome: 'Maria Silva' },
			servico: { id: 10, nome: 'Volume light' },
			profissional: { id: 170223, nome: 'Camila' },
			dataHoraInicio: '2026-08-27T14:00:00',
			duracaoEmMinutos: 120,
			valor: 145,
		};
		const sentMenus: Array<{ number: string; text: string }> = [];
		return {
			...base,
			trinks: {
				...base.trinks,
				getAgendamento: vi.fn().mockResolvedValue(agendamento),
				finalizarAgendamento: vi.fn().mockResolvedValue({ ok: true }),
				getCliente: vi.fn().mockResolvedValue({
					id: 100,
					nome: 'Maria Silva',
					telefones: [{ ddi: '55', ddd: '71', telefone: '999999999' }],
				}),
				// agenda de +15d: por padrao o mesmo horario (14:00) esta livre
				listProfissionaisComAgenda: vi.fn().mockImplementation(async (data: string) => ({
					data: [
						{
							id: 170223,
							nome: 'Camila',
							horariosVagos: data === (vagosEm ?? '2026-09-11') ? vagos : [],
							intervalosVagos: [],
						},
					],
				})),
			},
			uazapi: {
				...base.uazapi,
				sendMenu: vi.fn().mockImplementation(async (o: { number: string; text: string }) => {
					sentMenus.push(o);
				}),
			},
			supabase: {
				...base.supabase,
				raw: {
					from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
				},
			},
			postgres: { findPhoneByTrinksId: vi.fn().mockResolvedValue(null) },
			sentMenus,
		};
	}

	/** leadManager real o suficiente: guarda o que foi mesclado, pra o teste
	 *  medir o que ficou salvo em vez de medir chamada de mock. */
	function fakeLeadManager() {
		const salvo: Record<string, unknown> = {};
		return {
			manager: {
				mergeMetadata: async (_tel: string, patch: Record<string, unknown>) => {
					Object.assign(salvo, patch);
					return true;
				},
				registrarCompromisso: async () => undefined,
			},
			salvo,
		};
	}

	function paramsCom(deps: unknown, leadManager: unknown) {
		return {
			telefone: '5571999999999',
			buttonOrListid: 'Fin_sim521608805',
			deps: deps as never,
			leadManager: leadManager as never,
		};
	}

	it('oferece a manutenção à cliente quando a Trinks confirma status 8', async () => {
		const deps = makeFinalizarDeps();
		const lm = fakeLeadManager();
		await handleButton(paramsCom(deps, lm.manager));

		expect(deps.sentMenus).toHaveLength(1);
		expect(deps.sentMenus[0]?.text).toContain('manutenção');
	});

	it('guarda o serviço e a data da manutenção pro clique da cliente funcionar', async () => {
		const deps = makeFinalizarDeps();
		const lm = fakeLeadManager();
		await handleButton(paramsCom(deps, lm.manager));

		// Volume light (27/08 14:00) → manutenção 15 dias depois, mesmo horário
		expect(lm.salvo.proxima_manutencao_servico).toBe('Manutenção volume light 15 dias');
		expect(lm.salvo.proxima_manutencao_data).toBe('2026-09-11T14:00:00');
	});

	it('avisa a Camila quando o cadastro da cliente não foi encontrado', async () => {
		const deps = makeFinalizarDeps();
		const semLead = {
			mergeMetadata: async () => false,
			registrarCompromisso: async () => undefined,
		};
		await handleButton(paramsCom(deps, semLead));

		expect(deps.sentTexts.join(' | ')).toContain('não achei o cadastro dela');
	});

	it('não acusa falha de finalização para a Camila quando deu certo', async () => {
		const deps = makeFinalizarDeps();
		await handleButton(makeParams('Fin_sim521608805', deps as never));

		const avisos = deps.sentTexts.join(' | ');
		expect(avisos).not.toContain('não confirmou no Trinks');
		expect(avisos).toContain('finalizada');
	});

	it('propõe o horário mais próximo quando o de sempre está ocupado', async () => {
		// 14:00 ocupado; sobra bloco de 2h a partir das 09:00
		const deps = makeFinalizarDeps(['09:00', '09:30', '10:00', '10:30']);
		const lm = fakeLeadManager();
		await handleButton(paramsCom(deps, lm.manager));

		expect(lm.salvo.proxima_manutencao_data).toBe('2026-09-11T09:00:00');
		expect(deps.sentMenus[0]?.text).toContain('11/09 às 9h');
	});

	it('avisa a Camila em vez de propor data inventada quando não há vaga', async () => {
		const deps = makeFinalizarDeps([]); // agenda cheia em toda a janela
		const lm = fakeLeadManager();
		await handleButton(paramsCom(deps, lm.manager));

		expect(deps.sentMenus).toHaveLength(0);
		expect(deps.sentTexts.join(' | ')).toContain('Não achei horário livre');
	});
});

// Item 05 do pedido da Camila: feedback 3 dias depois.
// "se for negativo ela manda a msg eu entro em contato para entender a queixa"
describe('feedback pós-atendimento (Fb_bom / Fb_ruim)', () => {
	beforeEach(() => setTestEnv({ CAMILA_LINK_AVALIACAO: 'https://g.page/r/TESTE/review' } as never));

	function makeFbDeps() {
		const enviados: Array<{ number: string; text: string }> = [];
		return {
			trinks: {
				getAgendamento: vi.fn().mockResolvedValue({
					id: 700,
					status: { id: 8, nome: 'Finalizado' },
					cliente: { id: 100, nome: 'Maria Silva' },
					servico: { id: 10, nome: 'Volume Russo' },
					profissional: { id: 170223, nome: 'Camila' },
					dataHoraInicio: '2026-09-02T14:00:00',
					duracaoEmMinutos: 120,
				}),
			},
			uazapi: {
				sendText: vi.fn().mockImplementation(async (number: string, text: string) => {
					enviados.push({ number, text });
				}),
			},
			supabase: { upsertAgendamento: vi.fn() },
			openai: {},
			postgres: {},
			toolRegistry: {},
			enviados,
		};
	}

	function fbParams(botao: string, deps: unknown) {
		return {
			telefone: '5571999999999',
			buttonOrListid: botao,
			deps: deps as never,
			leadManager: { registrarCompromisso: async () => undefined } as never,
		};
	}

	// Sequência pedida pela Camila em 07/09/2026, depois de ver o fluxo rodando:
	// "Eu queria colher o feedback primeiro para print e postar no Instagram e
	//  logo após pediria para avaliar no Google"
	it('resposta boa: pede o depoimento ANTES do link do Google', async () => {
		const deps = makeFbDeps();
		await handleButton(fbParams('Fb_bom700', deps));

		const praCliente = deps.enviados.filter((e) => e.number === '5571999999999');
		expect(praCliente).toHaveLength(2);
		expect(praCliente[0]?.text.toLowerCase()).toContain('como foi');
		expect(praCliente[0]?.text).not.toContain('http');
		expect(praCliente[1]?.text).toContain('https://g.page/r/TESTE/review');
	});

	// Incidente de produção 07/09/2026: sem link configurado, a Helena pediu
	// avaliação sem dizer onde. A cliente perguntou "Deixar avaliação onde?" e o
	// modelo inventou — mandou o texto "[link de avaliação]" literal pra ela.
	it('nunca pede avaliação sem dizer onde quando não há link', async () => {
		const { setTestEnv: set } = await import('../../src/infra/env.js');
		set({ CAMILA_LINK_AVALIACAO: undefined } as never);
		const deps = makeFbDeps();
		await handleButton(fbParams('Fb_bom700', deps));

		const praCliente = deps.enviados.filter((e) => e.number === '5571999999999');
		// Sem link: só agradece e pede o depoimento. Não menciona "avaliação"
		// solta, que é o que gerou a pergunta "onde?" e a alucinação.
		expect(praCliente.every((m) => !m.text.toLowerCase().includes('avalia'))).toBe(true);
		set({ CAMILA_LINK_AVALIACAO: 'https://g.page/r/TESTE/review' } as never);
	});

	it('resposta boa: avisa a Camila que tem prova social pra colher', async () => {
		const deps = makeFbDeps();
		await handleButton(fbParams('Fb_bom700', deps));

		const praCamila = deps.enviados.find((e) => e.number !== '5571999999999');
		expect(praCamila?.text).toContain('Maria Silva');
	});

	it('resposta ruim: NÃO tenta resolver sozinha, acolhe e passa pra Camila', async () => {
		const deps = makeFbDeps();
		await handleButton(fbParams('Fb_ruim700', deps));

		const praCliente = deps.enviados.find((e) => e.number === '5571999999999');
		const praCamila = deps.enviados.find((e) => e.number !== '5571999999999');
		expect(praCliente?.text.toLowerCase()).toContain('camila');
		expect(praCamila?.text).toContain('Maria Silva');
		expect(praCamila?.text).toContain('Volume Russo');
	});

	it('resposta ruim: não pede avaliação de quem não gostou', async () => {
		const deps = makeFbDeps();
		await handleButton(fbParams('Fb_ruim700', deps));

		const praCliente = deps.enviados.find((e) => e.number === '5571999999999');
		expect(praCliente?.text.toLowerCase()).not.toContain('avalia');
	});
});

describe('histórico de compromisso pelos botões da Camila', () => {
	function makeParamsComLead(buttonOrListid: string, deps: ReturnType<typeof makeDeps>) {
		const registrarCompromisso = vi.fn().mockResolvedValue(undefined);
		return {
			params: {
				telefone: '5571999999999',
				buttonOrListid,
				deps: deps as never,
				leadManager: { registrarCompromisso } as never,
			},
			registrarCompromisso,
		};
	}

	it('🎯 "não compareceu" (finalizar_nao) conta falta pra cliente', async () => {
		const deps = makeDeps();
		deps.trinks.marcarClienteFaltou = vi.fn().mockResolvedValue({ ok: true });
		deps.trinks.getCliente = vi
			.fn()
			.mockResolvedValue({
				id: 100,
				nome: 'Maria',
				telefones: [{ ddd: '71', telefone: '988887777' }],
			});
		const { params, registrarCompromisso } = makeParamsComLead('Fin_nao500', deps);

		await handleButton(params);

		expect(registrarCompromisso).toHaveBeenCalledWith(
			expect.stringContaining('988887777'),
			'falta',
		);
	});

	it('atendimento finalizado conta como atendimento limpo (caminho da redenção)', async () => {
		const deps = makeDeps({
			getAfterPatch: vi.fn().mockResolvedValue({
				id: 500,
				status: { id: 8, nome: 'Finalizado' },
				cliente: { id: 100, nome: 'Maria' },
				servico: { id: 10, nome: 'VB' },
				profissional: { id: 170223, nome: 'Camila' },
				dataHoraInicio: '2026-05-20T14:00:00',
				duracaoEmMinutos: 120,
				valor: 160,
			}),
		});
		deps.trinks.getCliente = vi
			.fn()
			.mockResolvedValue({
				id: 100,
				nome: 'Maria',
				telefones: [{ ddd: '71', telefone: '988887777' }],
			});
		const { params, registrarCompromisso } = makeParamsComLead('Fin_sim500', deps);

		await handleButton(params);

		expect(registrarCompromisso).toHaveBeenCalledWith(
			expect.stringContaining('988887777'),
			'atendimento_concluido',
		);
	});
});

/**
 * A cliente confirma a manutenção pelo botão. Esse caminho montava o contexto
 * do agendamento com `etiquetas: []` e `sinal_pago: false` fixos no código —
 * então a regra de sinal obrigatório (política de compromisso) não pegava aqui:
 * quem estava marcada com #sinal-on fechava manutenção sem pagar nada.
 */
describe('Manut_sim — regra de sinal vale também no botão', () => {
	const AG_ORIGEM = {
		id: 700,
		status: { id: 8, nome: 'Finalizado' },
		cliente: { id: 100, nome: 'Ana Beatriz' },
		servico: { id: 10, nome: 'Volume Russo' },
		profissional: { id: 170223, nome: 'Camila' },
		dataHoraInicio: '2026-09-11T18:00:00',
		duracaoEmMinutos: 90,
		valor: 200,
	};

	function makeManutDeps() {
		const sentTexts: string[] = [];
		const criarHandler = vi.fn().mockResolvedValue({ status: 'ok', agendamento_id: 999 });
		const pixHandler = vi.fn().mockResolvedValue({ status: 'ok' });
		const consultarHandler = vi.fn().mockResolvedValue({ status: 'erro' });
		const tools: Record<string, unknown> = {
			criar_agendamento: { handler: criarHandler },
			envio_pix: { handler: pixHandler },
			consultar_disponibilidade: { handler: consultarHandler },
		};
		return {
			criarHandler,
			pixHandler,
			consultarHandler,
			sentTexts,
			deps: {
				trinks: { getAgendamento: vi.fn().mockResolvedValue(AG_ORIGEM) },
				uazapi: {
					sendText: vi.fn().mockImplementation(async (_n: string, t: string) => {
						sentTexts.push(t);
					}),
				},
				supabase: {
					listServicos: vi.fn().mockResolvedValue([
						{ id: 11, nome: 'Manutenção volume Russo 15 dias', preco: 150 },
					]),
				},
				toolRegistry: { get: (n: string) => tools[n] },
				postgres: {},
			} as never,
		};
	}

	function leadManagerCom(lead: Record<string, unknown>) {
		return {
			findByTelefoneFlex: vi.fn().mockResolvedValue(lead),
			registrarCompromisso: vi.fn().mockResolvedValue(undefined),
			mergeMetadata: vi.fn().mockResolvedValue(true),
		} as never;
	}

	const META_OFERTA = {
		proxima_manutencao_servico: 'Manutenção volume Russo 15 dias',
		proxima_manutencao_data: '2026-09-25T16:30:00',
	};

	it('🎯 cliente na regra: recebe o PIX em vez de outras datas', async () => {
		// O gate vive dentro de criar_agendamento; aqui medimos o que o BOTÃO faz
		// quando a tool recusa por política — antes caía no ramo de "horário
		// ocupado" e oferecia datas alternativas, que não é o caso dela.
		const { deps, pixHandler, sentTexts, consultarHandler } = makeManutDeps();
		deps.toolRegistry.get('criar_agendamento').handler = vi.fn().mockResolvedValue({
			status: 'erro',
			razao: 'Esta cliente só marca com o sinal de 30% pago.',
			detalhes: { politica: 'sinal_obrigatorio' },
		});
		const leadManager = leadManagerCom({
			telefone: '5571988887777',
			nome: 'Ana Beatriz',
			etiquetas: ['sinal-sempre'],
			sinal_pago: false,
			metadata: META_OFERTA,
		});

		await handleButton({
			telefone: '5571988887777',
			buttonOrListid: 'Manut_sim700',
			deps,
			leadManager,
		});

		expect(pixHandler).toHaveBeenCalled();
		expect(sentTexts.join(' | ')).toMatch(/sinal/i);
		expect(consultarHandler).not.toHaveBeenCalled();
	});

	it('cliente normal continua fechando a manutenção pelo botão', async () => {
		const { deps, criarHandler } = makeManutDeps();
		const leadManager = leadManagerCom({
			telefone: '5571988887777',
			nome: 'Maria',
			etiquetas: [],
			sinal_pago: false,
			metadata: META_OFERTA,
		});

		await handleButton({
			telefone: '5571988887777',
			buttonOrListid: 'Manut_sim700',
			deps,
			leadManager,
		});

		expect(criarHandler).toHaveBeenCalled();
	});

	it('o contexto passado ao agendamento carrega o lead real, não um vazio fixo', async () => {
		const { deps, criarHandler } = makeManutDeps();
		const leadManager = leadManagerCom({
			telefone: '5571988887777',
			nome: 'Maria',
			etiquetas: ['vip'],
			sinal_pago: true,
			metadata: { ...META_OFERTA, compromisso: { remarcacoes: 1, faltas: 0 } },
		});

		await handleButton({
			telefone: '5571988887777',
			buttonOrListid: 'Manut_sim700',
			deps,
			leadManager,
		});

		const ctxUsado = criarHandler.mock.calls[0]?.[1];
		expect(ctxUsado.lead.etiquetas).toEqual(['vip']);
		expect(ctxUsado.lead.sinal_pago).toBe(true);
		expect(ctxUsado.lead.metadata).toMatchObject({ compromisso: { remarcacoes: 1 } });
	});

	it('🎯 horário ocupado: as alternativas começam ANTES da data ofertada', async () => {
		// Mesmo defeito de mão única da escolha da data: a Iracema recebeu a
		// oferta pro dia 29 e, quando o horário caiu, só ouviu falar de 29 em
		// diante — o dia 25, livre, nunca apareceu.
		const { deps, consultarHandler } = makeManutDeps();
		deps.toolRegistry.get('criar_agendamento').handler = vi
			.fn()
			.mockResolvedValue({ status: 'erro', razao: 'Horário ocupado' });
		const leadManager = leadManagerCom({
			telefone: '5571988887777',
			nome: 'Maria',
			etiquetas: [],
			sinal_pago: false,
			metadata: META_OFERTA, // oferta era 2026-09-25T16:30
		});

		await handleButton({
			telefone: '5571988887777',
			buttonOrListid: 'Manut_sim700',
			deps,
			leadManager,
		});

		expect(consultarHandler).toHaveBeenCalled();
		expect(consultarHandler.mock.calls[0]?.[0]?.data).toBe('2026-09-23');
	});
});
