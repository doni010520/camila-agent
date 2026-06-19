import { z } from 'zod';

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
	PORT: z.coerce.number().default(3000),

	// OpenAI
	OPENAI_API_KEY: z.string().min(1),
	OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
	OPENAI_MODEL_VISION: z.string().default('gpt-4.1'),
	OPENAI_MODEL_WHISPER: z.string().default('whisper-1'),

	// Trinks
	TRINKS_API_KEY: z.string().min(1),
	TRINKS_ESTABELECIMENTO_ID: z.coerce.number().default(44992),
	TRINKS_PROFISSIONAL_ID_CAMILA: z.coerce.number().default(170223),

	// UAZAPI
	UAZAPI_BASE_URL: z.string().url(),
	UAZAPI_TOKEN: z.string().min(1),
	UAZAPI_GRUPO_TIME: z.string().min(1),
	UAZAPI_CAMILA_PHONE: z.string().default('557194027176'),

	// Supabase
	SUPABASE_URL: z.string().url(),
	SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
	SUPABASE_STORAGE_BUCKET: z.string().default('catalogos'),

	// Postgres
	POSTGRES_URL: z.string().min(1),

	// Shadow mode / dry-run
	// ⚠️ z.coerce.boolean() is a trap: Boolean("false") === true in JS.
	// Use explicit enum + transform so TRINKS_DRY_RUN=false in .env works correctly.
	TRINKS_DRY_RUN: z
		.enum(['true', 'false', '1', '0'])
		.default('false')
		.transform((v) => v === 'true' || v === '1'),
	UAZAPI_DRY_RUN: z
		.enum(['true', 'false', '1', '0'])
		.default('false')
		.transform((v) => v === 'true' || v === '1'),
	TRINKS_CLIENTE_TESTE_ID: z.coerce.number().optional(),

	// Safety
	WEBHOOK_SHARED_SECRET: z.string().optional(),
	DEBOUNCE_MS: z.coerce.number().default(8000),
	AGENT_MAX_TURNS: z.coerce.number().default(6),

	// Dev notifications (optional — relatório de erros privado)
	UAZAPI_DEV_PHONE: z.string().optional(),

	/** Lista de telefones (CSV) pra quem a Helena SEMPRE diz que não há vagas e
	 *  NUNCA oferece encaixe/avisa a Camila. Ex: "5571999998888,5571988887777".
	 *  Comparação pelos últimos 8 dígitos (robusto a DDI/DDD/9º dígito). */
	HELENA_NUMEROS_BLOQUEADOS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function loadEnv(): Env {
	if (_env) return _env;
	const result = envSchema.safeParse(process.env);
	if (!result.success) {
		const formatted = result.error.flatten().fieldErrors;
		const missing = Object.entries(formatted)
			.map(([k, v]) => `  ${k}: ${v?.join(', ')}`)
			.join('\n');
		throw new Error(`Invalid environment variables:\n${missing}`);
	}
	_env = result.data;
	return _env;
}

/** For tests: override env with partial values */
export function setTestEnv(overrides: Partial<Env>): Env {
	const defaults: Record<string, string> = {
		NODE_ENV: 'test',
		PORT: '3000',
		OPENAI_API_KEY: 'sk-test',
		OPENAI_MODEL: 'gpt-4.1-mini',
		OPENAI_MODEL_VISION: 'gpt-4.1',
		OPENAI_MODEL_WHISPER: 'whisper-1',
		TRINKS_API_KEY: 'test-key',
		TRINKS_ESTABELECIMENTO_ID: '44992',
		TRINKS_PROFISSIONAL_ID_CAMILA: '170223',
		UAZAPI_BASE_URL: 'https://test.uazapi.com',
		UAZAPI_TOKEN: 'test-token',
		UAZAPI_GRUPO_TIME: '123@g.us',
		UAZAPI_CAMILA_PHONE: '557194027176',
		SUPABASE_URL: 'https://test.supabase.co',
		SUPABASE_SERVICE_ROLE_KEY: 'test-key',
		SUPABASE_STORAGE_BUCKET: 'catalogos',
		POSTGRES_URL: 'postgres://test:test@localhost/test',
		TRINKS_DRY_RUN: 'false',
		UAZAPI_DRY_RUN: 'false',
		DEBOUNCE_MS: '8000',
		AGENT_MAX_TURNS: '6',
	};
	const merged = { ...defaults, ...overrides };
	_env = envSchema.parse(merged);
	return _env;
}

export function getEnv(): Env {
	if (!_env) return loadEnv();
	return _env;
}
