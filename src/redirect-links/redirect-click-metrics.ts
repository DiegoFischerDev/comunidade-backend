import type { Prisma } from '@prisma/client';

/**
 * Países cujo tráfego não entra nas métricas de cliques (ex.: crawler Google nos EUA).
 * Corresponde a «País: Estados Unidos (US)» no admin.
 */
export const REDIRECT_CLICK_IGNORED_COUNTRY_CODES = ['US'] as const;

export function isIgnoredRedirectClickCountry(
  code: string | null | undefined,
): boolean {
  if (!code) return false;
  const c = code.trim().toUpperCase();
  return (REDIRECT_CLICK_IGNORED_COUNTRY_CODES as readonly string[]).includes(c);
}

/** Filtro Prisma para contagens e listagens de cliques «reais». */
export function redirectClickMetricsFilter(): Prisma.RedirectClickEventWhereInput {
  return {
    OR: [
      { visitorCountryCode: null },
      {
        visitorCountryCode: {
          notIn: [...REDIRECT_CLICK_IGNORED_COUNTRY_CODES],
        },
      },
    ],
  };
}

export function mergeRedirectClickMetricsWhere(
  where: Prisma.RedirectClickEventWhereInput,
): Prisma.RedirectClickEventWhereInput {
  const metrics = redirectClickMetricsFilter();
  return { AND: [where, metrics] };
}
