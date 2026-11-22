import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync } from 'fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { promisify } from 'util';
import { toAbsoluteMediaUrl } from '../common/public-media-url';
import {
  localPathFromUploadUrl,
  uploadsDir,
} from '../uploads/channel-media.util';
import type {
  InstagramInboundMessage,
  InstagramUserProfile,
  InstagramWebhookPayload,
} from './instagram.types';

const execFileAsync = promisify(execFile);

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  /** Cache curto para não bater na Graph em cada DM do mesmo IGSID. */
  private readonly profileCache = new Map<
    string,
    { at: number; profile: InstagramUserProfile | null }
  >();
  private static readonly PROFILE_CACHE_MS = 6 * 60 * 60 * 1000;
  /** Cache URL pública M4A gerada a partir de OGG/etc. */
  private readonly publicM4aBySource = new Map<
    string,
    { url: string; at: number }
  >();
  /** Cache attachment_id Meta (`type:url`) para reutilizar no Direct. */
  private readonly metaAttachmentByKey = new Map<
    string,
    { id: string; at: number }
  >();
  private static readonly ATTACHMENT_CACHE_MS = 24 * 60 * 60 * 1000;

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

  getPageId(): string {
    return process.env.INSTAGRAM_PAGE_ID?.trim() ?? '';
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
        const audioUrl = audioAttachmentUrl(message.attachments);
        if (!text && !audioUrl) continue;

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
          audioUrl,
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
        `IG DM de ${msg.profileUsername || msg.instagramUserId}: ${
          msg.audioUrl && !msg.text ? '[áudio]' : msg.text.slice(0, 80)
        }`,
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
    await this.postMessage(recipientIgUserId, { text });
  }

  /**
   * Envia anexo no Direct.
   * Áudio e PDF: upload para a Meta → envio por `attachment_id` (bolha nativa no chat).
   * Imagem/vídeo: URL directa (preview no chat).
   * Áudio OGG/Opus → M4A público antes do upload (IG não aceita ogg).
   */
  async sendAttachment(params: {
    recipientIgUserId: string;
    type: 'image' | 'audio' | 'file' | 'video';
    mediaUrl: string;
    isReusable?: boolean;
  }): Promise<void> {
    let mediaUrl = params.mediaUrl.trim();
    if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) {
      throw new Error('Instagram sendAttachment: mediaUrl http(s) inválida');
    }

    if (params.type === 'audio' && isInstagramUnsupportedAudioUrl(mediaUrl)) {
      mediaUrl = await this.ensurePublicM4aUrl(mediaUrl);
      this.logger.log(`IG áudio convertido para URL pública: ${mediaUrl}`);
    }

    // Áudio + PDF: ficheiro nativo no chat (evita o IG abrir o browser com a URL).
    if (params.type === 'audio' || params.type === 'file') {
      const attachmentId = await this.uploadAttachmentFromPublicUrl({
        type: params.type,
        mediaUrl,
      });
      try {
        await this.postMessage(params.recipientIgUserId, {
          attachment: {
            type: params.type,
            payload: { attachment_id: attachmentId },
          },
        });
      } catch (err: unknown) {
        // Algumas contas IG pedem MEDIA_SHARE + attachment_id após o upload.
        this.logger.warn(
          `IG send ${params.type} via type nativo falhou; a tentar MEDIA_SHARE: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await this.postMessage(params.recipientIgUserId, {
          attachment: {
            type: 'MEDIA_SHARE',
            payload: { attachment_id: attachmentId },
          },
        });
      }
      return;
    }

    await this.postMessage(params.recipientIgUserId, {
      attachment: {
        type: params.type,
        payload: {
          url: mediaUrl,
          is_reusable: params.isReusable === false ? 'false' : 'true',
        },
      },
    });
  }

  /**
   * Sobe media para a Meta via URL pública e devolve `attachment_id`.
   * Usa JSON (não multipart) — o campo `is_reusable` vai em `payload` como string.
   */
  private async uploadAttachmentFromPublicUrl(input: {
    type: 'audio' | 'image' | 'file' | 'video';
    mediaUrl: string;
  }): Promise<string> {
    const cacheKey = `${input.type}:${input.mediaUrl}`;
    const cached = this.metaAttachmentByKey.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.at < InstagramService.ATTACHMENT_CACHE_MS
    ) {
      return cached.id;
    }

    const token = this.getPageAccessToken();
    const pageId = this.getPageId() || 'me';
    if (!token) {
      throw new Error('INSTAGRAM_PAGE_ACCESS_TOKEN não está definido');
    }
    const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || 'v21.0';
    const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pageId)}/message_attachments`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'instagram',
        message: {
          attachment: {
            type: input.type,
            payload: {
              url: input.mediaUrl,
              is_reusable: 'true',
            },
          },
        },
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      this.logger.error(
        `Falha upload anexo IG (${res.status}): ${body.slice(0, 400)}`,
      );
      throw new Error(`Instagram uploadAttachment failed: ${res.status}`);
    }
    let parsed: { attachment_id?: unknown };
    try {
      parsed = JSON.parse(body) as { attachment_id?: unknown };
    } catch {
      throw new Error('Instagram uploadAttachment: resposta inválida');
    }
    const id =
      typeof parsed.attachment_id === 'string'
        ? parsed.attachment_id.trim()
        : '';
    if (!id) {
      throw new Error('Instagram uploadAttachment: sem attachment_id');
    }
    this.metaAttachmentByKey.set(cacheKey, { id, at: Date.now() });
    this.logger.log(
      `IG attachment_id obtido (${input.type}): ${id.slice(0, 12)}…`,
    );
    return id;
  }

  /**
   * Converte áudio remoto/local para M4A em `uploads/` e devolve URL http(s) pública.
   */
  private async ensurePublicM4aUrl(sourceUrl: string): Promise<string> {
    const cached = this.publicM4aBySource.get(sourceUrl);
    if (
      cached &&
      Date.now() - cached.at < InstagramService.ATTACHMENT_CACHE_MS
    ) {
      return cached.url;
    }

    await mkdir(uploadsDir(), { recursive: true });

    const localSource = resolveLocalUploadPath(sourceUrl);
    let outName: string;
    let outPath: string;

    if (localSource) {
      const base = basename(localSource);
      const stem = base.includes('.')
        ? base.slice(0, base.lastIndexOf('.'))
        : base;
      outName = `${stem}.ig.m4a`;
      outPath = join(uploadsDir(), outName);
      if (!existsSync(outPath)) {
        await execFileAsync(
          'ffmpeg',
          [
            '-y',
            '-i',
            localSource,
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-vn',
            outPath,
          ],
          { timeout: 90_000 },
        );
      }
    } else {
      outName = `${Date.now()}-ig-audio.m4a`;
      outPath = join(uploadsDir(), outName);
      const m4a = await this.convertRemoteAudioToM4a(sourceUrl);
      await writeFile(outPath, m4a);
    }

    const publicUrl = toAbsoluteMediaUrl(`/uploads/${outName}`);
    this.publicM4aBySource.set(sourceUrl, {
      url: publicUrl,
      at: Date.now(),
    });
    return publicUrl;
  }

  private async convertRemoteAudioToM4a(sourceUrl: string): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'ig-audio-'));
    const inputPath = join(dir, 'input');
    const outputPath = join(dir, 'output.m4a');
    try {
      const res = await fetch(sourceUrl);
      if (!res.ok) {
        throw new Error(`download áudio IG falhou (${res.status})`);
      }
      await writeFile(inputPath, Buffer.from(await res.arrayBuffer()));
      await execFileAsync(
        'ffmpeg',
        ['-y', '-i', inputPath, '-c:a', 'aac', '-b:a', '128k', '-vn', outputPath],
        { timeout: 60_000 },
      );
      return await readFile(outputPath);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async postMessage(
    recipientIgUserId: string,
    message: Record<string, unknown>,
  ): Promise<void> {
    const token = this.getPageAccessToken();
    if (!token) {
      throw new Error('INSTAGRAM_PAGE_ACCESS_TOKEN não está definido');
    }
    const igsid = recipientIgUserId.trim();
    if (!igsid) {
      throw new Error('Instagram: recipient IGSID em falta');
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
        recipient: { id: igsid },
        message,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Falha ao enviar DM IG (${res.status}): ${body}`);
      throw new Error(`Instagram sendMessage failed: ${res.status}`);
    }
  }

  /** Descarrega um anexo temporário da Meta (nota de voz). */
  async downloadAttachment(url: string): Promise<{
    base64: string;
    mimeType: string;
    fileName: string;
  }> {
    const target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      throw new Error('URL de áudio Instagram inválida');
    }
    const token = this.getPageAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(target, { headers });
    if (!res.ok) {
      throw new Error(`download áudio IG falhou (${res.status})`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new Error('Áudio Instagram vazio');
    if (bytes.length > 25 * 1024 * 1024) throw new Error('Áudio maior que 25 MB.');
    const mime = (res.headers.get('content-type') || 'audio/mp4').split(';')[0]!.trim();
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mpeg') ? 'mp3' : 'm4a';
    return {
      base64: bytes.toString('base64'),
      mimeType: mime || 'audio/mp4',
      fileName: `nota.${ext}`,
    };
  }
}

function audioAttachmentUrl(
  attachments: Array<{ type?: string; payload?: { url?: string } }> | undefined,
): string | null {
  if (!Array.isArray(attachments)) return null;
  for (const attachment of attachments) {
    const type = (attachment.type || '').toLowerCase();
    const url = attachment.payload?.url?.trim() || '';
    if (!url) continue;
    if (type === 'audio' || type === 'voice' || type.includes('audio')) return url;
  }
  return null;
}

function isInstagramUnsupportedAudioUrl(url: string): boolean {
  const path = url.split('?')[0]!.toLowerCase();
  return (
    path.endsWith('.ogg') ||
    path.endsWith('.opus') ||
    path.endsWith('.webm') ||
    path.includes('audio/ogg') ||
    path.includes('audio/opus')
  );
}

/** Se a URL aponta para o nosso `/uploads/…`, devolve o caminho local. */
function resolveLocalUploadPath(absOrRelativeUrl: string): string | null {
  const raw = absOrRelativeUrl.trim();
  if (!raw) return null;
  if (raw.startsWith('/uploads/')) {
    const local = localPathFromUploadUrl(raw);
    return local && existsSync(local) ? local : null;
  }
  try {
    const u = new URL(raw);
    if (!u.pathname.startsWith('/uploads/')) return null;
    const local = localPathFromUploadUrl(u.pathname);
    return local && existsSync(local) ? local : null;
  } catch {
    return null;
  }
}
