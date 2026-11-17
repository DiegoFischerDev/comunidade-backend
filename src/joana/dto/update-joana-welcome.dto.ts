import { ArrayMaxSize, IsArray } from 'class-validator';

/** Passo de boas-vindas — validação fina em `normalizeJoanaWelcomeSteps`. */
export type JoanaWelcomeStepInputDto = {
  type: 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  textContent?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaFileName?: string;
  caption?: string;
  delayMsAfter?: number;
};

/** Shape das automações + DOCUMENT (PDF). Validação fina em `normalizeJoanaWelcomeSteps`. */
export class UpdateJoanaWelcomeDto {
  @IsArray()
  @ArrayMaxSize(20)
  steps!: JoanaWelcomeStepInputDto[];
}
