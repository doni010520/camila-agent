import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	UazapiClient,
	chatidToTelefone,
	isButtonClick,
	normalizeNumber,
	parseButtonId,
	uazapiWebhookSchema,
} from '../../src/clients/uazapi.js';
import { setTestEnv } from '../../src/infra/env.js';

const BASE = 'https://uazapi.test';

const handlers = [
	http.post(`${BASE}/send/text`, async ({ request }) => {
		const b = (await request.json()) as Record<string, unknown>;
		if (!b.number || !b.text) return new HttpResponse(null, { status: 400 });
		return HttpResponse.json({ status: 'sent' });
	}),
	http.post(`${BASE}/send/media`, async ({ request }) => {
		const b = (await request.json()) as Record<string, unknown>;
		if (!b.number || !b.file) return new HttpResponse(null, { status: 400 });
		return HttpResponse.json({ status: 'sent' });
	}),
	http.post(`${BASE}/send/menu`, async ({ request }) => {
		const b = (await request.json()) as Record<string, unknown>;
		if (!b.number || !b.choices) return new HttpResponse(null, { status: 400 });
		return HttpResponse.json({ status: 'sent' });
	}),
	http.post(`${BASE}/send/pix-button`, async ({ request }) => {
		const b = (await request.json()) as Record<string, unknown>;
		if (!b.number || !b.pixKey) return new HttpResponse(null, { status: 400 });
		return HttpResponse.json({ status: 'sent' });
	}),
];

const server = setupServer(...handlers);

describe('UazapiClient', () => {
	let client: UazapiClient;

	beforeAll(() => {
		setTestEnv({ UAZAPI_BASE_URL: BASE, UAZAPI_TOKEN: 'test-token' });
		server.listen({ onUnhandledRequest: 'error' });
	});
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());
	beforeEach(() => {
		client = new UazapiClient({ baseUrl: BASE, token: 'test-token', dryRun: false });
	});

	describe('sendText', () => {
		it('sends with number + text + delay (not phone + message)', async () => {
			let body: Record<string, unknown> = {};
			server.use(
				http.post(`${BASE}/send/text`, async ({ request }) => {
					body = (await request.json()) as Record<string, unknown>;
					return HttpResponse.json({ status: 'sent' });
				}),
			);
			await client.sendText('5571999999999', 'Oi!');
			expect(body.number).toBe('5571999999999');
			expect(body.text).toBe('Oi!');
			expect(body.delay).toBe(3000);
		});
	});

	describe('sendMedia', () => {
		it('sends base64 in file field (not URL)', async () => {
			let body: Record<string, unknown> = {};
			server.use(
				http.post(`${BASE}/send/media`, async ({ request }) => {
					body = (await request.json()) as Record<string, unknown>;
					return HttpResponse.json({ status: 'sent' });
				}),
			);
			await client.sendMedia({
				number: '5571999',
				type: 'document',
				fileBase64: 'cGRmY29udGVudA==',
				docName: 'catalogo.pdf',
			});
			expect(body.file).toBe('cGRmY29udGVudA==');
			expect(body.docName).toBe('catalogo.pdf');
			expect(body.type).toBe('document');
		});
	});

	describe('sendMenu', () => {
		it('sends choices as "Label|id" strings (not button objects)', async () => {
			let body: Record<string, unknown> = {};
			server.use(
				http.post(`${BASE}/send/menu`, async ({ request }) => {
					body = (await request.json()) as Record<string, unknown>;
					return HttpResponse.json({ status: 'sent' });
				}),
			);
			await client.sendMenu({
				number: '5571999',
				text: 'Confirma?',
				choices: [
					{ label: 'Sim', id: 'Id_sim500' },
					{ label: 'Não', id: 'Id_nao500' },
				],
			});
			expect(body.type).toBe('button');
			expect(body.choices).toEqual(['Sim|Id_sim500', 'Não|Id_nao500']);
		});

		it('rejects more than 3 choices', async () => {
			await expect(
				client.sendMenu({
					number: '55',
					text: 'x',
					choices: [
						{ label: 'a', id: '1' },
						{ label: 'b', id: '2' },
						{ label: 'c', id: '3' },
						{ label: 'd', id: '4' },
					],
				}),
			).rejects.toThrow('3');
		});
	});

	describe('sendPixButton', () => {
		it('sends pixType + pixKey + pixName (no valor/banco/titular)', async () => {
			let body: Record<string, unknown> = {};
			server.use(
				http.post(`${BASE}/send/pix-button`, async ({ request }) => {
					body = (await request.json()) as Record<string, unknown>;
					return HttpResponse.json({ status: 'sent' });
				}),
			);
			await client.sendPixButton({
				number: '5571999',
				pixKey: 'bf673a9f-8117-49c0-ad9e-82e318f665b1',
				pixName: 'CAMILA SILVA DO ROSARIO',
			});
			expect(body.pixType).toBe('EVP');
			expect(body.pixKey).toBe('bf673a9f-8117-49c0-ad9e-82e318f665b1');
			expect(body.pixName).toBe('CAMILA SILVA DO ROSARIO');
			expect(body.valor).toBeUndefined();
			expect(body.banco).toBeUndefined();
		});
	});

	describe('dry-run', () => {
		it('skips HTTP call', async () => {
			const dry = new UazapiClient({ baseUrl: BASE, token: 'test-token', dryRun: true });
			await expect(dry.sendText('55', 'test')).resolves.toBeUndefined();
		});
	});
});

// ── Helpers ──

describe('chatidToTelefone', () => {
	it('strips @s.whatsapp.net', () =>
		expect(chatidToTelefone('5571999999999@s.whatsapp.net')).toBe('5571999999999'));
	it('handles plain number', () => expect(chatidToTelefone('5571999999999')).toBe('5571999999999'));
});

describe('normalizeNumber', () => {
	it('preserves group JID', () =>
		expect(normalizeNumber('120363422033083335@g.us')).toBe('120363422033083335@g.us'));
	it('strips @s.whatsapp.net', () =>
		expect(normalizeNumber('5571999@s.whatsapp.net')).toBe('5571999'));
	it('handles plain', () => expect(normalizeNumber('5571999')).toBe('5571999'));
});

describe('isButtonClick', () => {
	it('detects button by buttonOrListid', () => {
		expect(
			isButtonClick({
				chatid: '55@s.whatsapp.net',
				text: '',
				messageType: 'conversation',
				buttonOrListid: 'Id_sim500',
				wasSentByApi: false,
				fromMe: false,
			}),
		).toBe(true);
	});
	it('returns false for empty buttonOrListid', () => {
		expect(
			isButtonClick({
				chatid: '55@s.whatsapp.net',
				text: 'oi',
				messageType: 'conversation',
				buttonOrListid: '',
				wasSentByApi: false,
				fromMe: false,
			}),
		).toBe(false);
	});
});

describe('parseButtonId', () => {
	it('parses Id_sim (confirmar)', () =>
		expect(parseButtonId('Id_sim495316019')).toEqual({
			action: 'confirmar',
			agendamentoId: '495316019',
		}));
	it('parses Id_nao (recusar)', () =>
		expect(parseButtonId('Id_nao495316019')).toEqual({
			action: 'recusar',
			agendamentoId: '495316019',
		}));
	it('parses id_sim (enquete sim)', () =>
		expect(parseButtonId('id_sim495316019')).toEqual({
			action: 'enquete_sim',
			agendamentoId: '495316019',
		}));
	it('parses id_nao (enquete nao)', () =>
		expect(parseButtonId('id_nao')).toEqual({ action: 'enquete_nao', agendamentoId: '' }));
	it('returns unknown for unrecognized', () =>
		expect(parseButtonId('xyz123')).toEqual({ action: 'unknown', agendamentoId: '123' }));
});

// ── Webhook schema (real production payload) ──

describe('uazapiWebhookSchema', () => {
	const REAL_WEBHOOK = {
		body: {
			chat: { wa_name: 'Maria', wa_label: 'vip' },
			message: {
				chatid: '5571999999999@s.whatsapp.net',
				text: 'Quero agendar',
				messageType: 'conversation',
				wasSentByApi: false,
				fromMe: false,
				content: {
					URL: 'https://cdn.uazapi.com/abc.ogg',
					mediaKey: '...',
					degreesLatitude: null,
					degreesLongitude: null,
				},
				buttonOrListid: '',
			},
			token: '...',
			created_at: '2026-05-15T17:30:00Z',
		},
	};

	it('parses real production text webhook', () => {
		const r = uazapiWebhookSchema.safeParse(REAL_WEBHOOK);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.body.message.chatid).toBe('5571999999999@s.whatsapp.net');
			expect(r.data.body.message.messageType).toBe('conversation');
			expect(r.data.body.chat?.wa_name).toBe('Maria');
		}
	});

	it('parses audio message', () => {
		const r = uazapiWebhookSchema.safeParse({
			body: {
				message: {
					chatid: '5571@s.whatsapp.net',
					messageType: 'audioMessage',
					content: { URL: 'https://cdn/audio.ogg' },
				},
			},
		});
		expect(r.success).toBe(true);
	});

	it('parses button click (same endpoint, buttonOrListid populated)', () => {
		const r = uazapiWebhookSchema.safeParse({
			body: {
				message: {
					chatid: '5571@s.whatsapp.net',
					messageType: 'conversation',
					buttonOrListid: 'Id_sim495316019',
				},
			},
		});
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.body.message.buttonOrListid).toBe('Id_sim495316019');
	});

	it('rejects old sender_pn format (does not exist)', () => {
		const r = uazapiWebhookSchema.safeParse({
			body: { message: { sender_pn: '5571@s.whatsapp.net', type: 'text', text: 'oi' } },
		});
		expect(r.success).toBe(false);
	});

	it('rejects old type enum (conversation, not text)', () => {
		const r = uazapiWebhookSchema.safeParse({
			body: { message: { chatid: '5571@s.whatsapp.net', messageType: 'text' } },
		});
		expect(r.success).toBe(false);
	});
});
