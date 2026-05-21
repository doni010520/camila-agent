import { Hono } from 'hono';
import { ToolRegistry } from './agent/tools/_registry.js';
import { createAtualizarSinal } from './agent/tools/atualizar_sinal.js';
import { createCancelarAgendamento } from './agent/tools/cancelar_agendamento.js';
import { createConsultarDisponibilidade } from './agent/tools/consultar_disponibilidade.js';
import { createCriarAgendamento } from './agent/tools/criar_agendamento.js';
import { createEnviarCatalogo } from './agent/tools/enviar_catalogo.js';
import { createEnviarPdfCurso } from './agent/tools/enviar_pdf_curso.js';
import { createEnvioPix } from './agent/tools/envio_pix.js';
import { createListarAgendamentos } from './agent/tools/listar_agendamentos.js';
import { createMarcarFalta } from './agent/tools/marcar_falta.js';
import { createNotificarTime } from './agent/tools/notificar_time.js';
import { createReagendarAgendamento } from './agent/tools/reagendar_agendamento.js';
import { createTransferirHumano } from './agent/tools/transferir_humano.js';
import { createValidarComprovante } from './agent/tools/validar_comprovante.js';
import { AppOpenAIClient } from './clients/openai.js';
import { PostgresClient } from './clients/postgres.js';
import { AppSupabaseClient } from './clients/supabase.js';
import { TrinksClient } from './clients/trinks.js';
import { UazapiClient } from './clients/uazapi.js';
import { LeadManager } from './domain/lead.js';
import { getEnv } from './infra/env.js';
import { rootLogger } from './infra/logger.js';
import { createCronRouter } from './routes/cron.js';
import { createAdminRouter } from './routes/admin.js';
import { healthRouter } from './routes/health.js';
import { logsRouter } from './routes/logs.js';
import { createWebhookMessageRouter } from './routes/webhook-message.js';

export interface BootResult {
	app: Hono;
	registry: ToolRegistry;
	trinks: TrinksClient;
	uazapi: UazapiClient;
	supabase: AppSupabaseClient;
	postgres: PostgresClient;
	openai: AppOpenAIClient;
	shutdown: () => Promise<void>;
}

export async function bootApp(): Promise<BootResult> {
	const env = getEnv();
	const log = rootLogger;

	// ── Instantiate clients ──
	const trinks = new TrinksClient();
	const uazapi = new UazapiClient();
	const supabase = new AppSupabaseClient();
	const postgres = new PostgresClient();
	const openai = new AppOpenAIClient();

	// ── Ensure DB tables ──
	await postgres.ensureChatMemoryTable();
	log.info('Chat memory table ensured');

	// ── Build tool registry (all 13 tools) ──
	const profissionalId = env.TRINKS_PROFISSIONAL_ID_CAMILA;
	const leadManager = new LeadManager(supabase);
	const registry = new ToolRegistry();

	registry.register(createConsultarDisponibilidade({ trinks, supabase, profissionalId }));
	registry.register(createCriarAgendamento({ trinks, supabase, postgres, profissionalId }));
	registry.register(createCancelarAgendamento({ trinks, supabase, postgres }));
	registry.register(createReagendarAgendamento({ trinks, supabase, postgres }));
	registry.register(createListarAgendamentos({ trinks, postgres }));
	registry.register(createEnviarCatalogo({ uazapi, supabase, leadManager }));
	registry.register(createEnviarPdfCurso({ uazapi, supabase, leadManager }));
	registry.register(createEnvioPix({ uazapi }));
	registry.register(createValidarComprovante({ openai, uazapi }));
	registry.register(createAtualizarSinal({ trinks, supabase }));
	registry.register(createMarcarFalta({ trinks, supabase }));
	registry.register(createNotificarTime({ uazapi }));
	registry.register(createTransferirHumano({ uazapi, leadManager }));

	log.info({ toolCount: registry.size, tools: registry.names }, 'Tool registry loaded');

	// ── Build Hono app ──
	const app = new Hono();

	app.route('/', healthRouter);
	app.route('/', logsRouter);
	app.route('/', createAdminRouter({ postgres, supabase }));

	const webhookRouter = createWebhookMessageRouter({
		openai,
		uazapi,
		supabase,
		postgres,
		toolRegistry: registry,
		trinks,
	});
	app.route('/', webhookRouter);

	const cronRouter = createCronRouter({ trinks, supabase, uazapi, postgres });
	app.route('/', cronRouter);

	// ── Global error handler ──
	app.onError((err, c) => {
		log.error({ err, path: c.req.path, method: c.req.method }, 'Unhandled error');
		return c.json({ status: 'erro', razao: 'Erro interno do servidor' }, 500);
	});

	app.notFound((c) => c.json({ status: 'erro', razao: 'Rota não encontrada' }, 404));

	const shutdown = async () => {
		log.info('Shutting down...');
		await postgres.close();
	};

	return { app, registry, trinks, uazapi, supabase, postgres, openai, shutdown };
}
