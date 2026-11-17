import { joanaDateInstruction, lisbonCivilDate } from './joana-openai.service';

describe('joanaDateInstruction', () => {
  it('em 17/11/2026, final de fevereiro é 2027', () => {
    const now = new Date('2026-11-17T12:00:00.000Z');
    expect(lisbonCivilDate(now).label).toBe('17/11/2026');
    const text = joanaDateInstruction(now);
    expect(text).toContain('Data de hoje em Lisboa: 17/11/2026.');
    expect(text).toContain('2027-02-28');
    expect(text).not.toContain('2024');
  });

  it('em janeiro, final de fevereiro ainda é deste ano', () => {
    const now = new Date('2027-01-10T12:00:00.000Z');
    expect(joanaDateInstruction(now)).toContain('2027-02-28');
  });
});
