import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateSupportTicketDto {
  @IsString({ message: 'message deve ser string.' })
  @MinLength(1, { message: 'Mensagem é obrigatória.' })
  @MaxLength(4000, { message: 'Mensagem muito longa (máx 4000).' })
  message!: string;
}

export class UpdateSupportTicketDto {
  @IsString({ message: 'message deve ser string.' })
  @MinLength(1, { message: 'Mensagem é obrigatória.' })
  @MaxLength(4000, { message: 'Mensagem muito longa (máx 4000).' })
  message!: string;
}

