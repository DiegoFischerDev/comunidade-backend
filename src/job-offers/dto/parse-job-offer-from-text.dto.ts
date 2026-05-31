import { IsString, MaxLength, MinLength } from 'class-validator';

export class ParseJobOfferFromTextDto {
  @IsString()
  @MinLength(20, { message: 'O texto deve ter pelo menos 20 caracteres.' })
  @MaxLength(50000, { message: 'O texto é demasiado longo (máx. 50000 caracteres).' })
  text: string;
}
