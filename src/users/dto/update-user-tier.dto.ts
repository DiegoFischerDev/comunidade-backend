import { IsIn } from 'class-validator';

export class UpdateUserTierDto {
  @IsIn(['MEMBER'])
  tier: 'MEMBER';
}
