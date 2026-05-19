import { IsInt, IsString, IsUrl, Max, Min } from 'class-validator';
import { ADVERTISING_TOPUP_MAX_EUR_CENTS, ADVERTISING_TOPUP_MIN_EUR_CENTS } from '../../partner/house-publication.constants';

export class CreatePartnerAdvertisingTopupDto {
  @IsInt()
  @Min(ADVERTISING_TOPUP_MIN_EUR_CENTS)
  @Max(ADVERTISING_TOPUP_MAX_EUR_CENTS)
  amountEurCents!: number;

  @IsString()
  @IsUrl({ require_tld: false })
  successUrl!: string;

  @IsString()
  @IsUrl({ require_tld: false })
  cancelUrl!: string;
}
