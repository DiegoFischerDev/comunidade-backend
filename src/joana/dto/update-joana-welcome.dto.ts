import { ArrayMaxSize, IsArray } from 'class-validator';
import type { AutomationStepInputDto } from '../../whatsapp-automations/dto/whatsapp-client-automation.dto';

/** Mesmo shape dos passos de «Nova automação». Validação fina em `normalizeJoanaWelcomeSteps`. */
export class UpdateJoanaWelcomeDto {
  @IsArray()
  @ArrayMaxSize(20)
  steps!: AutomationStepInputDto[];
}
