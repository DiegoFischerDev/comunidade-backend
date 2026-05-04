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
    return { mime: 'video/quicktime', fileName: 'video.mov' };
  }
  if (lower.endsWith('.webm')) {
    return { mime: 'video/webm', fileName: 'video.webm' };
  }
  if (lower.endsWith('.3gp')) {
    return { mime: 'video/3gpp', fileName: 'video.3gp' };
  }
  return { mime: 'video/mp4', fileName: 'video.mp4' };
}
