import { getFrontendBaseUrl } from '../config/frontend-base-url';

/** Mensagem WhatsApp quando o saldo de publicidade do parceiro chega a 0. */
export function buildAdvertisingBalanceZeroWhatsAppText(partnerName?: string): string {
  const hostPath = getFrontendBaseUrl().replace(/^https?:\/\//i, '');
  const casasUrl = `${hostPath}/dashboard/casas`;
  const greeting = partnerName?.trim()
    ? `Olá ${partnerName.trim()},`
    : 'Olá,';
  return [
    '⚠️ *Saldo de publicidade esgotado*',
    '',
    greeting,
    '',
    'O teu saldo de publicidade chegou a *0 €*.',
    '',
    'O compartilhamento dos próximos imóveis só será possível depois de adicionares mais saldo em:',
    '',
    casasUrl,
    '',
    'Comunidade Rafa Portugal',
  ].join('\n');
}
