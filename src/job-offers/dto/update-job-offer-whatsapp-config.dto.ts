import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateJobOfferWhatsappConfigDto {
  @IsOptional()
  @IsString()
  @Matches(/@(g\.us|newsletter)$/i, {
    message: 'JID inválido (deve terminar em @g.us ou @newsletter).',
  })
  @MaxLength(120)
  sourceGroupJid?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  sourceTitle?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/@(g\.us|newsletter)$/i, {
    message: 'JID inválido (deve terminar em @g.us ou @newsletter).',
  })
  @MaxLength(120)
  destGroupJid?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  destTitle?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  monitoredNumbers?: string[];

  @IsOptional()
  @IsBoolean()
  monitorAllMembers?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
