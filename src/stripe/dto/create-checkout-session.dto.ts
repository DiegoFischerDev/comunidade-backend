import { IsString, IsUrl } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsString()
  @IsUrl()
  successUrl!: string;

  @IsString()
  @IsUrl()
  cancelUrl!: string;
}
