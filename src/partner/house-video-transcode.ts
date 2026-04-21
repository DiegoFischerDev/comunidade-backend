import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
  return fallback;
}

export function isHouseVideoTranscodeEnabled(): boolean {
  const v = process.env.HOUSE_VIDEO_TRANSCODE_ENABLED?.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') {
    return false;
  }
  return true;
}

/**
 * Reencoda para MP4 (H.264 + AAC), escala largura máx. e reduz bitrate — alinhado com o que o WhatsApp tolera melhor.
 * Devolve `null` se ffmpeg não existir, input pequeno demais, ou falha (usa-se o original).
 */
export async function transcodeVideoToWhatsappMp4(
  input: Buffer,
  sourceExtension: string,
): Promise<Buffer | null> {
  if (!isHouseVideoTranscodeEnabled()) return null;
  if (!ffmpegPath) return null;

  const minInput = parseEnvInt('HOUSE_VIDEO_TRANSCODE_MIN_INPUT_BYTES', 400_000);
  if (input.length <= minInput) return null;

  const maxW = parseEnvInt('HOUSE_VIDEO_MAX_WIDTH', 1280);
  const crf = Math.min(
    51,
    Math.max(18, parseEnvInt('HOUSE_VIDEO_CRF', 28)),
  );
  const audioK = Math.min(
    320,
    Math.max(64, parseEnvInt('HOUSE_VIDEO_AUDIO_KBPS', 96)),
  );
  const timeoutMs = parseEnvInt('HOUSE_VIDEO_FFMPEG_TIMEOUT_MS', 900_000);

  const ext =
    sourceExtension && sourceExtension.startsWith('.')
      ? sourceExtension.toLowerCase()
      : `.${sourceExtension || 'mp4'}`;

  const tmpRoot = await mkdtemp(join(tmpdir(), 'comunidade-vid-'));
  const inFile = join(tmpRoot, `in${ext}`);
  const outFile = join(tmpRoot, 'out.mp4');

  try {
    await writeFile(inFile, input);

    const vf = `scale=min(${maxW}\\,iw):-2`;
    const args: string[] = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-y',
      '-i',
      inFile,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      String(crf),
      '-vf',
      vf,
      '-c:a',
      'aac',
      '-b:a',
      `${audioK}k`,
      '-movflags',
      '+faststart',
      outFile,
    ];

    await execFileAsync(ffmpegPath, args, {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });

    const out = await readFile(outFile);
    if (!out.length) return null;

    // Se o “comprimido” for claramente maior, não vale a pena (mantém original no caller).
    if (out.length > input.length * 1.12) {
      return null;
    }

    return out;
  } catch {
    return null;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Extensão com ponto a partir do mime de vídeo de imóvel. */
export function extensionForHouseVideoMime(mime: string): string {
  const m = (mime || '').split(';')[0]!.trim().toLowerCase();
  if (m === 'video/quicktime') return '.mov';
  if (m === 'video/webm') return '.webm';
  if (m === 'video/3gpp') return '.3gp';
  return '.mp4';
}
