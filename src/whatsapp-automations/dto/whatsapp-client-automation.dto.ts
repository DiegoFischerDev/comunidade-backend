import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Passo da sequência — validação fina no service (`assertSteps`). */
export type AutomationStepInputDto = {
  type: 'TEXT' | 'AUDIO' | 'IMAGE';
  textContent?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaFileName?: string;
  caption?: string;
  delayMsAfter?: number;
};

export class CreateWhatsappClientAutomationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  triggerPhrase!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  steps!: AutomationStepInputDto[];
}

export class UpdateWhatsappClientAutomationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  triggerPhrase?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  steps?: AutomationStepInputDto[];
}

export class WhatsappClientAutomationInboundDto {
  @IsString()
  @MaxLength(120)
  senderNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  text?: string;

  /**
   * `audio` — nota de voz (Joana transcreve).
   * `image` / `document` — anexo CRM (download Evolution → R2).
   */
  @IsOptional()
  @IsIn(['audio', 'image', 'document'])
  kind?: 'audio' | 'image' | 'document';

  /**
   * Nota completa do webhook (key + audioMessage/imageMessage/documentMessage).
   * A Evolution não guarda a mensagem, por isso o id sozinho não descarrega a mídia.
   */
  @IsOptional()
  @IsObject()
  mediaMessage?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mediaMimeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  mediaFileName?: string;

  @IsOptional()
  @IsBoolean()
  fromMe?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  instance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalMessageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  pushName?: string;
}
