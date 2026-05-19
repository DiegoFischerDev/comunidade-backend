import { IsIn, IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';
import {
  ADVERTISING_TOPUP_MAX_EUR_CENTS,
  ADVERTISING_TOPUP_MIN_EUR_CENTS,
} from '../house-publication.constants';

export class StartAdvertisingTopupDto {
  @IsInt()
  @Min(ADVERTISING_TOPUP_MIN_EUR_CENTS)
  @Max(ADVERTISING_TOPUP_MAX_EUR_CENTS)
  amountEurCents!: number;

  @IsIn(['card', 'mbway', 'pix'])
  paymentMethod!: 'card' | 'mbway' | 'pix';

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  successUrl?: string;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  cancelUrl?: string;
}
