import { parseJobOfferRouteId } from './job-offer-resolve-id.util';

describe('parseJobOfferRouteId', () => {
  it('interpreta números como publicNumber', () => {
    expect(parseJobOfferRouteId('12')).toEqual({
      kind: 'publicNumber',
      value: '12',
    });
  });

  it('interpreta cuid como internalId', () => {
    expect(parseJobOfferRouteId('cmpwftmxk000vp001fdwysqfy')).toEqual({
      kind: 'internalId',
      value: 'cmpwftmxk000vp001fdwysqfy',
    });
  });
});
