-- Renomeia o estado inicial do funil CRM (sem data de imigração definida).
ALTER TYPE "RafaCallCrmStatus" RENAME VALUE 'ENVIOU_MENSAGEM' TO 'IMIGRACAO_NULL';
