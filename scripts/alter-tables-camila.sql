-- Adapta tabelas existentes da Camila pro novo sistema.
-- Roda 1x via Supabase Dashboard SQL Editor.
-- ATENÇÃO: a tabela `leads_energia_solar` é reaproveitada (com nome legado do projeto Levesol).

ALTER TABLE leads_energia_solar
  ADD COLUMN IF NOT EXISTS pdf_catalogo_enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_curso_enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_agendamento_em timestamptz,
  ADD COLUMN IF NOT EXISTS etiquetas text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sinal_pago boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS agendamento_pendente_id bigint;

ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS lembrete_enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS enquete_finalizacao_enviada_em timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_agendamento timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_servico text;

-- 01/09/2026 — job lembrar-pendentes: cutuca os botões de "finalizou?" que a
-- Camila não respondeu. Precisa saber quantas vezes já insistimos e quando foi
-- a última, senão vira loop infinito de cutucada.
ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS enquete_lembrado_em timestamptz,
  ADD COLUMN IF NOT EXISTS enquete_lembretes integer NOT NULL DEFAULT 0;
