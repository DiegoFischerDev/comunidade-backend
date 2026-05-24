export const HOUSE_PUBLICATION_COST_EUR_CENTS = 100;
export const HOUSE_PUBLICATION_DURATION_DAYS = 7;
export const ADVERTISING_TOPUP_MIN_EUR_CENTS = 500;
export const ADVERTISING_TOPUP_MAX_EUR_CENTS = 500_00;

export function addPublicationDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

/** Base para prolongar publicação: fim atual se ainda válido, senão agora. */
export function publicationExtensionBase(publishedUntil: Date | null | undefined): Date {
  const now = new Date();
  if (publishedUntil && publishedUntil > now) {
    return publishedUntil;
  }
  return now;
}

export function nextPublishedUntil(
  currentPublishedUntil: Date | null | undefined,
): Date {
  return addPublicationDays(
    publicationExtensionBase(currentPublishedUntil),
    HOUSE_PUBLICATION_DURATION_DAYS,
  );
}

export function isHousePubliclyVisible(house: {
  publicationStatus: string;
  publishedUntil: Date | null;
}): boolean {
  if (house.publicationStatus !== 'PUBLISHED') return false;
  if (!house.publishedUntil) return false;
  return house.publishedUntil > new Date();
}
