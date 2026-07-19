import {
  getJobOfferListPublishedFrom,
  getJobOfferRetentionCutoff,
} from './job-offer-published-window.util';

describe('job-offer-published-window', () => {
  it('listagem inclui até 3 dias civis atrás', () => {
    const from = getJobOfferListPublishedFrom();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expected = new Date(today);
    expected.setDate(expected.getDate() - 3);
    expect(from.getTime()).toBe(expected.getTime());
  });

  it('retenção usa 15 dias', () => {
    const cutoff = getJobOfferRetentionCutoff();
    const expected = new Date();
    expected.setDate(expected.getDate() - 15);
    expect(Math.abs(cutoff.getTime() - expected.getTime())).toBeLessThan(2000);
  });
});
