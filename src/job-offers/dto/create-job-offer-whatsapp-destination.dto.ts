import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateJobOfferWhatsappDestinationDto {
  @IsString()
  @Matches(/@g\.us$/i, {
    message: 'JID inválido (deve terminar em @g.us).',
  })
  @MaxLength(120)
  destGroupJid!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  destTitle?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
