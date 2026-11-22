import { getFrontendBaseUrl } from '../config/frontend-base-url';

/** URL público de /agendar. No Instagram sem número, a página pede o WhatsApp. */
export function buildSchedulingLink(
  whatsapp?: string | null,
  name?: string | null,
): string {
  const base = getFrontendBaseUrl().replace(/\/$/, '');
  const params = new URLSearchParams();
  const digits = (whatsapp || '').replace(/\D/g, '');
  if (digits.length >= 8) params.set('whatsapp', digits);
  const clean = name?.trim();
  if (
    clean &&
    clean.length >= 2 &&
    !/^Lead\s+\d+$/i.test(clean) &&
    !/^Lead\s+IG\b/i.test(clean)
  ) {
    params.set('name', clean.slice(0, 80));
  }
  const qs = params.toString();
  return qs ? `${base}/agendar?${qs}` : `${base}/agendar`;
}

export function schedulingInviteText(link: string): string {
  return `Podes agendar a videochamada por aqui: ${link}`;
}
