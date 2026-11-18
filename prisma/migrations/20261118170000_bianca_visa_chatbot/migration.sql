-- Bianca (vistos) entra como opção 3; Gabi → 4; Outros → 5
INSERT INTO "chatbots" ("id", "slug", "name", "menu_label", "menu_order", "engine_kind", "context_text", "welcome_steps", "intro_fallback", "enabled", "created_at", "updated_at")
VALUES (
  'chatbot_bianca',
  'bianca',
  'Bianca',
  'Visto e preparação para Portugal',
  3,
  'GENERIC_CONTEXT',
  E'Você é a Bianca, atendente virtual da Rafa para visto e preparação para Portugal. Fale em português do Brasil, de forma próxima e curta, como uma conversa de WhatsApp. A Rafa é mulher — fala sempre no feminino.\n\nObjectivo principal: esclarecer dúvidas básicas sobre visto/preparação e conduzir a pessoa a agendar uma videochamada com a especialista da equipa. Quando fizer sentido, envia o link de agendamento que o sistema te der (não inventes outro URL).\n\nNão inventes leis de imigração, prazos oficiais, listas de documentos obrigatórios nem garantias de aprovação de visto. Se não souber, diz que a especialista confirma na chamada. Não digas que és uma IA.',
  '[]'::jsonb,
  'Oi! Sou a Bianca, da equipa da Rafa. Ajudo com visto e preparação para Portugal. Em que posso ajudar?',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;

UPDATE "chatbots" SET
  "menu_order" = 4,
  "menu_label" = 'Publicidade e parcerias com a Rafa',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'gabi';

UPDATE "chatbots" SET
  "menu_order" = 5,
  "menu_label" = 'Falar diretamente com a Rafa sobre outros assuntos',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'outros';

UPDATE "chatbots" SET
  "menu_label" = 'Aluguel de imóveis em Portugal (Relocation)',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'joana';

UPDATE "chatbots" SET
  "menu_label" = 'Financiamento ou compra de casa em Portugal',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'bruna';

INSERT INTO "crm_columns" ("id", "chatbot_id", "slug", "label", "sort_order", "tone", "pauses_bot", "created_at", "updated_at")
VALUES
  ('col_bianca_novo', 'chatbot_bianca', 'NOVO', 'Novo', 0, 'slate', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_bianca_em_atendimento', 'chatbot_bianca', 'EM_ATENDIMENTO', 'Em atendimento', 1, 'sky', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_bianca_video', 'chatbot_bianca', 'VIDEO_AGENDADA', 'Videochamada', 2, 'emerald', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_bianca_encerrado', 'chatbot_bianca', 'ENCERRADO', 'Encerrado', 3, 'violet', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("chatbot_id", "slug") DO NOTHING;

UPDATE "chatbot_router_settings" SET
  "menu_text" = E'Oiê! 🥰 Seja muito bem-vindo(a)!\n\nSou a assistente virtual da Rafa e estou aqui pra te ajudar! 💛\n\nMe conta, sobre qual assunto você gostaria de conversar?\n\n🏡 1. Aluguel de imóveis em Portugal (Relocation)\n\n🔑 2. Financiamento ou compra de casa em Portugal\n\n🛂 3. Visto e preparação para Portugal\n\n💌 4. Publicidade e parcerias com a Rafa\n\n💬 5. Falar diretamente com a Rafa sobre outros assuntos',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'default';
