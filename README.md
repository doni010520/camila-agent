# camila-agent

Helena AI — WhatsApp scheduling agent for Camila Rosario Academy.

Replaces the n8n workflow (94 nodes + 9 sub-workflows) with a typed, tested Node.js service.

## Quick Start

```bash
pnpm install
cp .env.example .env   # edit with real credentials
pnpm dev               # development with hot reload
pnpm test              # run tests
pnpm test:coverage     # with coverage report
pnpm lint              # biome check
pnpm build             # TypeScript → dist/
```

## Architecture

```
src/
├── server.ts              # Entry point (thin — consumes composition-root)
├── composition-root.ts    # Boots clients, registers 13 tools, wires routes
├── routes/
│   ├── health.ts          # GET /health
│   ├── webhook-message.ts # POST /webhook/uazapi/message (messages + buttons)
│   └── webhook-button.ts  # Button click handler (same endpoint, routed internally)
├── agent/
│   ├── helena.ts          # Agent loop: prompt → tool calls → response
│   ├── prompt.md          # System prompt v14 (template with {{variables}})
│   └── tools/             # 13 tools with Zod schemas + handlers
├── clients/               # Typed API clients (Trinks, UAZAPI, Supabase, Postgres, OpenAI)
├── domain/                # Business logic (debounce, memory, telefone, leads, media, BRT dates)
└── infra/                 # Logger, env validation, errors, retry
```

## Runbook

### Deploy (Easypanel)

1. Push to `main` branch
2. Easypanel builds Docker image automatically
3. Set all env vars from `.env.example` in Easypanel dashboard
4. Service exposes port 3000
5. Configure UAZAPI webhook URL: `https://<domain>/webhook/uazapi/message`
6. Configure external cron to hit `/cron/lembrete` (9h, 13h, 18h) and `/cron/enquete` (12h, 17h, 20h)

### Rollback

If something breaks after cutover:

1. In UAZAPI dashboard: change webhook URL back to the n8n endpoint
2. This immediately routes all messages to the old n8n workflow
3. The new service keeps running but receives no traffic
4. Investigate logs, fix, redeploy, then switch webhook back

### Dry-run (Shadow Mode)

Run the new service in parallel without affecting real data:

```bash
TRINKS_DRY_RUN=true     # POST/PUT/PATCH to Trinks return synthetic responses; GETs pass through
UAZAPI_DRY_RUN=true     # All sends are logged but not executed
```

To activate at runtime without restart: update env vars in Easypanel and restart the service.

To test with a real client: set `TRINKS_CLIENTE_TESTE_ID` to a known test client ID — only this client triggers real writes.

### Logs

- **Easypanel:** Dashboard → Service → Logs (stdout/stderr)
- All logs are structured JSON via Pino
- Every request gets a `correlationId` for tracing
- Filter by `telefone` (last 8 digits) to trace a specific client's conversation

Key log fields:
- `client: 'trinks'|'uazapi'|'openai'` — which external API
- `dry_run: true` — shadow mode active
- `tool: 'criar_agendamento'` — which tool executed
- `status: 'ok'|'erro'` — tool result

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| 404 on webhook | UAZAPI URL wrong | Check Easypanel domain + `/webhook/uazapi/message` path |
| Agent confirms but Trinks empty | `TRINKS_DRY_RUN=true` left on | Set to `false` and restart |
| Client messages ignored | `ia_ativa = false` in leads_camila | Update lead in Supabase |
| "Já chamei a Camila" every message | Agent hitting max turns (6) | Check OpenAI API key / model availability |
| "Payload inválido" 400 | UAZAPI webhook format changed | Check logs for Zod error details |
| Comprovante not validating | OpenAI Vision quota or model issue | Check `OPENAI_MODEL_VISION` and API key |

### Boot Order

Dependencies that must be reachable at startup:
1. Postgres (for `ensureChatMemoryTable`)
2. Supabase (for lead/agendamento operations)
3. OpenAI (for agent — only needed at request time)
4. Trinks (for tools — only needed at request time)
5. UAZAPI (for sending — only needed at request time)

### Extension Points

- **New tool:** Create `src/agent/tools/my_tool.ts` with factory function, register in `composition-root.ts`
- **New cron job:** Create `src/jobs/my_job.ts`, add route in `src/routes/cron.ts`
- **New message type:** Add to `MEDIA_TYPES` set in `webhook-message.ts`, add handler in `media-router.ts`
