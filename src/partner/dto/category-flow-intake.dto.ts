import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Payload vindo do receiver da Evolution (whatsapp-evolution-verify).
 * Por enquanto só usamos para o flow de "mais sobre o serviço de relocation",
 * mas foi desenhado para suportar outras categorias no futuro.
 */
export class CategoryFlowIntakeDto {
  @IsString()
  @MinLength(8)
  whatsapp!: string; // dígitos

  @IsString()
  @MinLength(3)
  message!: string;

  /** Nome do contacto vindo do WhatsApp/Evolution (pushName/notifyName). */
  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  evolutionInstance?: string;

  @IsOptional()
  @IsString()
  messageId?: string;

  /**
   * true quando a mensagem veio da própria instância (fromMe no Baileys/Evolution).
   * Usado para decidir como extrair o nome do lead.
   */
  @IsOptional()
  @IsBoolean()
  fromMe?: boolean;
}

