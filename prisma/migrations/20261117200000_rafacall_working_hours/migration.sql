-- Grelha semanal das videochamadas. A app cria a linha `default` na primeira leitura,
-- copiando RAFA_CALL_WORKING_HOURS_JSON. Depois, a página de agendamentos é a fonte.
CREATE TABLE "rafa_call_working_hours" (
    "id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    "hours" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rafa_call_working_hours_pkey" PRIMARY KEY ("id")
);
