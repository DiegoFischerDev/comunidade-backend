import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  name: string;

  /** `whatsapp`: obrigatório se `contactMethod` for `email` */
  @ValidateIf((o) => o.contactMethod === 'email')
  @IsString()
  @MinLength(8, { message: 'Indique um WhatsApp válido com indicativo.' })
  whatsapp?: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres' })
  password: string;

  @IsIn(['email', 'whatsapp'])
  contactMethod: 'email' | 'whatsapp';

  @IsOptional()
  @IsString()
  affiliateCode?: string;
}
