import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({});

// Mock dependencies before importing the module
const mockDebouncer = { push: vi.fn(), setCallback: vi.fn(), destroy: vi.fn() };
vi.mock('../../src/domain/debounce.js', () => ({
	MessageDebouncer: vi.fn().mockImplementation(() => mockDebouncer),
}));

const mockLeadManager = {
	maybeAutoReactivate: vi.fn().mockResolvedValue(false),
	setIaAtiva: vi.fn(),
	setVip: vi.fn(),
	setIntervencaoHumana: vi.fn().mockResolvedValue(undefined),
	minutosDesdeIntervencao: vi.fn().mockReturnValue(null), // null = sem intervenção recente
	getOrCreate: vi.fn().mockResolvedValue({
		id: 'uuid',
		telefone: '5571999999999',
		nome: 'Maria',
		ia_ativa: true,
		etiquetas: [],
		sinal_pago: false,
		pdf_catalogo_enviado_em: null,
		primeiro_interacao: '',
		ultimo_contato: '',
		metadata: {},
		created_at: '',
		updated_at: '',
	}),
};
vi.mock('../../src/domain/lead.js', () => ({
	LeadManager: vi.fn().mockImplementation(() => mockLeadManager),
}));

const mockMediaRouter = { process: vi.fn().mockResolvedValue({ text: '[Áudio transcrito]: oi' }) };
vi.mock('../../src/domain/media-router.js', () => ({
	MediaRouter: vi.fn().mockImplementation(() => mockMediaRouter),
}));

vi.mock('../../src/domain/memory.js', () => ({
	ChatMemory: vi.fn().mockImplementation(() => ({})),
}));

const mockHandleButton = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/routes/webhook-button.js', () => ({
	handleButton: (...args: unknown[]) => mockHandleButton(...args),
}));

import { createWebhookMessageRouter } from '../../src/routes/webhook-message.js';

function makeApp() {
	const deps = {
		openai: {},
		uazapi: {},
		supabase: {},
		postgres: {},
		toolRegistry: {},
		trinks: {},
	};
	const router = createWebhookMessageRouter(deps as never);
	const app = new Hono();
	app.route('/', router);
	return app;
}

function makePayload(overrides?: Record<string, unknown>) {
	return {
		body: {
			chat: { wa_name: 'Maria', wa_label: '' },
			message: {
				chatid: '5571999999999@s.whatsapp.net',
				text: 'Quero agendar',
				messageType: 'conversation',
				wasSentByApi: false,
				fromMe: false,
				content: {},
				buttonOrListid: '',
				...overrides,
			},
		},
	};
}

async function post(app: Hono, payload: unknown) {
	return app.request('/webhook/uazapi/message', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});
}

describe('POST /webhook/uazapi/message', () => {
	let app: Hono;

	beforeEach(() => {
		vi.clearAllMocks();
		// Defaults restaurados a cada teste
		mockLeadManager.minutosDesdeIntervencao.mockReturnValue(null);
		mockLeadManager.getOrCreate.mockResolvedValue({
			id: 'uuid',
			telefone: '5571999999999',
			nome: 'Maria',
			ia_ativa: true,
			etiquetas: [],
			sinal_pago: false,
			pdf_catalogo_enviado_em: null,
			primeira_interacao: '',
			ultimo_contato: '',
			metadata: {},
			created_at: '',
			updated_at: '',
		});
		app = makeApp();
	});

	it('valid text → 200 {debounced: true}, debouncer.push called', async () => {
		const res = await post(app, makePayload());
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.debounced).toBe(true);
		expect(mockDebouncer.push).toHaveBeenCalledWith('5571999999999', 'Quero agendar');
	});

	it('fromMe: true (humano digitando) → 200 {ignored: "intervencao_humana"}, setIntervencaoHumana chamado', async () => {
		const res = await post(app, makePayload({ fromMe: true }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ignored).toBe('intervencao_humana');
		expect(mockLeadManager.setIntervencaoHumana).toHaveBeenCalledWith('5571999999999');
		expect(mockDebouncer.push).not.toHaveBeenCalled();
	});

	it('wasSentByApi: true (API da Helena) → 200 {ignored: "fromMe"}, sem DB', async () => {
		const res = await post(app, makePayload({ wasSentByApi: true }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ignored).toBe('fromMe');
		// Saída antecipada: nenhum acesso ao lead
		expect(mockLeadManager.getOrCreate).not.toHaveBeenCalled();
		expect(mockLeadManager.setIntervencaoHumana).not.toHaveBeenCalled();
		expect(mockDebouncer.push).not.toHaveBeenCalled();
	});

	it('intervenção humana recente (15 min) → 200 {ignored: "intervencao_humana_recente"}, Helena calada', async () => {
		mockLeadManager.minutosDesdeIntervencao.mockReturnValue(15);
		const res = await post(app, makePayload());
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ignored).toBe('intervencao_humana_recente');
		expect(body.minutos_restantes).toBe(15); // ceil(30 - 15)
		expect(mockDebouncer.push).not.toHaveBeenCalled();
	});

	it('intervenção antiga (31 min) → Helena volta a responder normalmente', async () => {
		mockLeadManager.minutosDesdeIntervencao.mockReturnValue(31);
		const res = await post(app, makePayload());
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.debounced).toBe(true);
		expect(mockDebouncer.push).toHaveBeenCalledWith('5571999999999', 'Quero agendar');
	});

	it('invalid chatid → 200 {ignored: "invalid_phone"}', async () => {
		const res = await post(app, makePayload({ chatid: 'abc@s.whatsapp.net' }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ignored).toBe('invalid_phone');
	});

	it('ia_on_off: "off" → 200 {ignored: "ia_desativada"}', async () => {
		mockLeadManager.getOrCreate.mockResolvedValue({
			id: 'uuid',
			telefone: '5571999999999',
			nome: 'Maria',
			ia_on_off: 'off',
			etiquetas: [],
			sinal_pago: false,
			pdf_catalogo_enviado_em: null,
			primeira_interacao: '',
			ultimo_contato: '',
			metadata: {},
			created_at: '',
			updated_at: '',
		});
		const res = await post(app, makePayload());
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ignored).toBe('ia_desativada');
	});

	it('invalid zod payload → 400', async () => {
		const res = await post(app, { body: { message: { wrong: true } } });
		expect(res.status).toBe(400);
	});

	it('buttonOrListid preenchido → handleButton called, returns {type: "button"}', async () => {
		const res = await post(app, makePayload({ buttonOrListid: 'Id_sim500' }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.type).toBe('button');
		expect(mockHandleButton).toHaveBeenCalled();
	});

	it('imageMessage → mediaRouter.process called with messageid, text enters debouncer', async () => {
		const res = await post(
			app,
			makePayload({
				messageid: 'msg-123-abc',
				messageType: 'imageMessage',
				text: '',
				content: { URL: 'https://cdn.test/img.jpg' },
			}),
		);
		expect(res.status).toBe(200);
		expect(mockMediaRouter.process).toHaveBeenCalledWith(
			'imageMessage',
			'msg-123-abc',
		);
		expect(mockDebouncer.push).toHaveBeenCalledWith('5571999999999', '[Áudio transcrito]: oi');
	});
});
