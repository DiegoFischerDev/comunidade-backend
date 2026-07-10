/** Dias que um imóvel oculto aguarda antes de ir automaticamente para a lixeira. */
export const HOUSE_HIDDEN_TO_TRASH_DAYS = 3;
/** Dias que um imóvel fica na lixeira antes de ser excluído (com mídia) automaticamente. */
export const HOUSE_TRASH_TO_DELETE_DAYS = 10;

export function isHousePubliclyVisible(house: {
  publicationStatus: string;
}): boolean {
  return house.publicationStatus === 'PUBLISHED';
}
