-- Valor novo do funil da Joana. Fica isolado: o Postgres só deixa usar
-- o valor depois de a transação que o cria terminar.
ALTER TYPE "RafaCallCrmStatus" ADD VALUE 'POTENCIAL_CLIENTE';
