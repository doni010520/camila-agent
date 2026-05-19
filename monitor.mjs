import pg from 'pg';
const pool = new pg.Pool({
  user: 'postgres.gppbcnfbaghrblyoovmp',
  password: 'EwjToURDXyLQiS8x',
  host: 'aws-1-us-east-1.pooler.supabase.com',
  port: 6543, database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

// Pega timestamp atual
const startSql = await pool.query("SELECT now() at time zone 'America/Bahia' as t, MAX(id) as max_id FROM n8n_chat_histories");
const startMaxId = startSql.rows[0].max_id;
console.log(`📍 Baseline: max_id=${startMaxId} | hora BRT=${startSql.rows[0].t}`);
console.log('Aguardando novas mensagens... (Ctrl+C pra sair)\n');

let lastSeenId = startMaxId;
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (let i = 0; i < 60; i++) {
  const r = await pool.query(
    `SELECT id, session_id, message FROM n8n_chat_histories WHERE id > $1 ORDER BY id ASC LIMIT 20`,
    [lastSeenId]
  );
  for (const row of r.rows) {
    const m = row.message;
    const type = m?.type ?? '?';
    const content = String(m?.content ?? '').substring(0, 200).replace(/\n/g, ' ');
    const t = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia' });
    console.log(`[${t}] #${row.id} ${row.session_id.slice(-8)} ${type}: ${content}`);
    lastSeenId = row.id;
  }

  // Também monitora leads atualizados
  const leads = await pool.query(`SELECT telefone, nome, ultimo_contato, pdf_catalogo_enviado_em FROM leads_energia_solar WHERE ultimo_contato > now() - interval '2 minutes' ORDER BY ultimo_contato DESC LIMIT 5`);
  for (const l of leads.rows) {
    if (l._seen) continue; // dummy guard
  }

  await sleep(3000);
}

await pool.end();
