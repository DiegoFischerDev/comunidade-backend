/**
 * Resolução de ficheiros CRM (upload admin PDF + inbound WhatsApp imagem/documento).
 */

const IMAGE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const DOC_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/x-pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
};

const ALLOWED_EXTENSIONS = new Set([
  ...Object.keys(IMAGE_BY_EXT),
  ...Object.keys(DOC_BY_EXT),
]);

export type ResolvedCrmDocumentFile = {
  contentType: string;
  extension: string;
  fileName: string;
};

function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const match = base.match(/(\.[a-z0-9]{1,8})$/i);
  return match ? match[1]!.toLowerCase() : '';
}

export function sanitizeCrmDocumentFileName(
  originalName: string,
  fallbackExtension: string,
): string {
  const base =
    (originalName || `documento${fallbackExtension}`).split(/[/\\]/).pop() ??
    `documento${fallbackExtension}`;
  const cleaned = base
    .replace(/[^\p{L}\p{N}._\- ()]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  const ext = extensionOf(cleaned) || fallbackExtension;
  const stem =
    cleaned.replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '').trim() ||
    'documento';
  const safeExt = ALLOWED_EXTENSIONS.has(ext.toLowerCase())
    ? ext.toLowerCase()
    : fallbackExtension;
  return `${stem}${safeExt}`;
}

/** PDF do upload admin — exige cabeçalho %PDF. */
export function resolveCrmPdfUpload(params: {
  buffer: Buffer;
  mimeType?: string;
  fileName?: string;
}): ResolvedCrmDocumentFile | null {
  const buf = params.buffer;
  if (!buf?.length) return null;
  const mime = (params.mimeType || '').toLowerCase();
  const name = (params.fileName || '').toLowerCase();
  const looksPdf =
    mime === 'application/pdf' ||
    mime === 'application/x-pdf' ||
    name.endsWith('.pdf');
  if (!looksPdf) return null;
  const header = buf.subarray(0, 5).toString('ascii');
  if (!header.startsWith('%PDF')) return null;
  return {
    contentType: 'application/pdf',
    extension: '.pdf',
    fileName: sanitizeCrmDocumentFileName(params.fileName || '', '.pdf'),
  };
}

/**
 * Imagem (jpg/png/webp/gif), PDF ou documento de escritório comum.
 * Usado no inbound WhatsApp e no storage genérico.
 */
export function resolveCrmInboundFile(params: {
  buffer: Buffer;
  mimeType?: string;
  fileName?: string;
}): ResolvedCrmDocumentFile | null {
  const buf = params.buffer;
  if (!buf?.length) return null;

  const mimeRaw = (params.mimeType || '').toLowerCase().split(';')[0]!.trim();
  const name = params.fileName || '';
  const nameExt = extensionOf(name);

  let extension = '';
  let contentType = '';

  if (mimeRaw && MIME_TO_EXT[mimeRaw]) {
    extension = MIME_TO_EXT[mimeRaw]!;
    contentType =
      mimeRaw === 'image/jpg' || mimeRaw === 'application/x-pdf'
        ? mimeRaw === 'image/jpg'
          ? 'image/jpeg'
          : 'application/pdf'
        : mimeRaw;
  } else if (nameExt && IMAGE_BY_EXT[nameExt]) {
    extension = nameExt;
    contentType = IMAGE_BY_EXT[nameExt]!;
  } else if (nameExt && DOC_BY_EXT[nameExt]) {
    extension = nameExt;
    contentType = DOC_BY_EXT[nameExt]!;
  }

  if (!extension || !contentType) return null;

  if (extension === '.pdf') {
    const header = buf.subarray(0, 5).toString('ascii');
    if (!header.startsWith('%PDF')) return null;
    contentType = 'application/pdf';
  }

  if (extension === '.png') {
    const sig = buf.subarray(0, 8);
    const isPng =
      sig[0] === 0x89 &&
      sig[1] === 0x50 &&
      sig[2] === 0x4e &&
      sig[3] === 0x47;
    if (!isPng) return null;
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    contentType = 'image/jpeg';
    extension = '.jpg';
  }

  if (extension === '.gif') {
    const header = buf.subarray(0, 3).toString('ascii');
    if (header !== 'GIF') return null;
  }

  if (extension === '.webp') {
    const riff = buf.subarray(0, 4).toString('ascii');
    const webp = buf.subarray(8, 12).toString('ascii');
    if (riff !== 'RIFF' || webp !== 'WEBP') return null;
  }

  return {
    contentType,
    extension,
    fileName: sanitizeCrmDocumentFileName(name, extension),
  };
}
