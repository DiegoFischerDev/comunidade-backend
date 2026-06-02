import { JobOfferRegion } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateJobOfferWhatsappRouteDto {
  @IsString()
  @Matches(/@g\.us$/i, {
    message: 'JID inválido (deve terminar em @g.us).',
  })
  @MaxLength(120)
  sourceGroupJid!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  sourceTitle?: string;

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
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  monitoredNumbers?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  monitorAllMembers?: boolean;

  /** Ex.: NORTE — só republica vagas dessa região no destino. Omitir = todas as regiões. */
  @IsOptional()
  @IsEnum(JobOfferRegion)
  publishRegion?: JobOfferRegion;
}
