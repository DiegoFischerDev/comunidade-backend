import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateScanGroupDto {
  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsString()
  @Matches(/@g\.us$/i, {
    message: 'JID do grupo inválido (deve terminar em @g.us).',
  })
  @MaxLength(120)
  groupJid?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  monitoredNumbers?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
