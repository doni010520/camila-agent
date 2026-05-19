#!/usr/bin/env npx tsx
/**
 * verify-trinks-contract.ts
 * Run before first deploy to ensure Trinks API is reachable and returns expected shapes.
 *
 * Usage: TRINKS_API_KEY=... TRINKS_ESTABELECIMENTO_ID=44992 npx tsx scripts/verify-trinks-contract.ts
 */

import {
	TrinksClient,
	trinksAgendamentoListSchema,
	trinksProfissionalListSchema,
	trinksServicoListSchema,
} from '../src/clients/trinks.js';
import { addDaysBRT, todayBRT } from '../src/domain/data-brt.js';
import { loadEnv } from '../src/infra/env.js';

const CAMILA_ID = 170223;

async function main() {
	loadEnv();
	const trinks = new TrinksClient();
	let ok = true;

	console.log('🔍 Verifying Trinks contract...\n');

	// 1. GET /v1/servicos
	try {
		const servicos = await trinks.listServicos();
		trinksServicoListSchema.parse(servicos);
		console.log(`✅ GET /v1/servicos — ${servicos.data.length} serviços`);
		servicos.data
			.slice(0, 3)
			.forEach((s) =>
				console.log(`   ${s.id}: ${s.nome} (${s.duracaoEmMinutos}min, R$${s.preco ?? '?'})`),
			);
	} catch (err) {
		console.error('❌ GET /v1/servicos FAILED:', err);
		ok = false;
	}

	// 2. GET /v1/profissionais — must include Camila (170223)
	try {
		const profs = await trinks.listProfissionais();
		trinksProfissionalListSchema.parse(profs);
		const camila = profs.data.find((p) => p.id === CAMILA_ID);
		if (camila) {
			console.log(`✅ GET /v1/profissionais — Camila found (id=${CAMILA_ID})`);
		} else {
			console.error(
				`❌ GET /v1/profissionais — Camila (id=${CAMILA_ID}) NOT FOUND. IDs: ${profs.data.map((p) => p.id).join(', ')}`,
			);
			ok = false;
		}
	} catch (err) {
		console.error('❌ GET /v1/profissionais FAILED:', err);
		ok = false;
	}

	// 3. GET /v1/agendamentos — with tomorrow's date
	try {
		const amanha = addDaysBRT(todayBRT(), 1);
		const ags = await trinks.listAgendamentos({ dataInicio: amanha, dataFim: amanha });
		trinksAgendamentoListSchema.parse(ags);
		console.log(`✅ GET /v1/agendamentos (${amanha}) — ${ags.data.length} agendamentos`);
		if (ags.data.length > 0) {
			const a = ags.data[0];
			console.log(`   Sample: ${a?.servico.nome} para ${a?.cliente.nome} às ${a?.dataHoraInicio}`);
		}
	} catch (err) {
		console.error('❌ GET /v1/agendamentos FAILED:', err);
		ok = false;
	}

	// 4. GET /v1/agendamentos/profissionais/{data}
	try {
		const amanha = addDaysBRT(todayBRT(), 1);
		const disp = await trinks.listProfissionaisComAgenda(amanha);
		const camila = disp.data.find((p) => p.id === CAMILA_ID);
		if (camila) {
			console.log(
				`✅ GET /v1/agendamentos/profissionais/${amanha} — Camila: ${camila.horariosVagos.length} slots vagos`,
			);
		} else {
			console.log(
				`⚠️  GET /v1/agendamentos/profissionais/${amanha} — Camila não encontrada (pode ser dia fechado)`,
			);
		}
	} catch (err) {
		console.error('❌ GET /v1/agendamentos/profissionais FAILED:', err);
		ok = false;
	}

	// 5. GET /v1/clientes — basic connectivity
	try {
		const clientes = await trinks.listClientes({ pageSize: 1 });
		console.log(`✅ GET /v1/clientes — ${clientes.totalRecords ?? '?'} clientes total`);
	} catch (err) {
		console.error('❌ GET /v1/clientes FAILED:', err);
		ok = false;
	}

	console.log(
		ok
			? '\n✅ All checks passed. Safe to deploy.'
			: '\n❌ Some checks failed. DO NOT deploy until fixed.',
	);
	process.exit(ok ? 0 : 1);
}

main().catch((err) => {
	console.error('Script error:', err);
	process.exit(1);
});
