-- CreateEnum
CREATE TYPE "ChatbotEngineKind" AS ENUM ('JOANA_QUALIFICATION', 'GENERIC_CONTEXT');

-- CreateTable
CREATE TABLE "chatbots" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "menu_label" VARCHAR(120) NOT NULL,
    "menu_order" INTEGER NOT NULL,
    "engine_kind" "ChatbotEngineKind" NOT NULL,
    "context_text" TEXT NOT NULL,
    "welcome_steps" JSONB NOT NULL DEFAULT '[]',
    "intro_fallback" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chatbots_slug_key" ON "chatbots"("slug");
CREATE INDEX "chatbots_menu_order_idx" ON "chatbots"("menu_order");

-- AlterTable joana_conversations: multi-bot router fields
ALTER TABLE "joana_conversations" ADD COLUMN "chatbot_id" TEXT;
ALTER TABLE "joana_conversations" ADD COLUMN "menu_sent" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "joana_conversations_chatbot_id_idx" ON "joana_conversations"("chatbot_id");

ALTER TABLE "joana_conversations"
  ADD CONSTRAINT "joana_conversations_chatbot_id_fkey"
  FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable crm_columns
CREATE TABLE "crm_columns" (
    "id" TEXT NOT NULL,
    "chatbot_id" TEXT NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "tone" VARCHAR(40),
    "pauses_bot" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_columns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_columns_chatbot_id_slug_key" ON "crm_columns"("chatbot_id", "slug");
CREATE INDEX "crm_columns_chatbot_id_sort_order_idx" ON "crm_columns"("chatbot_id", "sort_order");

ALTER TABLE "crm_columns"
  ADD CONSTRAINT "crm_columns_chatbot_id_fkey"
  FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable crm_leads
CREATE TABLE "crm_leads" (
    "id" TEXT NOT NULL,
    "chatbot_id" TEXT NOT NULL,
    "column_id" TEXT NOT NULL,
    "whatsapp_digits" TEXT NOT NULL,
    "guest_name" TEXT,
    "bot_enabled" BOOLEAN NOT NULL DEFAULT true,
    "crm_comments" TEXT,
    "crm_expected_immigration_at" TIMESTAMP(3),
    "crm_immigration_immediate" BOOLEAN NOT NULL DEFAULT false,
    "crm_property_typology" "RafaCallCrmPropertyTypology",
    "crm_preferred_city" TEXT,
    "crm_has_pet" BOOLEAN,
    "crm_desired_rent" INTEGER,
    "crm_has_visa" BOOLEAN,
    "crm_profile_image_url" TEXT,
    "rafa_call_booking_id" TEXT,
    "crm_excluded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_leads_rafa_call_booking_id_key" ON "crm_leads"("rafa_call_booking_id");
CREATE UNIQUE INDEX "crm_leads_chatbot_id_whatsapp_digits_key" ON "crm_leads"("chatbot_id", "whatsapp_digits");
CREATE INDEX "crm_leads_chatbot_id_column_id_idx" ON "crm_leads"("chatbot_id", "column_id");
CREATE INDEX "crm_leads_whatsapp_digits_idx" ON "crm_leads"("whatsapp_digits");

ALTER TABLE "crm_leads"
  ADD CONSTRAINT "crm_leads_chatbot_id_fkey"
  FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_leads"
  ADD CONSTRAINT "crm_leads_column_id_fkey"
  FOREIGN KEY ("column_id") REFERENCES "crm_columns"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed chatbots
INSERT INTO "chatbots" ("id", "slug", "name", "menu_label", "menu_order", "engine_kind", "context_text", "welcome_steps", "intro_fallback", "enabled", "created_at", "updated_at")
VALUES
(
  'chatbot_joana',
  'joana',
  'Joana',
  'Relocation / aluguel',
  1,
  'JOANA_QUALIFICATION',
  COALESCE(
    (SELECT "context_text" FROM "joana_settings" WHERE "id" = 'default'),
    'Você é a Joana, atendente virtual da Rafa. Fale em português do Brasil, de forma próxima e curta, como uma conversa de WhatsApp.'
  ),
  COALESCE(
    (SELECT "welcome_steps" FROM "joana_settings" WHERE "id" = 'default'),
    '[]'::jsonb
  ),
  NULL,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'chatbot_bruna',
  'bruna',
  'Bruna',
  'Crédito imobiliário / compra de casa',
  2,
  'GENERIC_CONTEXT',
  'Você é a Bruna, atendente virtual da Rafa para assessoria de crédito imobiliário e compra de casa em Portugal. Fale em português do Brasil, de forma próxima e curta, como uma conversa de WhatsApp. A Rafa é mulher — fala sempre no feminino. Não invente taxas, spreads, prazos de aprovação nem condições bancárias fora deste contexto. Se não souber, diga que a Rafa ou a equipa confirma. Ofereça-se para esclarecer dúvidas e recolher o interesse da pessoa.',
  '[]'::jsonb,
  'Oi! Sou a Bruna, da equipa da Rafa. Ajudo com crédito imobiliário e compra de casa em Portugal. Como posso ajudar?',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'chatbot_gabi',
  'gabi',
  'Gabi',
  'Publicidade com a Rafa',
  3,
  'GENERIC_CONTEXT',
  'Você é a Gabi, atendente virtual da Rafa para empresas interessadas em publicidade e parcerias. Fale em português do Brasil, de forma próxima e curta, como uma conversa de WhatsApp. A Rafa é mulher — fala sempre no feminino. Não invente preços de campanha, audiências nem compromissos comerciais fora deste contexto. Se não souber, diga que a Rafa confirma. Peça o nome da empresa, o objectivo da campanha e como preferem ser contactados.',
  '[]'::jsonb,
  'Oi! Sou a Gabi, da equipa da Rafa. Trato de publicidade e parcerias com empresas. Em que posso ajudar?',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Seed Joana CRM columns (slugs estáveis = RafaCallCrmStatus)
INSERT INTO "crm_columns" ("id", "chatbot_id", "slug", "label", "sort_order", "tone", "pauses_bot", "created_at", "updated_at")
VALUES
  ('col_joana_imigracao_null', 'chatbot_joana', 'IMIGRACAO_NULL', 'Sem data para imigar', 0, 'slate', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_joana_imigracao_longe', 'chatbot_joana', 'IMIGRACAO_LONGE', 'Data para imigrar longe', 1, 'amber', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_joana_imigracao_perto', 'chatbot_joana', 'IMIGRACAO_PERTO', 'Data para imigrar perto', 2, 'emerald', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_joana_video', 'chatbot_joana', 'VIDEO_CHAMADA_AGENDADA', 'Vídeo chamada agendada', 3, 'sky', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_joana_realizou', 'chatbot_joana', 'REALIZOU_VIDEO_CHAMADA', 'Realizou vídeo chamada', 4, 'violet', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_joana_contrato_enviado', 'chatbot_joana', 'AGUARDANDO_ASSINATURA', 'Contrato enviado', 5, 'orange', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_joana_contrato_assinado', 'chatbot_joana', 'CONTRATO_ASSINADO', 'Contrato assinado', 6, 'green', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Seed Bruna columns
INSERT INTO "crm_columns" ("id", "chatbot_id", "slug", "label", "sort_order", "tone", "pauses_bot", "created_at", "updated_at")
VALUES
  ('col_bruna_novo', 'chatbot_bruna', 'NOVO', 'Novo', 0, 'slate', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_bruna_em_atendimento', 'chatbot_bruna', 'EM_ATENDIMENTO', 'Em atendimento', 1, 'sky', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_bruna_qualificado', 'chatbot_bruna', 'QUALIFICADO', 'Qualificado', 2, 'emerald', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_bruna_encerrado', 'chatbot_bruna', 'ENCERRADO', 'Encerrado', 3, 'violet', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Seed Gabi columns
INSERT INTO "crm_columns" ("id", "chatbot_id", "slug", "label", "sort_order", "tone", "pauses_bot", "created_at", "updated_at")
VALUES
  ('col_gabi_novo', 'chatbot_gabi', 'NOVO', 'Novo', 0, 'slate', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_gabi_em_atendimento', 'chatbot_gabi', 'EM_ATENDIMENTO', 'Em atendimento', 1, 'sky', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_gabi_qualificado', 'chatbot_gabi', 'QUALIFICADO', 'Qualificado', 2, 'emerald', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('col_gabi_encerrado', 'chatbot_gabi', 'ENCERRADO', 'Encerrado', 3, 'violet', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Conversas Joana existentes: já passaram do menu e ficam na Joana
UPDATE "joana_conversations"
SET "chatbot_id" = 'chatbot_joana',
    "menu_sent" = true
WHERE "chatbot_id" IS NULL;
