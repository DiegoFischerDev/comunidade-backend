import { createHmac } from 'crypto';
import { InstagramService } from './instagram.service';

describe('InstagramService', () => {
  const keys = [
    'INSTAGRAM_WEBHOOK_VERIFY_TOKEN',
    'META_APP_SECRET',
    'INSTAGRAM_BUSINESS_ACCOUNT_ID',
    'INSTAGRAM_PAGE_ACCESS_TOKEN',
  ] as const;
  const previous: Partial<Record<(typeof keys)[number], string | undefined>> =
    {};

  beforeEach(() => {
    for (const key of keys) {
      previous[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function serviceWithEnv(env: Record<string, string>): InstagramService {
    Object.assign(process.env, env);
    return new InstagramService();
  }

  it('verifyWebhookSubscription devolve challenge com token correcto', () => {
    const svc = serviceWithEnv({
      INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'segredo-teste',
    });
    expect(
      svc.verifyWebhookSubscription('subscribe', 'segredo-teste', '12345'),
    ).toBe('12345');
  });

  it('verifyWebhookSubscription rejeita token errado', () => {
    const svc = serviceWithEnv({
      INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'segredo-teste',
    });
    expect(
      svc.verifyWebhookSubscription('subscribe', 'outro', '12345'),
    ).toBeNull();
  });

  it('isValidSignature aceita HMAC correcto', () => {
    const secret = 'app-secret';
    const svc = serviceWithEnv({ META_APP_SECRET: secret });
    const raw = Buffer.from('{"object":"instagram"}', 'utf8');
    const hex = createHmac('sha256', secret).update(raw).digest('hex');
    expect(svc.isValidSignature(raw, `sha256=${hex}`)).toBe(true);
  });

  it('parseInboundMessages extrai texto de DM e ignora ecos', () => {
    const svc = serviceWithEnv({
      INSTAGRAM_BUSINESS_ACCOUNT_ID: 'ig-biz-1',
    });
    const messages = svc.parseInboundMessages({
      object: 'instagram',
      entry: [
        {
          id: 'ig-biz-1',
          messaging: [
            {
              sender: { id: 'user-1' },
              recipient: { id: 'ig-biz-1' },
              timestamp: 1,
              message: { mid: 'm1', text: '  olá  ' },
            },
            {
              sender: { id: 'ig-biz-1' },
              recipient: { id: 'user-1' },
              timestamp: 2,
              message: { mid: 'm2', text: 'eco', is_echo: true },
            },
          ],
        },
      ],
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      channel: 'instagram',
      instagramUserId: 'user-1',
      externalMessageId: 'm1',
      text: 'olá',
    });
  });
});
