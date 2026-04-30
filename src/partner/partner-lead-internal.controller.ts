import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PartnerLeadIntakeDto } from './dto/partner-lead-intake.dto';
import { PartnerLeadIntakeService } from './partner-lead-intake.service';

@Controller('internal/whatsapp')
export class PartnerLeadInternalController {
  constructor(private readonly partnerLeadIntake: PartnerLeadIntakeService) {}

  @Public()
  @Post('partner-lead-intake')
  @HttpCode(200)
  async intake(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() dto: PartnerLeadIntakeDto,
  ) {
    const expected = process.env.COMMUNITY_INTERNAL_SECRET;
    if (!expected || secret !== expected) {
      throw new UnauthorizedException();
    }
    return this.partnerLeadIntake.processInbound(dto);
  }
}
