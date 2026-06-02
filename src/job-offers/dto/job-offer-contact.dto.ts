import { IsIn, IsString, MinLength } from 'class-validator';

export class JobOfferContactDto {
  @IsIn(['email', 'phone', 'url'])
  type!: 'email' | 'phone' | 'url';

  @IsString()
  @MinLength(1)
  value!: string;
}
