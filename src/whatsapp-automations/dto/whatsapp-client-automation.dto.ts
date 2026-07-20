import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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

  @IsString()
  @MaxLength(8000)
  text!: string;

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
}
