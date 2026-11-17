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
  const joana = {
    bufferInbound: jest.fn(),
    noteScriptedExchange: jest.fn(),
    acceptVoiceNote: jest.fn(),
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
    return new WhatsappAutomationsService(prisma as never, {} as never, joana as never);
  }

  it('ignora áudio fora da instância da Joana', async () => {
    const result = await service().handleInbound({
      senderNumber: '351912345678',
      text: '',
      kind: 'audio',
      instance: 'outra',
      externalMessageId: 'MSG1',
    });
    expect(result.status).toBe('ignored_audio');
    expect(joana.acceptVoiceNote).not.toHaveBeenCalled();
  });

  it('entrega a nota à Joana sem procurar gatilho', async () => {
    joana.acceptVoiceNote.mockResolvedValue({ handled: true, status: 'buffered' });
    const result = await service().handleInbound({
      senderNumber: '351912345678',
      text: '',
      kind: 'audio',
      instance: 'comunidade MEO',
      externalMessageId: 'MSG2',
      pushName: 'Ana',
    });
    expect(result.status).toBe('buffered');
    expect(joana.acceptVoiceNote).toHaveBeenCalledWith({
      whatsapp: '351912345678',
      instance: 'comunidade MEO',
      pushName: 'Ana',
      externalMessageId: 'MSG2',
    });
    expect(prisma.whatsappClientAutomation.findMany).not.toHaveBeenCalled();
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
