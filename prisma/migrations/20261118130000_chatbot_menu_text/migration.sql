-- CreateTable
CREATE TABLE "chatbot_router_settings" (
    "id" TEXT NOT NULL,
    "menu_text" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbot_router_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "chatbot_router_settings" ("id", "menu_text", "updated_at")
VALUES (
  'default',
  E'Olá! Sou a equipa virtual da Rafa. Diz-me o que precisas, ou escolhe o número do assunto:\n\n1 — Relocation / aluguel\n2 — Crédito imobiliário / compra de casa\n3 — Publicidade com a Rafa\n\nPodes responder com o número ou em texto livre (ex.: «publicidade», «quero alugar»).',
  CURRENT_TIMESTAMP
);
