import { JobOfferRegion } from '@prisma/client';
import {
  resolveJobOfferRegionFromCity,
  shouldPublishOfferToRoute,
} from './job-offer-region.util';

describe('resolveJobOfferRegionFromCity', () => {
  it('classifica cidades do Norte', () => {
    expect(resolveJobOfferRegionFromCity('Porto')).toBe('NORTE');
    expect(resolveJobOfferRegionFromCity('Barcelos')).toBe('NORTE');
  });

  it('classifica cidades do Centro', () => {
    expect(resolveJobOfferRegionFromCity('Coimbra')).toBe('CENTRO');
    expect(resolveJobOfferRegionFromCity('Aveiro')).toBe('CENTRO');
  });

  it('classifica cidades do Sul', () => {
    expect(resolveJobOfferRegionFromCity('Lisboa')).toBe('SUL');
    expect(resolveJobOfferRegionFromCity('Faro')).toBe('SUL');
    expect(resolveJobOfferRegionFromCity('Funchal')).toBe('SUL');
  });

  it('cidade desconhecida fica no Sul por omissão', () => {
    expect(resolveJobOfferRegionFromCity('Paris')).toBe('SUL');
  });
});

describe('shouldPublishOfferToRoute', () => {
  it('rota sem filtro publica tudo', () => {
    expect(shouldPublishOfferToRoute('SUL', null)).toBe(true);
  });

  it('rota Norte só aceita Norte', () => {
    expect(shouldPublishOfferToRoute('NORTE', 'NORTE')).toBe(true);
    expect(shouldPublishOfferToRoute('SUL', 'NORTE')).toBe(false);
  });
});
