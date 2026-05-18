import { UserTier } from '@prisma/client';

export function isMembershipActive(
  tier: UserTier | string,
  membershipExpiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (tier !== UserTier.MEMBER && tier !== 'MEMBER') return false;
  if (!membershipExpiresAt) return false;
  const exp =
    membershipExpiresAt instanceof Date
      ? membershipExpiresAt
      : new Date(membershipExpiresAt);
  return !Number.isNaN(exp.getTime()) && exp > now;
}
