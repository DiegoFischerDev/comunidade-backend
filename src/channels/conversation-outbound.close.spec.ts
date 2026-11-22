import { ChatbotChannel } from '@prisma/client';
import { pickAttendanceCloseTarget } from './conversation-outbound.service';

describe('pickAttendanceCloseTarget', () => {
  it('usa o canal da conversa com inbound mais recente', () => {
    const target = pickAttendanceCloseTarget(
      [
        {
          whatsappDigits: '351912345678',
          instagramUserId: null,
          activeChannel: ChatbotChannel.WHATSAPP,
          instance: 'wa-1',
          lastInboundAt: new Date('2026-01-01T10:00:00Z'),
          updatedAt: new Date('2026-01-02T10:00:00Z'),
        },
        {
          whatsappDigits: null,
          instagramUserId: 'ig-1',
          activeChannel: ChatbotChannel.INSTAGRAM,
          instance: null,
          lastInboundAt: new Date('2026-01-03T10:00:00Z'),
          updatedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ],
      { whatsappDigits: '351912345678', instagramUserId: 'ig-1' },
    );

    expect(target).toEqual({
      whatsappDigits: null,
      instagramUserId: 'ig-1',
      activeChannel: ChatbotChannel.INSTAGRAM,
      instance: null,
    });
  });

  it('sem conversa, envia pelo WhatsApp quando há número', () => {
    const target = pickAttendanceCloseTarget([], {
      whatsappDigits: '351912345678',
      instagramUserId: null,
    });

    expect(target?.activeChannel).toBe(ChatbotChannel.WHATSAPP);
    expect(target?.whatsappDigits).toBe('351912345678');
  });

  it('sem conversa nem WhatsApp, envia pelo Instagram', () => {
    const target = pickAttendanceCloseTarget([], {
      whatsappDigits: null,
      instagramUserId: 'ig-9',
    });

    expect(target?.activeChannel).toBe(ChatbotChannel.INSTAGRAM);
    expect(target?.instagramUserId).toBe('ig-9');
  });
});
