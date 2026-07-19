/** Ofertas com `publishedAt` mais antigas que isto são removidas automaticamente. */
export const JOB_OFFER_RETENTION_DAYS = 15;

/**
 * Janela da listagem pública: até 3 dias civis atrás (filtros por cidade / carrosséis).
 * Ofertas mais antigas só são acessíveis por link direto (até `JOB_OFFER_RETENTION_DAYS`).
 */
export const JOB_OFFER_LIST_MAX_AGE_DAYS = 3;
