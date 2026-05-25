import { IsString, MinLength } from 'class-validator';

/** Pedido público de verificação do WhatsApp para abrir a página de upload. */
export class VerifyLeadDocumentsDto {
  @IsString()
  @MinLength(6)
  whatsapp!: string;
}
