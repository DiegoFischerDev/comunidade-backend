/** Ofertas com `publishedAt` mais antigas que isto são removidas automaticamente. */
export const JOB_OFFER_RETENTION_DAYS = 15;

/**
 * Janela da listagem pública: hoje, ontem e «antes de ontem» (até 2 dias civis atrás).
 * Ofertas mais antigas só são acessíveis por link direto (até `JOB_OFFER_RETENTION_DAYS`).
 */
export const JOB_OFFER_LIST_MAX_AGE_DAYS = 2;
