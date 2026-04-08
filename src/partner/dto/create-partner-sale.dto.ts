import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreatePartnerSaleDto {
  @IsString()
  leadUserId: string;

  @IsString()
  serviceId: string;

  /** Valor do serviço vendido (EUR) */
  @IsString()
  amountEur: string;
}

export class StartPartnerSaleCommissionCheckoutDto {
  @IsString()
  commissionEur: string;

  @IsBoolean()
  wantsInvoice: boolean;

  @IsOptional()
  @IsString()
  successUrl?: string;

  @IsOptional()
  @IsString()
  cancelUrl?: string;
}

