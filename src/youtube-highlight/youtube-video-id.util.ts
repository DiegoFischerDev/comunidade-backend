/** IDs de vídeo têm 11 carateres (base64url). */
const YT_ID_RE = /^[\w-]{11}$/;

/**
 * Extrai o ID de um URL do YouTube (watch, youtu.be, embed, shorts) ou de um ID em texto.
 */
export function extractYouTubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (YT_ID_RE.test(raw)) return raw;
  const toParse = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(toParse);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const seg = u.pathname.split('/').filter(Boolean)[0]?.split('?')[0];
      return seg && YT_ID_RE.test(seg) ? seg : null;
    }
    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'www.youtube.com'
    ) {
      const p = u.pathname;
      if (p.startsWith('/embed/')) {
        const id = p.split('/').filter(Boolean)[1]?.split('?')[0];
        return id && YT_ID_RE.test(id) ? id : null;
      }
      if (p.startsWith('/shorts/')) {
        const id = p.split('/').filter(Boolean)[1]?.split('?')[0];
        return id && YT_ID_RE.test(id) ? id : null;
      }
      const v = u.searchParams.get('v');
      if (v && YT_ID_RE.test(v)) return v;
    }
  } catch {
    /* inválido */
  }
  return null;
}

export function youtubeHqDefaultThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}
