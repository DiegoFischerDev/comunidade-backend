import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGrupoTesteBodyDto {
  @IsString({ message: 'Indica a descrição.' })
  @MinLength(3, { message: 'A descrição deve ter pelo menos 3 caracteres.' })
  @MaxLength(8000, { message: 'Descrição demasiado longa.' })
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160, { message: 'JID do grupo demasiado longo.' })
  targetGroupJid?: string;
}
