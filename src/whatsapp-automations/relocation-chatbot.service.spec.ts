import { BadRequestException } from '@nestjs/common';
import { WhatsappDailyContactReply } from '@prisma/client';
import { RelocationChatbotService } from './relocation-chatbot.service';
import { RELOCATION_FIRST_CONTACT_MESSAGE } from './relocation-chatbot.util';

describe('RelocationChatbotService', () => {
  const whatsapp = '351912345678';

  beforeEach(() => {
    process.env.RELOCATION_CHATBOT_INSTANCE = 'comunidade MEO';
  });

  function setup() {
    const row = {
      id: 'c1',
      dayKey: '2026-11-17',
      whatsappDigits: whatsapp,
      instance: 'comunidade MEO',
      displayName: 'Ana',
      firstMessageAt: new Date('2026-11-17T09:00:00.000Z'),
      greetedAt: null as Date | null,
      reply: WhatsappDailyContactReply.PENDING,
      repliedAt: null as Date | null,
      crmAddedAt: null as Date | null,
    };

    const prisma = {
      whatsappDailyContact: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          ...row,
          ...data,
        })),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...row,
          ...data,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const wa = {
      sendText: jest.fn().mockResolvedValue(undefined),
      getContactDisplayName: jest.fn().mockResolvedValue(null),
    };
    const crm = {
      createCrmClient: jest.fn().mockResolvedValue({ id: 'booking' }),
    };

    const service = new RelocationChatbotService(
      prisma as never,
      wa as never,
      crm as never,
    );

    return { service, prisma, wa, crm, row };
  }

  it('no primeiro contacto do dia envia bom dia e a pergunta', async () => {
    const { service, wa, prisma } = setup();

    const result = await service.handleDailyContact({
      whatsapp,
      text: 'Olá',
      instance: 'comunidade MEO',
      pushName: 'Ana',
    });

    expect(result).toEqual({ handled: true, status: 'greeted' });
    expect(wa.sendText).toHaveBeenCalledWith(
      whatsapp,
      RELOCATION_FIRST_CONTACT_MESSAGE,
      expect.objectContaining({ preferredInstance: 'comunidade MEO' }),
    );
    expect(prisma.whatsappDailyContact.create).toHaveBeenCalled();
  });

  it('ignora outra instância', async () => {
    const { service, wa } = setup();
    const result = await service.handleDailyContact({
      whatsapp,
      text: 'Olá',
      instance: 'outra',
    });
    expect(result.status).toBe('ignored_instance');
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it('com «1» adiciona o lead à coluna sem data para imigrar', async () => {
    const { service, prisma, wa, crm, row } = setup();
    prisma.whatsappDailyContact.findUnique.mockResolvedValue({
      ...row,
      greetedAt: new Date(),
    });

    const result = await service.handleDailyContact({
      whatsapp,
      text: '1',
      instance: 'comunidade MEO',
      pushName: 'Ana',
    });

    expect(result).toEqual({ handled: true, status: 'added_to_crm' });
    expect(crm.createCrmClient).toHaveBeenCalledWith({
      name: 'Ana',
      whatsapp,
    });
    expect(wa.sendText).toHaveBeenCalled();
  });

  it('com «2» não cria cliente no CRM', async () => {
    const { service, prisma, crm, row } = setup();
    prisma.whatsappDailyContact.findUnique.mockResolvedValue({
      ...row,
      greetedAt: new Date(),
    });

    const result = await service.handleDailyContact({
      whatsapp,
      text: '2 - não',
      instance: 'comunidade MEO',
    });

    expect(result).toEqual({ handled: true, status: 'declined' });
    expect(crm.createCrmClient).not.toHaveBeenCalled();
  });

  it('se o cliente já está no CRM, confirma sem falhar', async () => {
    const { prisma, row } = setup();
    prisma.whatsappDailyContact.findUnique.mockResolvedValue({
      ...row,
      greetedAt: new Date(),
    });
    const wa = {
      sendText: jest.fn().mockResolvedValue(undefined),
      getContactDisplayName: jest.fn(),
    };
    const crm = {
      createCrmClient: jest
        .fn()
        .mockRejectedValue(
          new BadRequestException('Este cliente já está no CRM.'),
        ),
    };
    const service = new RelocationChatbotService(
      prisma as never,
      wa as never,
      crm as never,
    );

    const result = await service.handleDailyContact({
      whatsapp,
      text: '1',
      instance: 'comunidade MEO',
    });

    expect(result.status).toBe('already_in_crm');
    expect(crm.createCrmClient).toHaveBeenCalled();
    expect(wa.sendText).toHaveBeenCalled();
  });
});
