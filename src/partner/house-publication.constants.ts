export const HOUSE_PUBLICATION_DURATION_DAYS = 7;

/** Dias que um imóvel oculto aguarda antes de ir automaticamente para a lixeira. */
export const HOUSE_HIDDEN_TO_TRASH_DAYS = 3;
/** Dias que um imóvel fica na lixeira antes de ser excluído (com mídia) automaticamente. */
export const HOUSE_TRASH_TO_DELETE_DAYS = 10;

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
