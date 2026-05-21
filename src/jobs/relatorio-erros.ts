import type { AppSupabaseClient } from '../clients/supabase.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { todayBRT } from '../domain/data-brt.js';
import { getEnv } from '../infra/env.js';
import { rootLogger } from '../infra/logger.js';

export async function runRelatorioErros(deps: {
	supabase: AppSupabaseClient;
	uazapi: UazapiClient;
}): Promise<void> {
	const env = getEnv();
	if (!env.UAZAPI_DEV_PHONE) return; // sem destino configurado

	const log = rootLogger.child({ job: 'relatorio-erros' });
	const hoje = todayBRT();
	const inicio = `${hoje}T00:00:00-03:00`;
	const fim = `${hoje}T23:59:59-03:00`;

	const { data: erros, error } = await deps.supabase.raw
		.from('eventos_helena')
		.select('criado_em, telefone, tipo, detalhes')
		.eq('sucesso', false)
		.gte('criado_em', inicio)
		.lte('criado_em', fim)
		.order('criado_em', { ascending: false });

	if (error) throw new Error(`Failed query eventos_helena: ${error.message}`);

	if (!erros || erros.length === 0) {
		await deps.uazapi.sendText(env.UAZAPI_DEV_PHONE, `✅ Helena ${hoje}: 0 erros`);
		log.info({ data: hoje }, 'Sem erros no dia');
		return;
	}

	const porTool: Record<string, number> = {};
	for (const e of erros) {
		const detalhes = (e.detalhes ?? {}) as Record<string, unknown>;
		const tool = typeof detalhes.tool === 'string' ? detalhes.tool : 'unknown';
		porTool[tool] = (porTool[tool] ?? 0) + 1;
	}

	const linhas = [
		`🐛 *Helena erros — ${hoje}*`,
		'',
		`Total: ${erros.length} erros`,
		'',
		'*Por tool:*',
		...Object.entries(porTool)
			.sort((a, b) => b[1] - a[1])
			.map(([tool, n]) => `• ${tool}: ${n}`),
		'',
		'*Últimos 3:*',
		...erros.slice(0, 3).map((e) => {
			const hora = new Date(e.criado_em as string).toLocaleTimeString('pt-BR', {
				timeZone: 'America/Bahia',
				hour: '2-digit',
				minute: '2-digit',
			});
			const tel = typeof e.telefone === 'string' ? e.telefone.slice(-4) : '????';
			const detalhes = (e.detalhes ?? {}) as Record<string, unknown>;
			const result = (detalhes.result ?? {}) as Record<string, unknown>;
			const razao =
				typeof result.razao === 'string'
					? result.razao
					: typeof detalhes.tool === 'string'
						? detalhes.tool
						: '?';
			const toolName = typeof detalhes.tool === 'string' ? detalhes.tool : '?';
			return `${hora} ${toolName} → ${razao} (...${tel})`;
		}),
	];

	await deps.uazapi.sendText(env.UAZAPI_DEV_PHONE, linhas.join('\n'));
	log.info({ total: erros.length, data: hoje }, 'Relatório de erros enviado');
}
