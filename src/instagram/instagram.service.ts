import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  InstagramInboundMessage,
  InstagramUserProfile,
  InstagramWebhookPayload,
} from './instagram.types';

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  /** Cache curto para não bater na Graph em cada DM do mesmo IGSID. */
  private readonly profileCache = new Map<
    string,
    { at: number; profile: InstagramUserProfile | null }
  >();
  private static readonly PROFILE_CACHE_MS = 6 * 60 * 60 * 1000;

  /** Verify token configurado no painel Meta (hub.verify_token). */
  getWebhookVerifyToken(): string {
    return process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() ?? '';
  }

  getAppSecret(): string {
    return process.env.META_APP_SECRET?.trim() ?? '';
  }

  getPageAccessToken(): string {
    return process.env.INSTAGRAM_PAGE_ACCESS_TOKEN?.trim() ?? '';
  }

  getConfiguredIgBusinessAccountId(): string {
    return process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim() ?? '';
  }

  /**
   * Validação do webhook Meta (GET).
   * Devolve o challenge se o token coincidir; senão null.
   */
  verifyWebhookSubscription(
    mode: string | undefined,
    verifyToken: string | undefined,
    challenge: string | undefined,
  ): string | null {
    const expected = this.getWebhookVerifyToken();
    if (!expected) {
      this.logger.error('INSTAGRAM_WEBHOOK_VERIFY_TOKEN não está definido');
      return null;
    }
    if (mode !== 'subscribe' || !verifyToken || !challenge) {
      return null;
    }
    if (verifyToken !== expected) {
      this.logger.warn('Verify token do webhook Instagram inválido');
      return null;
    }
    return challenge;
  }

  /**
   * Confirma X-Hub-Signature-256 (HMAC SHA256 do body raw com META_APP_SECRET).
   */
  isValidSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const appSecret = this.getAppSecret();
    if (!appSecret) {
      this.logger.error('META_APP_SECRET não está definido — a rejeitar webhook');
      return false;
    }
    if (!signatureHeader?.startsWith('sha256=')) {
      return false;
    }
    const expectedHex = signatureHeader.slice('sha256='.length);
    const digest = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    try {
      const a = Buffer.from(digest, 'utf8');
      const b = Buffer.from(expectedHex, 'utf8');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  parseInboundMessages(payload: InstagramWebhookPayload): InstagramInboundMessage[] {
    if (payload.object !== 'instagram' || !Array.isArray(payload.entry)) {
      return [];
    }

    const configuredIg = this.getConfiguredIgBusinessAccountId();
    const out: InstagramInboundMessage[] = [];

    for (const entry of payload.entry) {
      const igBusinessAccountId = entry.id?.trim() ?? '';
      if (
        configuredIg &&
        igBusinessAccountId &&
        igBusinessAccountId !== configuredIg
      ) {
        this.logger.warn(
          `Webhook IG ignorado: account ${igBusinessAccountId} ≠ ${configuredIg}`,
        );
        continue;
      }

      for (const event of entry.messaging ?? []) {
        const message = event.message;
        if (!message || message.is_echo) continue;
        const text = message.text?.trim() ?? '';
        if (!text) continue;

        const instagramUserId = event.sender?.id?.trim() ?? '';
        const externalMessageId = message.mid?.trim() ?? '';
        if (!instagramUserId || !externalMessageId) continue;

        out.push({
          channel: 'instagram',
          instagramUserId,
          igBusinessAccountId:
            igBusinessAccountId ||
            event.recipient?.id?.trim() ||
            configuredIg,
          externalMessageId,
          text,
          timestampMs: event.timestamp ?? Date.now(),
          raw: event,
        });
      }
    }

    return out;
  }

  /**
   * Valida assinatura e devolve DMs de texto. O controller encaminha ao router.
   */
  async handleWebhookRaw(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<{
    ok: boolean;
    messages: InstagramInboundMessage[];
  }> {
    if (!this.isValidSignature(rawBody, signatureHeader)) {
      this.logger.warn('Assinatura Instagram webhook inválida');
      return { ok: false, messages: [] };
    }

    let payload: InstagramWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as InstagramWebhookPayload;
    } catch {
      this.logger.warn('Body Instagram webhook não é JSON válido');
      return { ok: false, messages: [] };
    }

    const messages = this.parseInboundMessages(payload);
    for (const msg of messages) {
      const profile = await this.fetchUserProfile(msg.instagramUserId);
      if (profile) {
        msg.profileName = profile.name;
        msg.profileUsername = profile.username;
        msg.profilePicUrl = profile.profilePicUrl;
      }
      this.logger.log(
        `IG DM de ${msg.profileUsername || msg.instagramUserId}: ${msg.text.slice(0, 80)}`,
      );
    }

    return { ok: true, messages };
  }

  /**
   * O webhook só traz o IGSID. Nome e @username vêm do User Profile API
   * (consentimento implícito quando a pessoa envia DM).
   */
  async fetchUserProfile(
    instagramUserId: string,
  ): Promise<InstagramUserProfile | null> {
    const igsid = instagramUserId.trim();
    if (!igsid) return null;

    const cached = this.profileCache.get(igsid);
    if (
      cached &&
      Date.now() - cached.at < InstagramService.PROFILE_CACHE_MS
    ) {
      return cached.profile;
    }

    const token = this.getPageAccessToken();
    if (!token) {
      this.logger.warn('INSTAGRAM_PAGE_ACCESS_TOKEN em falta — sem perfil IG');
      return null;
    }

    const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || 'v21.0';
    const url =
      `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(igsid)}` +
      `?fields=name,username,profile_pic&access_token=${encodeURIComponent(token)}`;

    try {
      const res = await fetch(url);
      const body = await res.text();
      if (!res.ok) {
        this.logger.warn(
          `Perfil IG ${igsid} falhou (${res.status}): ${body.slice(0, 240)}`,
        );
        this.profileCache.set(igsid, { at: Date.now(), profile: null });
        return null;
      }
      const parsed = JSON.parse(body) as {
        name?: unknown;
        username?: unknown;
        profile_pic?: unknown;
      };
      const name =
        typeof parsed.name === 'string' && parsed.name.trim()
          ? parsed.name.trim().slice(0, 80)
          : null;
      const username =
        typeof parsed.username === 'string' && parsed.username.trim()
          ? parsed.username.trim().replace(/^@+/, '').slice(0, 119)
          : null;
      const profilePicUrl =
        typeof parsed.profile_pic === 'string' &&
        /^https?:\/\//i.test(parsed.profile_pic.trim())
          ? parsed.profile_pic.trim()
          : null;
      const profile = { name, username, profilePicUrl };
      this.profileCache.set(igsid, { at: Date.now(), profile });
      return profile;
    } catch (err: unknown) {
      this.logger.warn(
        `Perfil IG ${igsid}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Envia texto via Instagram Messaging API (Graph).
   * Requer INSTAGRAM_PAGE_ACCESS_TOKEN.
   */
  async sendText(recipientIgUserId: string, text: string): Promise<void> {
    const token = this.getPageAccessToken();
    if (!token) {
      throw new Error('INSTAGRAM_PAGE_ACCESS_TOKEN não está definido');
    }
    const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || 'v21.0';
    const url = `https://graph.facebook.com/${apiVersion}/me/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientIgUserId },
        message: { text },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Falha ao enviar DM IG (${res.status}): ${body}`);
      throw new Error(`Instagram sendText failed: ${res.status}`);
    }
  }
}
