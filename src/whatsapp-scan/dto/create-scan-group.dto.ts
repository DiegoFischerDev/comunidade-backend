import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateScanGroupDto {
  @IsString()
  @MinLength(1, { message: 'Indica o parceiro.' })
  partnerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsString()
  @Matches(/@(g\.us|newsletter)$/i, {
    message: 'JID inválido (deve terminar em @g.us ou @newsletter).',
  })
  @MaxLength(120)
  groupJid!: string;

  /** Números (apenas dígitos) a monitorizar. Vazio = monitoriza todos. */
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
  autoShareEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  monitorAllMembers?: boolean;
}
