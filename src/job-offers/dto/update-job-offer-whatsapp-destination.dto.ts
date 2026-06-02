import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateJobOfferWhatsappDestinationDto {
  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @Matches(/@g\.us$/i, {
    message: 'JID inválido (deve terminar em @g.us).',
  })
  @MaxLength(120)
  destGroupJid?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  destTitle?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
