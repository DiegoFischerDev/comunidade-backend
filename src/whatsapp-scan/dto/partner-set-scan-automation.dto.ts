import { IsBoolean } from 'class-validator';

/** Liga/desliga a importação automática em todos os grupos do parceiro. */
export class PartnerSetScanAutomationDto {
  @IsBoolean()
  active!: boolean;
}
