import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PartnerService } from './partner.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { UpdatePartnerProfileDto } from './dto/update-partner-profile.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdateServiceAdminDto } from './dto/update-service-admin.dto';
import { UpdatePartnerAdminDto } from './dto/update-partner-admin.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { Public } from '../auth/public.decorator';

@Controller('partners')
export class PartnerController {
  constructor(private readonly partnerService: PartnerService) {}

  @Get()
  @Roles(Role.ADMIN)
  async list() {
    return this.partnerService.listPartners();
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() dto: CreatePartnerDto) {
    return this.partnerService.createPartner(dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async delete(@Param('id') id: string) {
    return this.partnerService.deletePartner(id);
  }

  @Patch('admin/:id')
  @Roles(Role.ADMIN)
  async updateAdmin(
    @Param('id') id: string,
    @Body() dto: UpdatePartnerAdminDto,
  ) {
    return this.partnerService.updatePartnerAdmin(id, dto);
  }

  @Get('admin/categories')
  @Roles(Role.ADMIN)
  async listCategories() {
    return this.partnerService.listCategories();
  }

  @Post('admin/categories')
  @Roles(Role.ADMIN)
  async createCategory(@Body() dto: CreateCategoryDto) {
    return this.partnerService.createCategory(dto);
  }

  @Patch('admin/categories/:id')
  @Roles(Role.ADMIN)
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.partnerService.updateCategory(id, dto);
  }

  @Delete('admin/categories/:id')
  @Roles(Role.ADMIN)
  async deleteCategory(@Param('id') id: string) {
    return this.partnerService.deleteCategory(id);
  }

  @Get('admin/services')
  @Roles(Role.ADMIN)
  async listAllServicesAdmin() {
    return this.partnerService.listAllServicesAdmin();
  }

  @Get('admin/services/pending')
  @Roles(Role.ADMIN)
  async listPendingServicesAdmin() {
    return this.partnerService.listPendingServicesAdmin();
  }

  @Patch('admin/services/:id')
  @Roles(Role.ADMIN)
  async updateServiceAdmin(
    @Param('id') id: string,
    @Body() dto: UpdateServiceAdminDto,
  ) {
    return this.partnerService.updateServiceAdmin(id, dto);
  }

  @Patch('admin/services/:id/approve')
  @Roles(Role.ADMIN)
  async approveServiceAdmin(@Param('id') id: string) {
    return this.partnerService.approveServiceAdmin(id);
  }

  @Public()
  @Get('categories-with-partners')
  async listCategoriesWithPartners() {
    return this.partnerService.listCategoriesWithPartners();
  }

  @Public()
  @Get(':id/public')
  async getPartnerPublic(@Param('id') id: string) {
    return this.partnerService.getPartnerPublic(id);
  }

  @Get('me')
  @Roles(Role.PARTNER)
  async me(@CurrentUser() user: { id: string }) {
    return this.partnerService.getCurrentPartner(user.id);
  }

  @Patch('me')
  @Roles(Role.PARTNER)
  async updateMe(
    @CurrentUser() user: { id: string },
    @Body() dto: UpdatePartnerProfileDto,
  ) {
    return this.partnerService.updateCurrentPartner(user.id, dto);
  }

  @Get('me/services')
  @Roles(Role.PARTNER)
  async listMyServices(@CurrentUser() user: { id: string }) {
    return this.partnerService.listMyServices(user.id);
  }

  @Get('me/leads')
  @Roles(Role.PARTNER)
  async listMyLeads(@CurrentUser() user: { id: string }) {
    return this.partnerService.listMyLeads(user.id);
  }

  @Post('me/services')
  @Roles(Role.PARTNER)
  async createMyService(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateServiceDto,
  ) {
    return this.partnerService.createMyService(user.id, dto);
  }

  @Patch('me/services/:id')
  @Roles(Role.PARTNER)
  async updateMyService(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.partnerService.updateMyService(user.id, id, dto);
  }

  @Delete('me/services/:id')
  @Roles(Role.PARTNER)
  async deleteMyService(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.partnerService.deleteMyService(user.id, id);
  }

  @Post(':id/leads')
  async createLead(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateLeadDto,
  ) {
    return this.partnerService.createLeadForPartner(id, user.id, dto);
  }
}

