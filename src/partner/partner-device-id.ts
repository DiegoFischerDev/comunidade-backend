import { BadRequestException } from '@nestjs/common';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * UUID v4 enviado pelo browser (`X-Partner-Device-Id`), persistido em localStorage.
 */
export function requirePartnerDeviceId(raw: string | undefined): string {
  const s = raw?.trim();
  if (!s) {
    throw new BadRequestException(
      'Cabeçalho X-Partner-Device-Id em falta. Recarregue a página e tente novamente.',
    );
  }
  if (s.length > 64 || !UUID_V4.test(s)) {
    throw new BadRequestException('Identificador de dispositivo inválido.');
  }
  return s.toLowerCase();
}

/** Para leituras públicas: ignora vazio; valor inválido devolve null (não falha o pedido). */
export function tryPartnerDeviceId(raw: string | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (s.length > 64 || !UUID_V4.test(s)) return null;
  return s.toLowerCase();
}
