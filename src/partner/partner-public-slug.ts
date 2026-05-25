import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';

/** Segmentos da app que não podem ser URL pública de parceiro. */
export const RESERVED_PARTNER_PUBLIC_SLUGS = new Set(
  [
    'api',
    '_next',
    'dashboard',
    'login',
    'registro',
    'casas',
    'partner',
    'privacidade',
    'whatsapp',
    'link',
    'lead-redirect',
    'imovel',
    'psp',
    'plano-de-imigracao',
    'relocation',
    'servicos',
    'agendamento',
    'favicon.ico',
    'robots.txt',
    'sitemap.xml',
  ].map((s) => s.toLowerCase()),
);

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugifyPartnerNameBase(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return base || 'parceiro';
}

/** Slug público estável: base do nome + sufixo curto derivado do id (unicidade). */
export function buildDefaultPublicSlug(name: string, partnerId: string): string {
  const suffix = createHash('md5')
    .update(partnerId)
    .digest('hex')
    .slice(0, 6);
  const base = slugifyPartnerNameBase(name);
  return `${base}-${suffix}`.slice(0, 100);
}

export function normalizePartnerPublicSlugInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function assertPartnerPublicSlugAllowed(slug: string): void {
  if (slug.length < 4 || slug.length > 80) {
    throw new BadRequestException(
      'O endereço público deve ter entre 4 e 80 caracteres (letras minúsculas, números e hífens).',
    );
  }
  if (!SLUG_REGEX.test(slug)) {
    throw new BadRequestException(
      'O endereço público só pode usar letras minúsculas, números e hífens (sem espaços).',
    );
  }
  if (RESERVED_PARTNER_PUBLIC_SLUGS.has(slug)) {
    throw new BadRequestException('Este endereço público não está disponível. Escolhe outro.');
  }
}
