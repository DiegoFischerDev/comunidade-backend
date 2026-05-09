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
import { CategoryFlowIntakeDto } from './dto/category-flow-intake.dto';

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

  @Public()
  @Post('category-flow/relocation-service-info')
  @HttpCode(200)
  async relocationServiceInfo(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() dto: CategoryFlowIntakeDto,
  ) {
    const expected = process.env.COMMUNITY_INTERNAL_SECRET;
    if (!expected || secret !== expected) {
      throw new UnauthorizedException();
    }
    return this.partnerLeadIntake.processRelocationServiceInfoInbound(dto);
  }

  @Public()
  @Post('category-flow/internet-service-info')
  @HttpCode(200)
  async internetServiceInfo(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() dto: CategoryFlowIntakeDto,
  ) {
    const expected = process.env.COMMUNITY_INTERNAL_SECRET;
    if (!expected || secret !== expected) {
      throw new UnauthorizedException();
    }
    return this.partnerLeadIntake.processInternetServiceInfoInbound(dto);
  }

  @Public()
  @Post('category-flow/vistos-service-info')
  @HttpCode(200)
  async vistosServiceInfo(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() dto: CategoryFlowIntakeDto,
  ) {
    const expected = process.env.COMMUNITY_INTERNAL_SECRET;
    if (!expected || secret !== expected) {
      throw new UnauthorizedException();
    }
    return this.partnerLeadIntake.processVistosServiceInfoInbound(dto);
  }

  @Public()
  @Post('category-flow/house-interest')
  @HttpCode(200)
  async houseInterest(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() dto: CategoryFlowIntakeDto,
  ) {
    const expected = process.env.COMMUNITY_INTERNAL_SECRET;
    if (!expected || secret !== expected) {
      throw new UnauthorizedException();
    }
    return this.partnerLeadIntake.processHouseInterestInbound(dto);
  }
}
