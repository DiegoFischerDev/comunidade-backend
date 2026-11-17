import { IsDefined, IsObject } from 'class-validator';

export class UpdateRafacallWorkingHoursDto {
  @IsDefined()
  @IsObject()
  days!: Record<string, unknown>;
}
