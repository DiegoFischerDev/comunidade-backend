import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { copyFile, mkdir, writeFile } from 'fs/promises';
import { basename, extname, join } from 'path';
import { promisify } from 'util';
import type { JoanaWelcomeStep } from '../joana/joana-welcome';

const execFileAsync = promisify(execFile);

export type ChannelMediaKind = 'audio' | 'image' | 'document' | 'other';

export type PreparedChannelMedia = {
  /** URL canónica (preferência WhatsApp / original). */
  url: string;
  mediaUrlWhatsapp: string;
  mediaUrlInstagram: string;
  mediaMimeType: string;
  mediaMimeTypeWhatsapp: string;
  mediaMimeTypeInstagram: string;
  mediaFileName: string;
};

export function uploadsDir(): string {
  return join(process.cwd(), 'uploads');
}

/** Resolve caminho local a partir de `/uploads/ficheiro.ext`. */
export function localPathFromUploadUrl(url: string): string | null {
  const raw = url.trim().split('?')[0] || '';
  if (!raw.startsWith('/uploads/')) return null;
  const name = basename(raw);
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return null;
  }
  return join(uploadsDir(), name);
}

export function guessChannelMediaKind(
  mime: string,
  fileName: string,
): ChannelMediaKind {
  const m = mime.trim().toLowerCase();
  const n = fileName.trim().toLowerCase();
  if (m.startsWith('audio/') || /\.(ogg|opus|mp3|m4a|aac|wav|webm|mp4)$/i.test(n)) {
    return 'audio';
  }
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'document';
  if (m.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(n)) {
    return 'image';
  }
  return 'other';
}

function stemAndExt(fileName: string): { stem: string; ext: string } {
  const base = basename(fileName);
  const ext = extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return { stem: stem || String(Date.now()), ext: ext.toLowerCase() };
}

function isOggLike(pathOrUrl: string, mime?: string | null): boolean {
  const lower = pathOrUrl.split('?')[0]!.toLowerCase();
  const m = (mime || '').toLowerCase();
  return (
    lower.endsWith('.ogg') ||
    lower.endsWith('.opus') ||
    m.includes('ogg') ||
    m.includes('opus')
  );
}

function isM4aLike(pathOrUrl: string, mime?: string | null): boolean {
  const lower = pathOrUrl.split('?')[0]!.toLowerCase();
  const m = (mime || '').toLowerCase();
  return (
    lower.endsWith('.m4a') ||
    lower.endsWith('.aac') ||
    lower.endsWith('.mp4') ||
    m === 'audio/mp4' ||
    m === 'audio/aac' ||
    m === 'audio/x-m4a'
  );
}

function isJpegOrPng(pathOrUrl: string, mime?: string | null): boolean {
  const lower = pathOrUrl.split('?')[0]!.toLowerCase();
  const m = (mime || '').toLowerCase();
  return (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.png') ||
    m === 'image/jpeg' ||
    m === 'image/png'
  );
}

async function ffmpegToOggOpus(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    ['-y', '-i', inputPath, '-c:a', 'libopus', '-b:a', '64k', '-vn', outputPath],
    { timeout: 90_000 },
  );
}

async function ffmpegToM4a(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    ['-y', '-i', inputPath, '-c:a', 'aac', '-b:a', '128k', '-vn', outputPath],
    { timeout: 90_000 },
  );
}

async function ffmpegToJpeg(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    ['-y', '-i', inputPath, '-q:v', '2', outputPath],
    { timeout: 30_000 },
  );
}

/**
 * A partir de um ficheiro já gravado em `uploads/`, gera variantes
 * WhatsApp (Ogg Opus / JPEG|PNG / PDF) e Instagram (M4A / JPEG|PNG / PDF).
 */
export async function prepareChannelMediaFromLocalFile(input: {
  absolutePath: string;
  originalName: string;
  mimeType?: string;
}): Promise<PreparedChannelMedia> {
  await mkdir(uploadsDir(), { recursive: true });
  const mime = (input.mimeType || '').trim();
  const fileName = input.originalName || basename(input.absolutePath);
  const kind = guessChannelMediaKind(mime, fileName);
  const { stem } = stemAndExt(basename(input.absolutePath));

  if (kind === 'document') {
    const url = `/uploads/${basename(input.absolutePath)}`;
    return {
      url,
      mediaUrlWhatsapp: url,
      mediaUrlInstagram: url,
      mediaMimeType: 'application/pdf',
      mediaMimeTypeWhatsapp: 'application/pdf',
      mediaMimeTypeInstagram: 'application/pdf',
      mediaFileName: fileName.endsWith('.pdf') ? fileName : `${stem}.pdf`,
    };
  }

  if (kind === 'image') {
    let outName = basename(input.absolutePath);
    let outMime = mime || 'image/jpeg';
    if (!isJpegOrPng(outName, mime)) {
      outName = `${stem}.channel.jpg`;
      const outPath = join(uploadsDir(), outName);
      if (!existsSync(outPath)) {
        await ffmpegToJpeg(input.absolutePath, outPath);
      }
      outMime = 'image/jpeg';
    }
    const url = `/uploads/${outName}`;
    return {
      url,
      mediaUrlWhatsapp: url,
      mediaUrlInstagram: url,
      mediaMimeType: outMime,
      mediaMimeTypeWhatsapp: outMime,
      mediaMimeTypeInstagram: outMime,
      mediaFileName: fileName,
    };
  }

  if (kind === 'audio') {
    const sourceName = basename(input.absolutePath);
    const sourcePath = input.absolutePath;

    let waName: string;
    let waMime: string;
    if (isOggLike(sourceName, mime)) {
      waName = sourceName;
      waMime = 'audio/ogg';
    } else {
      waName = `${stem}.wa.ogg`;
      const waPath = join(uploadsDir(), waName);
      if (!existsSync(waPath)) {
        await ffmpegToOggOpus(sourcePath, waPath);
      }
      waMime = 'audio/ogg';
    }

    let igName: string;
    let igMime: string;
    if (isM4aLike(sourceName, mime)) {
      igName = sourceName;
      igMime = 'audio/mp4';
    } else {
      igName = `${stem}.ig.m4a`;
      const igPath = join(uploadsDir(), igName);
      if (!existsSync(igPath)) {
        await ffmpegToM4a(sourcePath, igPath);
      }
      igMime = 'audio/mp4';
    }

    const waUrl = `/uploads/${waName}`;
    const igUrl = `/uploads/${igName}`;
    return {
      url: waUrl,
      mediaUrlWhatsapp: waUrl,
      mediaUrlInstagram: igUrl,
      mediaMimeType: waMime,
      mediaMimeTypeWhatsapp: waMime,
      mediaMimeTypeInstagram: igMime,
      mediaFileName: fileName,
    };
  }

  // Fallback: mesmo ficheiro nos dois canais
  const url = `/uploads/${basename(input.absolutePath)}`;
  return {
    url,
    mediaUrlWhatsapp: url,
    mediaUrlInstagram: url,
    mediaMimeType: mime || 'application/octet-stream',
    mediaMimeTypeWhatsapp: mime || 'application/octet-stream',
    mediaMimeTypeInstagram: mime || 'application/octet-stream',
    mediaFileName: fileName,
  };
}

/**
 * Grava o buffer original e prepara variantes por canal.
 */
export async function prepareChannelMediaFromBuffer(input: {
  bytes: Buffer;
  originalName: string;
  mimeType?: string;
}): Promise<PreparedChannelMedia> {
  await mkdir(uploadsDir(), { recursive: true });
  const { stem, ext } = stemAndExt(input.originalName || 'file');
  const unique = `${Date.now()}-${stem.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'media'}`;
  const sourceName = `${unique}${ext || ''}`;
  const sourcePath = join(uploadsDir(), sourceName);
  await writeFile(sourcePath, input.bytes);
  return prepareChannelMediaFromLocalFile({
    absolutePath: sourcePath,
    originalName: input.originalName,
    mimeType: input.mimeType,
  });
}

/**
 * Se o passo só tem `mediaUrl` local, gera/preenche URLs WhatsApp + Instagram.
 * URLs remotas (http) ficam inalteradas — a conversão no envio cobre o IG.
 */
export async function enrichWelcomeStepChannelMedia(
  step: JoanaWelcomeStep,
): Promise<JoanaWelcomeStep> {
  if (step.type === 'TEXT') return step;

  const hasBoth =
    Boolean(step.mediaUrlWhatsapp?.trim()) &&
    Boolean(step.mediaUrlInstagram?.trim());
  if (hasBoth) return step;

  const sourceUrl = (
    step.mediaUrlWhatsapp ||
    step.mediaUrlInstagram ||
    step.mediaUrl ||
    ''
  ).trim();
  if (!sourceUrl) return step;

  const local = localPathFromUploadUrl(sourceUrl);
  if (!local || !existsSync(local)) {
    // Remoto ou ficheiro em falta: espelha mediaUrl nos dois campos se vazios
    return {
      ...step,
      mediaUrlWhatsapp: step.mediaUrlWhatsapp?.trim() || step.mediaUrl || null,
      mediaUrlInstagram: step.mediaUrlInstagram?.trim() || step.mediaUrl || null,
      mediaMimeTypeWhatsapp:
        step.mediaMimeTypeWhatsapp?.trim() || step.mediaMimeType || null,
      mediaMimeTypeInstagram:
        step.mediaMimeTypeInstagram?.trim() || step.mediaMimeType || null,
    };
  }

  try {
    const prepared = await prepareChannelMediaFromLocalFile({
      absolutePath: local,
      originalName: step.mediaFileName || basename(local),
      mimeType: step.mediaMimeType || undefined,
    });
    return {
      ...step,
      mediaUrl: prepared.url,
      mediaUrlWhatsapp: prepared.mediaUrlWhatsapp,
      mediaUrlInstagram: prepared.mediaUrlInstagram,
      mediaMimeType: prepared.mediaMimeType,
      mediaMimeTypeWhatsapp: prepared.mediaMimeTypeWhatsapp,
      mediaMimeTypeInstagram: prepared.mediaMimeTypeInstagram,
      mediaFileName: step.mediaFileName || prepared.mediaFileName,
    };
  } catch {
    return {
      ...step,
      mediaUrlWhatsapp: step.mediaUrlWhatsapp?.trim() || step.mediaUrl || null,
      mediaUrlInstagram: step.mediaUrlInstagram?.trim() || step.mediaUrl || null,
    };
  }
}

export async function enrichWelcomeStepsChannelMedia(
  steps: JoanaWelcomeStep[],
): Promise<JoanaWelcomeStep[]> {
  const out: JoanaWelcomeStep[] = [];
  for (const step of steps) {
    out.push(await enrichWelcomeStepChannelMedia(step));
  }
  return out;
}

/** Copia um upload simples (sem conversão) — útil quando ffmpeg falha. */
export async function copyUploadAsIs(
  absolutePath: string,
  targetName: string,
): Promise<string> {
  const dest = join(uploadsDir(), targetName);
  if (!existsSync(dest)) {
    await copyFile(absolutePath, dest);
  }
  return `/uploads/${targetName}`;
}
