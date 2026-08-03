/**
 * Categorias de parceiro — constantes do projeto (substituem o antigo model `ProductCategory`
 * geríveis pelo admin). Há 3 categorias fixas: `relocation`, `financiamento` e `outras`.
 *
 * No DB, `Partner.categorySlug` é uma string opcional cujo valor é um dos slugs abaixo. A
 * validação é feita ao nível da aplicação (via `isPartnerCategorySlug`) — não há FK nem
 * tabela auxiliar.
 */

export const PARTNER_CATEGORIES = [
  { slug: 'relocation', name: 'Relocation' },
  { slug: 'financiamento', name: 'Financiamento' },
  { slug: 'outras', name: 'Outras' },
] as const;

export type PartnerCategorySlug = (typeof PARTNER_CATEGORIES)[number]['slug'];

const SLUG_SET: ReadonlySet<string> = new Set(PARTNER_CATEGORIES.map((c) => c.slug));

export const PARTNER_CATEGORY_SLUGS: readonly PartnerCategorySlug[] = PARTNER_CATEGORIES.map(
  (c) => c.slug,
);

export function isPartnerCategorySlug(value: unknown): value is PartnerCategorySlug {
  return typeof value === 'string' && SLUG_SET.has(value);
}

export function partnerCategoryName(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const match = PARTNER_CATEGORIES.find((c) => c.slug === slug);
  return match ? match.name : null;
}

/** Slug da categoria Relocation — exportado em constante para uso direto nas queries. */
export const RELOCATION_CATEGORY_SLUG: PartnerCategorySlug = 'relocation';

/** Slug da categoria Financiamento (intermediárias de crédito). */
export const FINANCIAMENTO_CATEGORY_SLUG: PartnerCategorySlug = 'financiamento';
