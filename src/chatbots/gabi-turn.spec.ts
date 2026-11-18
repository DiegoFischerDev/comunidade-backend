import {
  applyGabiProposal,
  composeGabiReply,
  emptyGabiProfile,
  gabiProfileSummary,
  nextGabiMissingField,
  normalizeInstagramHandle,
  parseGabiModelJson,
} from './gabi-turn';

describe('normalizeInstagramHandle', () => {
  it('normaliza com @', () => {
    expect(normalizeInstagramHandle('movecasa')).toBe('@movecasa');
    expect(normalizeInstagramHandle('@Move.Casa')).toBe('@Move.Casa');
  });

  it('marca sem Instagram', () => {
    expect(normalizeInstagramHandle('não tenho')).toBe('');
    expect(normalizeInstagramHandle('n/a')).toBe('');
    expect(normalizeInstagramHandle('')).toBe('');
  });
});

describe('gabi qualification order', () => {
  it('pede empresa e depois Instagram', () => {
    let profile = emptyGabiProfile();
    expect(nextGabiMissingField(profile)).toBe('companyName');

    profile = applyGabiProposal(profile, { companyName: 'Move Casa' });
    expect(nextGabiMissingField(profile)).toBe('instagramHandle');

    profile = applyGabiProposal(profile, { instagramHandle: 'nao tenho' });
    expect(nextGabiMissingField(profile)).toBeNull();
    expect(profile.instagramHandle).toBe('');
  });

  it('resume a ficha', () => {
    const summary = gabiProfileSummary({
      companyName: 'Acme',
      instagramHandle: '@acme',
    });
    expect(summary).toContain('Acme');
    expect(summary).toContain('@acme');
    expect(summary).toContain('nenhum');
  });
});

describe('composeGabiReply', () => {
  it('acrescenta a pergunta em falta', () => {
    const reply = composeGabiReply('Oi!', emptyGabiProfile());
    expect(reply).toContain('Oi!');
    expect(reply).toContain('nome da empresa');
  });
});

describe('parseGabiModelJson', () => {
  it('lê proposal do JSON', () => {
    const parsed = parseGabiModelJson(
      '{"reply":"Perfeito","companyName":"Acme","instagramHandle":"@acme"}',
    );
    expect(parsed.reply).toBe('Perfeito');
    expect(parsed.proposal.companyName).toBe('Acme');
    expect(parsed.proposal.instagramHandle).toBe('@acme');
  });
});
