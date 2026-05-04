import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendGrupoTesteDto {
  @IsString({ message: 'Indica o JID do grupo.' })
  @MinLength(5, { message: 'JID do grupo inválido.' })
  @MaxLength(200, { message: 'JID demasiado longo.' })
  groupJid!: string;
}
