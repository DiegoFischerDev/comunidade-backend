import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';

export class CreateGuestMembershipCheckoutDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  whatsapp!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @MinLength(6)
  passwordConfirm!: string;

  @IsString()
  @IsUrl()
  successUrl!: string;

  @IsString()
  @IsUrl()
  cancelUrl!: string;

  @IsIn(['card', 'mbway', 'pix'])
  paymentMethod!: 'card' | 'mbway' | 'pix';

  @IsOptional()
  @IsString()
  affiliateCode?: string;
}
