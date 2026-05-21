import type { AppSupabaseClient } from '../clients/supabase.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { todayBRT } from '../domain/data-brt.js';
import { getEnv } from '../infra/env.js';
import { rootLogger } from '../infra/logger.js';

export interface ResumoDia {
	data: string;
	atendimentos_unicos: number;
	agendamentos_criados: number;
	agendamentos_cancelados: number;
	agendamentos_reagendados: number;
	transferidos_humano: number;
	catalogos_enviados: number;
	cursos_enviados: number;
	pix_enviados: number;
	sinais_pagos: number;
	receita_sinais: number;
	receita_potencial_agendada: number;
	top_servicos: Array<{ nome: string; total: number }>;
	top_horarios: Array<{ faixa: string; total: number }>;
}

type EventoRow = {
	tipo: string;
	telefone: string | null;
	valor: number | null;
	detalhes: Record<string, unknown> | null;
	sucesso: boolean;
	cliente_nome: string | null;
	criado_em: string;
};

export async function agregarEventos(
	supabase: AppSupabaseClient,
	inicio: string,
	fim: string,
): Promise<Omit<ResumoDia, 'data'>> {
	const { data: eventos, error } = await supabase.raw
		.from('eventos_helena')
		.select('tipo, telefone, valor, detalhes, sucesso, cliente_nome, criado_em')
		.gte('criado_em', inicio)
		.lte('criado_em', fim)
		.eq('sucesso', true); // erros NUNCA entram no relatório público

	if (error) throw new Error(`Failed query eventos_helena: ${error.message}`);

	const telefonesUnicos = new Set<string>();
	let agCriados = 0,
		agCancel = 0,
		agReag = 0;
	let transferHum = 0,
		catalogo = 0,
		curso = 0;
	let pix = 0,
		sinaisPagos = 0;
	let receitaSinais = 0,
		receitaAgendada = 0;
	const servicosCount: Record<string, number> = {};
	const horariosCount: Record<string, number> = {};

	for (const e of (eventos ?? []) as EventoRow[]) {
		if (e.telefone) telefonesUnicos.add(e.telefone);
		const detalhes = (e.detalhes ?? {}) as Record<string, unknown>;
		const result = (detalhes.result ?? {}) as Record<string, unknown>;

		switch (e.tipo) {
			case 'agendamento_criado':
				agCriados++;
				receitaAgendada += Number(e.valor ?? 0);
				{
					const servicoNome = typeof result.servico_nome === 'string' ? result.servico_nome : null;
					if (servicoNome) servicosCount[servicoNome] = (servicosCount[servicoNome] ?? 0) + 1;
					const dh =
						typeof result.data_hora_inicio === 'string' ? result.data_hora_inicio : null;
					if (dh) {
						const hora = parseInt(dh.slice(11, 13), 10);
						const faixa = `${hora}h-${hora + 2}h`;
						horariosCount[faixa] = (horariosCount[faixa] ?? 0) + 1;
					}
				}
				break;
			case 'agendamento_cancelado':
				agCancel++;
				break;
			case 'agendamento_reagendado':
				agReag++;
				break;
			case 'transferido_humano':
				transferHum++;
				break;
			case 'catalogo_enviado':
				catalogo++;
				break;
			case 'curso_enviado':
				curso++;
				break;
			case 'pix_enviado':
				pix++;
				break;
			case 'sinal_pago':
				sinaisPagos++;
				receitaSinais += Number(e.valor ?? 0);
				break;
		}
	}

	const topServicos = Object.entries(servicosCount)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([nome, total]) => ({ nome, total }));

	const topHorarios = Object.entries(horariosCount)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([faixa, total]) => ({ faixa, total }));

	return {
		atendimentos_unicos: telefonesUnicos.size,
		agendamentos_criados: agCriados,
		agendamentos_cancelados: agCancel,
		agendamentos_reagendados: agReag,
		transferidos_humano: transferHum,
		catalogos_enviados: catalogo,
		cursos_enviados: curso,
		pix_enviados: pix,
		sinais_pagos: sinaisPagos,
		receita_sinais: receitaSinais,
		receita_potencial_agendada: receitaAgendada,
		top_servicos: topServicos,
		top_horarios: topHorarios,
	};
}

export async function runRelatorioDiario(deps: {
	supabase: AppSupabaseClient;
	uazapi: UazapiClient;
}): Promise<ResumoDia> {
	const log = rootLogger.child({ job: 'relatorio-diario' });
	const hoje = todayBRT();
	const inicio = `${hoje}T00:00:00-03:00`;
	const fim = `${hoje}T23:59:59-03:00`;

	// Idempotência: se já enviado hoje, skip
	const { data: jaEnviado } = await deps.supabase.raw
		.from('relatorios_enviados')
		.select('data, resumo')
		.eq('data', hoje)
		.maybeSingle();

	if (jaEnviado) {
		log.info({ data: hoje }, 'Relatório do dia já enviado, skip');
		return jaEnviado.resumo as ResumoDia;
	}

	const parcial = await agregarEventos(deps.supabase, inicio, fim);
	const resumo: ResumoDia = { data: hoje, ...parcial };

	const texto = formatarRelatorioWhatsApp(resumo);
	await deps.uazapi.sendText(getEnv().UAZAPI_GRUPO_TIME, texto);

	await deps.supabase.raw.from('relatorios_enviados').insert({ data: hoje, resumo });

	log.info({ resumo }, 'Relatório enviado');
	return resumo;
}

function formatarRelatorioWhatsApp(r: ResumoDia): string {
	const dia = new Date(`${r.data}T12:00:00-03:00`);
	const diaSemana = dia.toLocaleDateString('pt-BR', {
		weekday: 'long',
		day: '2-digit',
		month: '2-digit',
		timeZone: 'America/Bahia',
	});

	const real = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;

	const linhas = [
		`📊 *Helena — ${diaSemana}*`,
		'',
		`💬 _Atendimentos:_ ${r.atendimentos_unicos} conversas`,
		`✅ _Agendados:_ ${r.agendamentos_criados} (${real(r.receita_potencial_agendada)})`,
		`❌ _Cancelados:_ ${r.agendamentos_cancelados}`,
		`🔄 _Reagendados:_ ${r.agendamentos_reagendados}`,
		`👤 _Encaminhados pra Camila:_ ${r.transferidos_humano}`,
		`💰 _Sinais recebidos:_ ${r.sinais_pagos} (${real(r.receita_sinais)})`,
		`📄 _Catálogos enviados:_ ${r.catalogos_enviados}`,
		`📚 _PDFs do curso enviados:_ ${r.cursos_enviados}`,
	];

	if (r.top_servicos.length > 0) {
		linhas.push('', '🔝 _Serviços mais procurados:_');
		r.top_servicos.forEach((s, i) => linhas.push(`${i + 1}. ${s.nome} (${s.total})`));
	}

	if (r.top_horarios.length > 0) {
		linhas.push('', `🕐 _Faixas top:_ ${r.top_horarios.map((h) => h.faixa).join(', ')}`);
	}

	return linhas.join('\n');
}
