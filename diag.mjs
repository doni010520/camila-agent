import pg from 'pg';
const pool = new pg.Pool({ user: 'postgres.gppbcnfbaghrblyoovmp', password: 'EwjToURDXyLQiS8x', host: 'aws-1-us-east-1.pooler.supabase.com', port: 6543, database: 'postgres', ssl: { rejectUnauthorized: false } });

console.log('=== últimas msgs do TESTE (5571993061031) ===');
const r = await pool.query("SELECT id, message FROM n8n_chat_histories WHERE session_id = '5571993061031' ORDER BY id DESC LIMIT 10");
r.rows.reverse().forEach(row => console.log(`  #${row.id} [${row.message?.type}]: ${String(row.message?.content).substring(0,200).replace(/\n/g,' ⏎ ')}`));

console.log('\n=== últimos agendamentos do TESTE no Supabase (espelho) ===');
const a = await pool.query("SELECT id, status_id, status_nome, servico_nome, data_hora_inicio, numero, created_at, updated_at FROM agendamentos WHERE numero LIKE '%993061031%' OR numero = '5571993061031' ORDER BY created_at DESC NULLS LAST LIMIT 5");
if (a.rows.length === 0) console.log('   (nenhum)');
else a.rows.forEach(r => console.log(`   id=${r.id} status=${r.status_nome} ${r.data_hora_inicio} ${r.servico_nome} created=${r.created_at}`));

console.log('\n=== lead TESTE ===');
const l = await pool.query("SELECT telefone, nome, ultimo_contato, ultimo_servico, ultimo_agendamento_em FROM leads_energia_solar WHERE telefone = '5571993061031'");
l.rows.forEach(r => console.log(JSON.stringify(r)));

await pool.end();
