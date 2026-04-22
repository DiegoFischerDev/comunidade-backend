import { IsIn } from 'class-validator';
import { PartnerReactionType } from '@prisma/client';

export class SetPartnerReactionDto {
  @IsIn(
    [PartnerReactionType.LIKE, PartnerReactionType.DISLIKE, null] as [
      PartnerReactionType,
      PartnerReactionType,
      null,
    ],
    { message: 'A reação deve ser gosto, desgosto ou anular (null).' },
  )
  type: 'LIKE' | 'DISLIKE' | null;
}
