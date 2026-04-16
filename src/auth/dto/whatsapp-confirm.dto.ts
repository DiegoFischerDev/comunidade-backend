import { IsString, MinLength } from 'class-validator';

export class WhatsappConfirmDto {
  @IsString()
  @MinLength(4)
  code: string;

  /** Apenas dígitos, indicativo incluído (ex.: 351915433973) */
  @IsString()
  @MinLength(8)
  whatsapp: string;
}
