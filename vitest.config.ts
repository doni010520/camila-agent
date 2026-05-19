import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/**/*.spec.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/server.ts', 'src/types/**'],
			thresholds: {
				// Global minimum
				branches: 60,
				functions: 65,
				lines: 65,
				statements: 65,

				// Tools: highest bar — anti-ghost lives here
				'src/agent/tools/**': {
					branches: 55,
					functions: 94,
					lines: 85,
					statements: 85,
				},

				// Domain: business logic
				// Current: ~54%. Blocked by lead.ts/media-router.ts at 0%.
				// TODO: raise to 80% after adding tests in feat/tests-untested-modules
				'src/domain/**': {
					branches: 55,
					functions: 55,
					lines: 50,
					statements: 50,
				},

				// Clients: external API wrappers (Trinks/UAZAPI tested, OpenAI/Postgres/Supabase need mocks)
				// TODO: raise to 70% after adding msw tests for OpenAI + Supabase mock
				'src/clients/**': {
					branches: 45,
					functions: 50,
					lines: 50,
					statements: 50,
				},

				// Routes: webhook handlers
				'src/routes/**': {
					branches: 55,
					functions: 65,
					lines: 60,
					statements: 60,
				},
			},
		},
		testTimeout: 15000,
		hookTimeout: 10000,
	},
});
