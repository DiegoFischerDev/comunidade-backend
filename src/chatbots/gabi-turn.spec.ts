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
  it('pede empresa, Instagram e depois objectivo', () => {
    let profile = emptyGabiProfile();
    expect(nextGabiMissingField(profile)).toBe('companyName');

    profile = applyGabiProposal(profile, { companyName: 'Move Casa' });
    expect(nextGabiMissingField(profile)).toBe('instagramHandle');

    profile = applyGabiProposal(profile, { instagramHandle: 'nao tenho' });
    expect(nextGabiMissingField(profile)).toBe('campaignObjective');
    expect(profile.instagramHandle).toBe('');

    profile = applyGabiProposal(profile, {
      campaignObjective: 'Aumentar leads de relocation',
    });
    expect(nextGabiMissingField(profile)).toBeNull();
    expect(profile.campaignObjective).toBe('Aumentar leads de relocation');
  });

  it('resume a ficha', () => {
    const summary = gabiProfileSummary({
      companyName: 'Acme',
      instagramHandle: '@acme',
      campaignObjective: 'Brand awareness',
    });
    expect(summary).toContain('Acme');
    expect(summary).toContain('@acme');
    expect(summary).toContain('Brand awareness');
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
      '{"reply":"Perfeito","companyName":"Acme","instagramHandle":"@acme","campaignObjective":"Mais vendas"}',
    );
    expect(parsed.reply).toBe('Perfeito');
    expect(parsed.proposal.companyName).toBe('Acme');
    expect(parsed.proposal.instagramHandle).toBe('@acme');
    expect(parsed.proposal.campaignObjective).toBe('Mais vendas');
  });
});
