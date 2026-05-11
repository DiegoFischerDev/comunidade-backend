/** Base pública da API (links a `/uploads/...` consumidos pela Evolution). */
export function publicApiBase(): string {
  return (process.env.PUBLIC_API_BASE_URL || 'http://localhost:3001').replace(
    /\/$/,
    '',
  );
}

/** Evolution precisa de URL http(s) acessível a partir do servidor da Evolution. */
export function toAbsoluteMediaUrl(stored: string): string {
  const u = stored.trim();
  if (!u) return '';
  if (u.startsWith('https://') || u.startsWith('http://')) return u;
  const base = publicApiBase();
  return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
}

export function videoMimeFromStoredUrl(url: string): { mime: string; fileName: string } {
  const lower = url.split('?')[0]!.toLowerCase();
  if (lower.endsWith('.mov')) {
    // Mesmo binário ISO; Evolution/WhatsApp falham muitas vezes com quicktime + .mov
    return { mime: 'video/mp4', fileName: 'video.mp4' };
  }
  if (lower.endsWith('.webm')) {
    return { mime: 'video/webm', fileName: 'video.webm' };
  }
  if (lower.endsWith('.3gp')) {
    return { mime: 'video/3gpp', fileName: 'video.3gp' };
  }
  if (lower.endsWith('.m4v')) {
    return { mime: 'video/mp4', fileName: 'video.m4v' };
  }
  return { mime: 'video/mp4', fileName: 'video.mp4' };
}

function mapHttpVideoContentType(
  ct: string,
): { mime: string; fileName: string } | null {
  const m = ct.split(';')[0]!.trim().toLowerCase();
  if (!m.startsWith('video/')) return null;
  if (m === 'video/quicktime') {
    return { mime: 'video/mp4', fileName: 'video.mp4' };
  }
  if (m === 'video/webm') {
    return { mime: 'video/webm', fileName: 'video.webm' };
  }
  if (m === 'video/3gpp' || m === 'video/3gp') {
    return { mime: 'video/3gpp', fileName: 'video.3gp' };
  }
  if (m === 'video/mp4' || m === 'video/x-m4v' || m === 'video/m4v') {
    return { mime: 'video/mp4', fileName: 'video.mp4' };
  }
  return null;
}

/**
 * MIME/nome para Evolution: usa Content-Type do armazenamento (HEAD) quando possível,
 * para coincidir com o que foi gravado no R2/disco; senão deduz pela extensão na URL.
 */
export async function videoMimeForEvolutionSend(absUrl: string): Promise<{
  mime: string;
  fileName: string;
}> {
  const fallback = videoMimeFromStoredUrl(absUrl);
  const u = absUrl.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    return fallback;
  }
  try {
    const ac = new AbortController();
    const id = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(u, { method: 'HEAD', signal: ac.signal, redirect: 'follow' });
    clearTimeout(id);
    if (!res.ok) return fallback;
    const raw = res.headers.get('content-type');
    if (!raw) return fallback;
    const mapped = mapHttpVideoContentType(raw);
    return mapped ?? fallback;
  } catch {
    return fallback;
  }
}
