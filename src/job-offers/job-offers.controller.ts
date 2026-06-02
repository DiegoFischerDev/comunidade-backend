import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { IngestMessageDto } from '../whatsapp-scan/dto/ingest-message.dto';
import { CreateJobOfferDto } from './dto/create-job-offer.dto';
import { ParseJobOfferFromTextDto } from './dto/parse-job-offer-from-text.dto';
import { UpdateJobOfferDto } from './dto/update-job-offer.dto';
import { CreateJobOfferWhatsappRouteDto } from './dto/create-job-offer-whatsapp-route.dto';
import { UpdateJobOfferWhatsappRouteDto } from './dto/update-job-offer-whatsapp-route.dto';
import { JobOfferWhatsappService } from './job-offer-whatsapp.service';
import { JobOffersService } from './job-offers.service';

@Controller('job-offers')
export class JobOffersController {
  constructor(
    private readonly jobOffersService: JobOffersService,
    private readonly jobOfferWhatsapp: JobOfferWhatsappService,
  ) {}

  @Public()
  @Get()
  listPublic() {
    return this.jobOffersService.listPublic();
  }

  @Get('admin')
  @Roles(Role.ADMIN)
  adminList() {
    return this.jobOffersService.adminList();
  }

  @Post('admin/parse')
  @Roles(Role.ADMIN)
  adminParseFromText(@Body() dto: ParseJobOfferFromTextDto) {
    return this.jobOffersService.adminParseFromText(dto.text);
  }

  @Post('admin')
  @Roles(Role.ADMIN)
  adminCreate(@Body() dto: CreateJobOfferDto) {
    return this.jobOffersService.adminCreate(dto);
  }

  @Patch('admin/:id')
  @Roles(Role.ADMIN)
  adminUpdate(@Param('id') id: string, @Body() dto: UpdateJobOfferDto) {
    return this.jobOffersService.adminUpdate(id, dto);
  }

  @Delete('admin/:id')
  @Roles(Role.ADMIN)
  adminDelete(@Param('id') id: string) {
    return this.jobOffersService.adminDelete(id);
  }

  // ===== WhatsApp (ofertas de trabalho) =====

  @Get('whatsapp/routes')
  @Roles(Role.ADMIN)
  whatsappListRoutes() {
    return this.jobOfferWhatsapp.listRoutes();
  }

  @Post('whatsapp/routes')
  @Roles(Role.ADMIN)
  whatsappCreateRoute(@Body() dto: CreateJobOfferWhatsappRouteDto) {
    return this.jobOfferWhatsapp.createRoute(dto);
  }

  @Patch('whatsapp/routes/:id')
  @Roles(Role.ADMIN)
  whatsappUpdateRoute(
    @Param('id') id: string,
    @Body() dto: UpdateJobOfferWhatsappRouteDto,
  ) {
    return this.jobOfferWhatsapp.updateRoute(id, dto);
  }

  @Delete('whatsapp/routes/:id')
  @Roles(Role.ADMIN)
  whatsappDeleteRoute(@Param('id') id: string) {
    return this.jobOfferWhatsapp.deleteRoute(id);
  }

  @Get('whatsapp/evolution-groups')
  @Roles(Role.ADMIN)
  whatsappEvolutionGroups() {
    return this.jobOfferWhatsapp.listEvolutionGroups();
  }

  @Get('whatsapp/messages')
  @Roles(Role.ADMIN)
  whatsappListMessages(
    @Query('limit') limit?: string,
    @Query('routeId') routeId?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : 80;
    return this.jobOfferWhatsapp.listMessages(
      Number.isFinite(n) ? n : 80,
      routeId?.trim() || undefined,
    );
  }

  @Public()
  @Post('whatsapp/ingest')
  whatsappIngest(
    @Body() dto: IngestMessageDto,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    const expected = (process.env.COMMUNITY_INTERNAL_SECRET || '').trim();
    if (!expected || (internalSecret ?? '').trim() !== expected) {
      throw new ForbiddenException('Segredo interno inválido.');
    }
    return this.jobOfferWhatsapp.ingest(dto);
  }

  @Public()
  @Get(':id')
  getPublicById(@Param('id') id: string) {
    return this.jobOffersService.getPublicById(id);
  }
}
