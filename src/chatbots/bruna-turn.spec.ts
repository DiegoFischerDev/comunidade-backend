import {
  applyBrunaProposal,
  composeBrunaReply,
  emptyBrunaProfile,
  nextBrunaMissingField,
  parseBrunaModelJson,
  parseDesiredHouseValue,
} from './bruna-turn';

describe('parseDesiredHouseValue', () => {
  it('lê valores de compra em euros', () => {
    expect(parseDesiredHouseValue(250_000)).toBe(250_000);
    expect(parseDesiredHouseValue('€ 180.000')).toBe(180_000);
    expect(parseDesiredHouseValue('250000 euros')).toBe(250_000);
    expect(parseDesiredHouseValue('')).toBe('');
    expect(parseDesiredHouseValue('abc')).toBeUndefined();
    expect(parseDesiredHouseValue(6_000_000)).toBeUndefined();
  });
});

describe('bruna qualification order', () => {
  it('pede valor, cidades e tipologia', () => {
    let profile = emptyBrunaProfile();
    expect(nextBrunaMissingField(profile)).toBe('desiredHouseValue');

    profile = applyBrunaProposal(profile, { desiredHouseValue: 200_000 });
    expect(nextBrunaMissingField(profile)).toBe('preferredCities');

    profile = applyBrunaProposal(profile, { preferredCities: 'Porto, Braga' });
    expect(nextBrunaMissingField(profile)).toBe('propertyTypology');

    profile = applyBrunaProposal(profile, { propertyTypology: 'T2' });
    expect(nextBrunaMissingField(profile)).toBeNull();
    expect(profile.propertyTypology).toBe('T2');
  });
});

describe('composeBrunaReply', () => {
  it('acrescenta a pergunta em falta', () => {
    const reply = composeBrunaReply('Oi!', emptyBrunaProfile());
    expect(reply).toContain('Oi!');
    expect(reply).toContain('valor da casa');
  });
});

describe('parseBrunaModelJson', () => {
  it('lê proposal do JSON', () => {
    const parsed = parseBrunaModelJson(
      '{"reply":"Perfeito","desiredHouseValue":220000,"preferredCities":"Lisboa","propertyTypology":"T1"}',
    );
    expect(parsed.reply).toBe('Perfeito');
    expect(parsed.proposal.desiredHouseValue).toBe(220_000);
    expect(parsed.proposal.preferredCities).toBe('Lisboa');
    expect(parsed.proposal.propertyTypology).toBe('T1');
  });
});
