/** Limite do endpoint de transcrição da OpenAI. */
export const JOANA_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

export const JOANA_AUDIO_UNHEARD =
  'Não consegui ouvir o áudio. Pode escrever ou mandar de novo?';

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};

export function decodeWhatsappAudio(
  base64: string,
  maxBytes = JOANA_AUDIO_MAX_BYTES,
):
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: 'empty' | 'too_large' } {
  const stripped = String(base64 || '')
    .replace(/^data:[^,]*,/i, '')
    .replace(/\s+/g, '');
  if (!stripped) return { ok: false, reason: 'empty' };
  if (Math.floor((stripped.length * 3) / 4) > maxBytes) {
    return { ok: false, reason: 'too_large' };
  }
  const bytes = Buffer.from(stripped, 'base64');
  if (!bytes.length) return { ok: false, reason: 'empty' };
  if (bytes.length > maxBytes) return { ok: false, reason: 'too_large' };
  return { ok: true, bytes };
}

/** Nome e MIME que a OpenAI aceita. Nota de voz do WhatsApp cai em ogg. */
export function whatsappAudioFileName(
  mimeType: string,
  fileName?: string,
): { name: string; mime: string } {
  const mime = (mimeType || '').split(';')[0].trim().toLowerCase();
  const ext = AUDIO_EXTENSIONS[mime] || 'ogg';
  const cleanMime = AUDIO_EXTENSIONS[mime] ? mime : 'audio/ogg';
  const provided = (fileName || '').trim();
  if (provided && /\.[a-z0-9]{2,5}$/i.test(provided)) {
    return { name: provided.slice(0, 80), mime: cleanMime };
  }
  return { name: `nota.${ext}`, mime: cleanMime };
}
