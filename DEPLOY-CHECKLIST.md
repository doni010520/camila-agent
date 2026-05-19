# Deploy Checklist — camila-agent

## Pre-deploy (run once)

```bash
# 1. Create leads_camila table in Supabase
psql $POSTGRES_URL < scripts/create-leads-camila.sql

# 2. Create "catalogos" bucket in Supabase Storage
# → Dashboard → Storage → New bucket → "catalogos" → Public

# 3. Upload PDFs to Supabase Storage
npx tsx scripts/migrate-pdfs-to-supabase.ts ./pdfs/

# 4. Verify Trinks API contract
TRINKS_API_KEY=... TRINKS_ESTABELECIMENTO_ID=44992 npx tsx scripts/verify-trinks-contract.ts

# 5. Create Easypanel service
# → New Service → Docker → Git repo → Set env vars from .env.example → Port 3000
```

## Shadow mode (parallel run, 1-2 days)

```env
TRINKS_DRY_RUN=true
UAZAPI_DRY_RUN=true
```

- Point UAZAPI webhook to: `https://<domain>/webhook/uazapi/message`
- Agent processes messages but does NOT write to Trinks or send WhatsApp messages
- Monitor logs for errors
- Verify tool calls in Pino logs look correct

## Cutover

```env
TRINKS_DRY_RUN=false
UAZAPI_DRY_RUN=false
```

- Restart service in Easypanel
- Monitor first 10 real conversations
- Verify in Trinks dashboard that agendamentos are created correctly

## Configure cron jobs (Easypanel → Cron tab)

```
# Lembrete (3x/day: 9h, 13h, 18h BRT)
0 12 * * * curl -X POST -H "Authorization: Bearer $SECRET" https://<domain>/cron/lembrete
0 16 * * * curl -X POST -H "Authorization: Bearer $SECRET" https://<domain>/cron/lembrete
0 21 * * * curl -X POST -H "Authorization: Bearer $SECRET" https://<domain>/cron/lembrete

# Enquete (3x/day: 12h, 17h, 20h BRT)
0 15 * * * curl -X POST -H "Authorization: Bearer $SECRET" https://<domain>/cron/enquete
0 20 * * * curl -X POST -H "Authorization: Bearer $SECRET" https://<domain>/cron/enquete
0 23 * * * curl -X POST -H "Authorization: Bearer $SECRET" https://<domain>/cron/enquete
```

Note: cron times are UTC. BRT = UTC-3.

## Rollback (if something breaks)

1. In UAZAPI dashboard: change webhook URL back to the n8n endpoint
2. This immediately routes all traffic to the old n8n workflow
3. New service keeps running but receives no messages
4. Fix → redeploy → switch webhook back

## Health check

```bash
curl https://<domain>/health
# Should return: {"status":"ok","service":"camila-agent",...}
```

## Post-deploy monitoring

- [ ] First agendamento created and confirmed in Trinks
- [ ] Lembrete cron runs at expected times, sends reminders
- [ ] Enquete cron runs and finalizes appointments
- [ ] PIX comprovante validation works
- [ ] Catálogo PDF sends correctly
- [ ] transferir_humano disables IA correctly
