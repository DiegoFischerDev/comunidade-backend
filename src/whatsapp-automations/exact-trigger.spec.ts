import {
  findExactTrigger,
  scriptedStepText,
  WhatsappAutomationsService,
} from './whatsapp-automations.service';

describe('findExactTrigger', () => {
  const items = [
    { name: 'Boas Vindas', triggerPhrase: 'Quero fazer o relocation com o Rafa' },
    { name: 'Outra', triggerPhrase: 'Pode me explicar o serviço de relocation' },
  ];

  it('aceita a mesma frase com maiúsculas e espaços diferentes', () => {
    const found = findExactTrigger(
      items,
      '  quero   fazer o relocation com o rafa  ',
    );
    expect(found?.name).toBe('Boas Vindas');
  });

  it('deixa passar uma mensagem que só contém o gatilho', () => {
    const found = findExactTrigger(
      items,
      'quero fazer o relocation com o rafa e saber o preço',
    );
    expect(found).toBeNull();
  });
});

describe('handleInbound nota de voz', () => {
  const chatbots = {
    bufferInbound: jest.fn(),
    noteScriptedExchange: jest.fn(),
    acceptVoiceNote: jest.fn(),
  };
  const crm = {
    attachWhatsappInboundFile: jest.fn(),
  };
  const wa = {
    getMediaBase64: jest.fn(),
  };
  const prisma = {
    whatsappClientAutomation: { findMany: jest.fn() },
  };
  const previous = process.env.JOANA_WHATSAPP_INSTANCE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JOANA_WHATSAPP_INSTANCE = 'comunidade MEO';
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.JOANA_WHATSAPP_INSTANCE;
    else process.env.JOANA_WHATSAPP_INSTANCE = previous;
  });

  function service() {
    return new WhatsappAutomationsService(
      prisma as never,
      wa as never,
      chatbots as never,
      crm as never,
    );
  }

  it('ignora áudio fora da instância dos chatbots', async () => {
    const result = await service().handleInbound({
      senderNumber: '351912345678',
      text: '',
      kind: 'audio',
      instance: 'outra',
      externalMessageId: 'MSG1',
    });
    expect(result.status).toBe('ignored_audio');
    expect(chatbots.acceptVoiceNote).not.toHaveBeenCalled();
  });

  it('entrega a nota ao router sem procurar gatilho', async () => {
    chatbots.acceptVoiceNote.mockResolvedValue({ handled: true, status: 'buffered' });
    const result = await service().handleInbound({
      senderNumber: '351912345678',
      text: '',
      kind: 'audio',
      instance: 'comunidade MEO',
      externalMessageId: 'MSG2',
      pushName: 'Ana',
    });
    expect(result.status).toBe('buffered');
    expect(chatbots.acceptVoiceNote).toHaveBeenCalledWith({
      whatsapp: '351912345678',
      instance: 'comunidade MEO',
      pushName: 'Ana',
      externalMessageId: 'MSG2',
    });
    expect(prisma.whatsappClientAutomation.findMany).not.toHaveBeenCalled();
  });
});

describe('handleInbound imagem/documento CRM', () => {
  const chatbots = {
    bufferInbound: jest.fn(),
    noteScriptedExchange: jest.fn(),
    acceptVoiceNote: jest.fn(),
  };
  const crm = {
    attachWhatsappInboundFile: jest.fn(),
  };
  const wa = {
    getMediaBase64: jest.fn(),
  };
  const prisma = {
    whatsappClientAutomation: { findMany: jest.fn() },
  };
  const previous = process.env.JOANA_WHATSAPP_INSTANCE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JOANA_WHATSAPP_INSTANCE = 'comunidade MEO';
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.JOANA_WHATSAPP_INSTANCE;
    else process.env.JOANA_WHATSAPP_INSTANCE = previous;
  });

  function service() {
    return new WhatsappAutomationsService(
      prisma as never,
      wa as never,
      chatbots as never,
      crm as never,
    );
  }

  it('ignora imagem fora da instância dos chatbots', async () => {
    const result = await service().handleInbound({
      senderNumber: '351912345678',
      kind: 'image',
      instance: 'outra',
      externalMessageId: 'IMG1',
    });
    expect(result.status).toBe('ignored_media');
    expect(wa.getMediaBase64).not.toHaveBeenCalled();
  });

  it('descarrega e anexa imagem ao CRM', async () => {
    wa.getMediaBase64.mockResolvedValue({
      base64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
      mimetype: 'image/jpeg',
      fileName: 'foto.jpg',
    });
    crm.attachWhatsappInboundFile.mockResolvedValue({
      ok: true,
      status: 'attached',
      document: { fileName: 'foto.jpg' },
    });

    const result = await service().handleInbound({
      senderNumber: '351912345678',
      kind: 'image',
      instance: 'comunidade MEO',
      externalMessageId: 'IMG2',
      mediaMessage: { key: { id: 'IMG2' } },
    });

    expect(result.status).toBe('attached');
    expect(wa.getMediaBase64).toHaveBeenCalledWith('comunidade MEO', 'IMG2', {
      convertToMp4: false,
      message: { key: { id: 'IMG2' } },
    });
    expect(crm.attachWhatsappInboundFile).toHaveBeenCalled();
    expect(chatbots.bufferInbound).not.toHaveBeenCalled();
  });

  it('anexa documento e bufferiza a legenda no router', async () => {
    wa.getMediaBase64.mockResolvedValue({
      base64: Buffer.from('%PDF-1.4').toString('base64'),
      mimetype: 'application/pdf',
      fileName: 'doc.pdf',
    });
    crm.attachWhatsappInboundFile.mockResolvedValue({
      ok: true,
      status: 'attached',
    });
    chatbots.bufferInbound.mockResolvedValue({ handled: true, status: 'buffered' });

    const result = await service().handleInbound({
      senderNumber: '351912345678',
      text: 'segue o meu passaporte',
      kind: 'document',
      instance: 'comunidade MEO',
      externalMessageId: 'DOC1',
    });

    expect(result.status).toBe('attached+buffered');
    expect(chatbots.bufferInbound).toHaveBeenCalledWith({
      whatsapp: '351912345678',
      text: 'segue o meu passaporte',
      instance: 'comunidade MEO',
      pushName: undefined,
      externalMessageId: 'DOC1',
    });
  });
});

describe('scriptedStepText', () => {
  it('junta os textos pela ordem e ignora passos sem texto', () => {
    const text = scriptedStepText([
      { sortOrder: 2, textContent: 'Qual a tipologia?' },
      { sortOrder: 0, textContent: 'Qual a cidade?' },
      { sortOrder: 1, textContent: '   ' },
    ]);
    expect(text).toBe('Qual a cidade?\n\nQual a tipologia?');
  });
});
