import { IsIn } from 'class-validator';

export class UpdateUserTierDto {
  @IsIn(['VISITOR', 'MEMBER'])
  tier: 'VISITOR' | 'MEMBER';
}
