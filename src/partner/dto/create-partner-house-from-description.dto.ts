import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Multipart: apenas descrição (+ ficheiros de mídia); campos do imóvel vêm da OpenAI. */
export class CreatePartnerHouseFromDescriptionDto {
  @IsString({ message: 'A descrição deve ser texto.' })
  @MinLength(20, {
    message: 'A descrição deve ter pelo menos 20 caracteres para a IA extrair os dados.',
  })
  @MaxLength(8000, { message: 'A descrição não pode ter mais de 8000 caracteres.' })
  description!: string;

  @IsOptional()
  @IsString()
  coverImageIndex?: string;
}
