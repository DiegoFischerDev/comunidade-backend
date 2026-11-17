import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateJoanaContextDto {
  @IsString()
  @MinLength(20)
  @MaxLength(20_000)
  contextText!: string;
}
