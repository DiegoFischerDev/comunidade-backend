import type { Request } from 'express';
import * as geoip from 'geoip-lite';

const ISO2 = /^[A-Z]{2}$/;

function normalizeCountryHeader(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const c = val.trim().toUpperCase();
  if (c.length !== 2 || !ISO2.test(c)) return null;
  if (c === 'XX' || c === 'T1') return null;
  return c;
}

function stripIpv4MappedPrefix(ip: string): string {
  return ip.replace(/^::ffff:/i, '');
}

export function getClientIp(req: Request): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    const first = xff.split(',')[0]?.trim();
    if (first) return stripIpv4MappedPrefix(first);
  }
  const cfConn = req.headers['cf-connecting-ip'];
  if (typeof cfConn === 'string' && cfConn.trim()) {
    return stripIpv4MappedPrefix(cfConn.trim());
  }
  const trueClient = req.headers['true-client-ip'];
  if (typeof trueClient === 'string' && trueClient.trim()) {
    return stripIpv4MappedPrefix(trueClient.trim());
  }
  const ra = req.socket?.remoteAddress;
  if (ra) return stripIpv4MappedPrefix(ra);
  return undefined;
}

/**
 * País do visitante (ISO2): cabeçalhos de edge (Cloudflare, Vercel, CloudFront)
 * ou, em último caso, base de dados offline geoip-lite pelo IP de ligação.
 */
export function getCountryCodeFromRequest(req: Request): string | null {
  const fromCf = normalizeCountryHeader(req.headers['cf-ipcountry']);
  if (fromCf) return fromCf;
  const fromVercel = normalizeCountryHeader(req.headers['x-vercel-ip-country']);
  if (fromVercel) return fromVercel;
  const fromAws = normalizeCountryHeader(req.headers['cloudfront-viewer-country']);
  if (fromAws) return fromAws;

  const ip = getClientIp(req);
  if (!ip || ip === '::1' || ip === '127.0.0.1') return null;

  try {
    const hit = geoip.lookup(ip);
    if (hit?.country && ISO2.test(hit.country.toUpperCase())) {
      return hit.country.toUpperCase();
    }
  } catch {
    /* falha de lookup */
  }
  return null;
}