import {
  resolveCrmInboundFile,
  resolveCrmPdfUpload,
  sanitizeCrmDocumentFileName,
} from './crm-document-file';

describe('sanitizeCrmDocumentFileName', () => {
  it('preserva extensão permitida', () => {
    expect(sanitizeCrmDocumentFileName('Passaporte.jpg', '.jpg')).toBe(
      'Passaporte.jpg',
    );
  });

  it('força extensão de fallback quando a original não é permitida', () => {
    expect(sanitizeCrmDocumentFileName('virus.exe', '.pdf')).toBe('virus.pdf');
  });
});

describe('resolveCrmPdfUpload', () => {
  it('aceita PDF com cabeçalho válido', () => {
    const buffer = Buffer.from('%PDF-1.4 resto');
    const resolved = resolveCrmPdfUpload({
      buffer,
      mimeType: 'application/pdf',
      fileName: 'contrato.pdf',
    });
    expect(resolved).toEqual({
      contentType: 'application/pdf',
      extension: '.pdf',
      fileName: 'contrato.pdf',
    });
  });

  it('rejeita ficheiro sem %PDF', () => {
    expect(
      resolveCrmPdfUpload({
        buffer: Buffer.from('not a pdf'),
        mimeType: 'application/pdf',
        fileName: 'x.pdf',
      }),
    ).toBeNull();
  });
});

describe('resolveCrmInboundFile', () => {
  it('aceita JPEG pelo mime', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const resolved = resolveCrmInboundFile({
      buffer,
      mimeType: 'image/jpeg',
      fileName: 'foto',
    });
    expect(resolved?.extension).toBe('.jpg');
    expect(resolved?.contentType).toBe('image/jpeg');
    expect(resolved?.fileName).toBe('foto.jpg');
  });

  it('aceita PNG pelo mime', () => {
    const buffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    const resolved = resolveCrmInboundFile({
      buffer,
      mimeType: 'image/png',
      fileName: 'scan.png',
    });
    expect(resolved?.extension).toBe('.png');
  });

  it('aceita PDF inbound', () => {
    const buffer = Buffer.from('%PDF-1.7 body');
    const resolved = resolveCrmInboundFile({
      buffer,
      mimeType: 'application/pdf',
      fileName: 'irs.pdf',
    });
    expect(resolved?.fileName).toBe('irs.pdf');
  });

  it('rejeita tipo não suportado', () => {
    expect(
      resolveCrmInboundFile({
        buffer: Buffer.from('hello'),
        mimeType: 'application/zip',
        fileName: 'x.zip',
      }),
    ).toBeNull();
  });
});
