/**
 * Principais cidades de Portugal — valores canónicos em `partner_house.city`.
 * Manter alinhado com `frontend/src/lib/relocation-portugal-cities.ts`.
 */
export const PARTNER_HOUSE_RELOCATION_CITIES = [
  'Lisboa',
  'Porto',
  'Braga',
  'Coimbra',
  'Faro',
  'Setúbal',
  'Aveiro',
  'Leiria',
  'Viseu',
  'Guimarães',
  'Évora',
  'Santarém',
  'Castelo Branco',
  'Beja',
  'Bragança',
  'Vila Real',
  'Portimão',
  'Cascais',
  'Matosinhos',
  'Funchal',
  'Ponta Delgada',
  'Almada',
  'Amadora',
  'Oeiras',
  'Sintra',
  'Barreiro',
  'Seixal',
  'Loures',
  'Vila Nova de Gaia',
  'Maia',
  'Gondomar',
  'Santa Maria da Feira',
  'Espinho',
  'Ovar',
  'Figueira da Foz',
  'Caldas da Rainha',
  'Torres Vedras',
  'Peniche',
  'Nazaré',
  'Tomar',
  'Abrantes',
  'Covilhã',
  'Guarda',
  'Elvas',
  'Estremoz',
  'Sines',
  'Lagos',
  'Tavira',
  'Albufeira',
  'Vila Franca de Xira',
  'Chaves',
  'Mirandela',
  'Peso da Régua',
  'Lamego',
  'Amarante',
  'Barcelos',
  'Famalicão',
  'Póvoa de Varzim',
  'Vila do Conde',
  'Trofa',
  'Valongo',
  'Oliveira de Azeméis',
  'Águeda',
  'Ílhavo',
  'Anadia',
  'Mealhada',
  'Montemor-o-Velho',
  'Pombal',
  'Ourém',
  'Entroncamento',
  'Almeirim',
  'Cartaxo',
  'Rio Maior',
  'Alcobaça',
  'Marinha Grande',
  'Sesimbra',
  'Palmela',
  'Montijo',
  'Grândola',
  'Odemira',
  'São Pedro do Sul',
] as const;

const LEGACY_TO_CANONICAL: Record<string, (typeof PARTNER_HOUSE_RELOCATION_CITIES)[number]> = {
  LISBOA: 'Lisboa',
  PORTO: 'Porto',
  BRAGA: 'Braga',
  COIMBRA: 'Coimbra',
  AVEIRO: 'Aveiro',
  FARO: 'Faro',
  EVORA: 'Évora',
  VISEU: 'Viseu',
};

const CANONICAL_TO_LEGACY: Partial<Record<string, string>> = {};
for (const [legacy, canon] of Object.entries(LEGACY_TO_CANONICAL)) {
  CANONICAL_TO_LEGACY[canon] = legacy;
}

/** Inclui sinónimos legados para filtrar anúncios antigos. */
export function expandRelocationCityFilter(input: string): string[] {
  const t = input.trim();
  if (!t) return [];
  const variants = new Set<string>([t]);
  const fromLegacy = LEGACY_TO_CANONICAL[t];
  if (fromLegacy) variants.add(fromLegacy);
  const legacy = CANONICAL_TO_LEGACY[t];
  if (legacy) variants.add(legacy);
  return [...variants];
}
