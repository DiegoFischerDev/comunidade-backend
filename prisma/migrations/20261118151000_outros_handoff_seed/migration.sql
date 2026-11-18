-- Seed chatbot «Outros» (depois do enum HANDOFF_OTHER estar commitado)
INSERT INTO "chatbots" ("id", "slug", "name", "menu_label", "menu_order", "engine_kind", "context_text", "welcome_steps", "intro_fallback", "enabled", "created_at", "updated_at")
VALUES (
  'chatbot_outros',
  'outros',
  'Outros',
  'Falar diretamente com a Rafa sobre outros assuntos',
  4,
  'HANDOFF_OTHER',
  'Handoff para a Rafa sobre outros assuntos. Não há conversa automática após a escolha.',
  '[]'::jsonb,
  NULL,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;

UPDATE "chatbots" SET
  "menu_label" = 'Aluguel de imóveis em Portugal (Relocation)',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'joana';

UPDATE "chatbots" SET
  "menu_label" = 'Financiamento ou compra de casa em Portugal',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'bruna';

UPDATE "chatbots" SET
  "menu_label" = 'Publicidade e parcerias com a Rafa',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'gabi';

INSERT INTO "crm_columns" ("id", "chatbot_id", "slug", "label", "sort_order", "tone", "pauses_bot", "created_at", "updated_at")
VALUES
  ('col_outros_novo', 'chatbot_outros', 'NOVO', 'Novo', 0, 'slate', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_outros_em_atendimento', 'chatbot_outros', 'EM_ATENDIMENTO', 'Em atendimento', 1, 'sky', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_outros_respondido', 'chatbot_outros', 'RESPONDIDO', 'Respondido', 2, 'emerald', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_outros_encerrado', 'chatbot_outros', 'ENCERRADO', 'Encerrado', 3, 'violet', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("chatbot_id", "slug") DO NOTHING;

UPDATE "chatbot_router_settings" SET
  "menu_text" = E'Oiê! 🥰 Seja muito bem-vindo(a)!\n\nSou a assistente virtual da Rafa e estou aqui pra te ajudar! 💛\n\nMe conta, sobre qual assunto você gostaria de conversar?\n\n🏡 1. Aluguel de imóveis em Portugal (Relocation)\n\n🔑 2. Financiamento ou compra de casa em Portugal\n\n💌 3. Publicidade e parcerias com a Rafa\n\n💬 4. Falar diretamente com a Rafa sobre outros assuntos',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'default';
