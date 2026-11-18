import { JOANA_AUDIO_UNHEARD } from './joana-audio';
import { JoanaOpenAiService } from './joana-openai.service';
import { JoanaService } from './joana.service';

describe('JoanaOpenAiService.transcribeAudio', () => {
  const previous = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });

  it('não chama a OpenAI sem chave ou com áudio vazio', async () => {
    const service = new JoanaOpenAiService();
    delete process.env.OPENAI_API_KEY;
    await expect(service.transcribeAudio({ base64: 'YQ==' })).rejects.toThrow(
      /OPENAI_API_KEY/,
    );

    process.env.OPENAI_API_KEY = 'sk-test';
    await expect(service.transcribeAudio({ base64: '' })).rejects.toThrow(/vazio/);
  });
});

describe('JoanaService.acceptVoiceNote', () => {
  const previousInstance = process.env.JOANA_WHATSAPP_INSTANCE;

  beforeEach(() => {
    process.env.JOANA_WHATSAPP_INSTANCE = 'comunidade MEO';
  });

  afterEach(() => {
    if (previousInstance === undefined) delete process.env.JOANA_WHATSAPP_INSTANCE;
    else process.env.JOANA_WHATSAPP_INSTANCE = previousInstance;
  });

  it('pede para escrever quando a Evolution não devolve o áudio', async () => {
    const wa = {
      getMediaBase64: jest.fn().mockResolvedValue(null),
      sendText: jest.fn().mockResolvedValue(undefined),
    };
    const openai = { transcribeAudio: jest.fn() };
    const service = new JoanaService(
      {} as never,
      wa as never,
      { sendText: jest.fn() } as never,
      { isJoanaActive: jest.fn().mockResolvedValue(true) } as never,
      openai as never,
    );

    const result = await service.acceptVoiceNote({
      whatsapp: '351912345678',
      instance: 'comunidade MEO',
      externalMessageId: 'MSG1',
    });

    expect(result).toEqual({ handled: true, status: 'audio_unheard' });
    expect(openai.transcribeAudio).not.toHaveBeenCalled();
    expect(wa.sendText).toHaveBeenCalledWith('351912345678', JOANA_AUDIO_UNHEARD, {
      preferredInstance: 'comunidade MEO',
    });
  });

  it('grava a transcrição no mesmo buffer do texto', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      joanaConversation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create,
      },
    };
    const wa = {
      getMediaBase64: jest.fn().mockResolvedValue({
        base64: Buffer.from('audio').toString('base64'),
        mimetype: 'audio/ogg; codecs=opus',
        fileName: '',
      }),
      sendText: jest.fn(),
    };
    const openai = {
      transcribeAudio: jest.fn().mockResolvedValue('quero morar em Viseu'),
    };
    const service = new JoanaService(
      prisma as never,
      wa as never,
      { sendText: jest.fn() } as never,
      { isJoanaActive: jest.fn().mockResolvedValue(true) } as never,
      openai as never,
    );

    const result = await service.acceptVoiceNote({
      whatsapp: '351912345678',
      instance: 'comunidade MEO',
      pushName: 'Ana',
      externalMessageId: 'MSG1',
    });

    expect(result).toEqual({ handled: true, status: 'buffered' });
    expect(wa.sendText).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          whatsappDigits: '351912345678',
          buffer: [
            expect.objectContaining({
              id: 'MSG1',
              text: 'quero morar em Viseu',
            }),
          ],
        }),
      }),
    );
  });

  it('não responde quando a Joana está desligada para o número', async () => {
    const wa = {
      getMediaBase64: jest.fn(),
      sendText: jest.fn(),
    };
    const service = new JoanaService(
      {} as never,
      wa as never,
      { sendText: jest.fn() } as never,
      { isJoanaActive: jest.fn().mockResolvedValue(false) } as never,
      { transcribeAudio: jest.fn() } as never,
    );

    const result = await service.acceptVoiceNote({
      whatsapp: '351912345678',
      instance: 'comunidade MEO',
      externalMessageId: 'MSG1',
    });

    expect(result).toEqual({ handled: true, status: 'paused' });
    expect(wa.getMediaBase64).not.toHaveBeenCalled();
    expect(wa.sendText).not.toHaveBeenCalled();
  });
});
