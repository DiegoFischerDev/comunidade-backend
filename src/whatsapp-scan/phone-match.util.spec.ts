import {
  canonicalPhoneDigits,
  phonesMatchMonitored,
  phoneMatchVariants,
} from './phone-match.util';

describe('phone-match.util', () => {
  it('canonicaliza móvel PT sem indicativo', () => {
    expect(canonicalPhoneDigits('912345678')).toBe('351912345678');
    expect(canonicalPhoneDigits('351912345678')).toBe('351912345678');
  });

  it('cruza variantes 351 vs local', () => {
    expect(phonesMatchMonitored('351912345678', ['912345678'])).toBe(true);
    expect(phonesMatchMonitored('912345678', ['351912345678'])).toBe(true);
  });

  it('não confunde números diferentes', () => {
    expect(phonesMatchMonitored('351912345678', ['351987654321'])).toBe(
      false,
    );
  });

  it('ignora LID numérico longo (sem match útil)', () => {
    const lid = '232134862233733';
    expect(phoneMatchVariants(lid).has('351912345678')).toBe(false);
  });
});
