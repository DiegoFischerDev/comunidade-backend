import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { PartnerService } from './partner.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { UpdatePartnerProfileDto } from './dto/update-partner-profile.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdatePartnerAdminDto } from './dto/update-partner-admin.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { Public } from '../auth/public.decorator';
import { UpdateServiceCommissionDto } from './dto/update-service-commission.dto';
import {
  CreatePartnerSaleDto,
  StartPartnerSaleCommissionCheckoutDto,
} from './dto/create-partner-sale.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { CreatePartnerHouseDto } from './dto/create-partner-house.dto';
import { UpdatePartnerHouseDto } from './dto/update-partner-house.dto';
import { memoryStorage } from 'multer';

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
  async adminListServices() {
    return this.partnerService.adminListServicesGroupedByPartner();
  }

  @Patch('admin/services/:id/commission')
  @Roles(Role.ADMIN)
  async adminUpdateServiceCommission(
    @Param('id') id: string,
    @Body() dto: UpdateServiceCommissionDto,
  ) {
    return this.partnerService.adminUpdateServiceCommission(
      id,
      dto.rpmCommissionEur,
    );
  }

  @Public()
  @Get('categories-with-partners')
  async listCategoriesWithPartners() {
    return this.partnerService.listCategoriesWithPartners();
  }

  /** Imóveis públicos (parceiros relocation, disponíveis). Deve ficar antes de rotas `:id`. */
  @Public()
  @Get('relocation/houses')
  async listRelocationHousesPublic() {
    return this.partnerService.listPublicRelocationHouses();
  }

  /** Página pública do anúncio (detalhes + parceiro relocation). */
  @Public()
  @Get('houses/:houseId/public')
  async getHousePublic(@Param('houseId') houseId: string) {
    return this.partnerService.getPublicHousePage(houseId);
  }

  /** Utilizador autenticado: confirma se o anúncio ainda existe e está disponível antes do contacto. */
  @Get('houses/:houseId/contact')
  async getHouseListingForContact(@Param('houseId') houseId: string) {
    return this.partnerService.getHouseListingForContact(houseId);
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

  @Get('me/houses')
  @Roles(Role.PARTNER)
  async listMyHouses(@CurrentUser() user: { id: string }) {
    return this.partnerService.listMyHouses(user.id);
  }

  @Post('me/houses')
  @Roles(Role.PARTNER)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 6 },
        { name: 'video', maxCount: 1 },
      ],
      {
        limits: {
          files: 7,
          // Fotos até ~5MB cada no cliente; vídeo até ~48MB (WhatsApp pode recusar vídeos muito grandes)
          fileSize: 48 * 1024 * 1024,
        },
        storage: memoryStorage(),
      },
    ),
  )
  async createMyHousePost(
    @CurrentUser() user: { id: string },
    @Body() dto: CreatePartnerHouseDto,
    @UploadedFiles()
    files: { images?: Express.Multer.File[]; video?: Express.Multer.File[] },
  ) {
    return this.partnerService.createMyHousePost(
      user.id,
      dto,
      files?.images ?? [],
      files?.video?.[0] ?? null,
    );
  }

  @Get('me/houses/:id')
  @Roles(Role.PARTNER)
  async getMyHouse(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.partnerService.getMyHouse(user.id, id);
  }

  @Patch('me/houses/:id')
  @Roles(Role.PARTNER)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 6 },
        { name: 'video', maxCount: 1 },
      ],
      {
        limits: {
          files: 7,
          fileSize: 80 * 1024 * 1024,
        },
        storage: memoryStorage(),
      },
    ),
  )
  async updateMyHouse(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdatePartnerHouseDto,
    @UploadedFiles()
    files: { images?: Express.Multer.File[]; video?: Express.Multer.File[] },
  ) {
    return this.partnerService.updateMyHouse(
      user.id,
      id,
      dto,
      files?.images ?? [],
      files?.video?.[0] ?? null,
    );
  }

  @Patch('me/houses/:id/status')
  @Roles(Role.PARTNER)
  @HttpCode(200)
  async updateMyHouseStatus(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { status: 'AVAILABLE' | 'UNAVAILABLE' },
  ) {
    return this.partnerService.updateMyHouseStatus(user.id, id, body.status);
  }

  @Get('me/sales')
  @Roles(Role.PARTNER)
  async listMySales(@CurrentUser() user: { id: string }) {
    return this.partnerService.listMySales(user.id);
  }

  @Post('me/sales')
  @Roles(Role.PARTNER)
  async createMySale(
    @CurrentUser() user: { id: string },
    @Body() dto: CreatePartnerSaleDto,
  ) {
    return this.partnerService.createMySale(user.id, dto);
  }

  @Delete('me/sales/:id')
  @Roles(Role.PARTNER)
  async deleteMySale(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.partnerService.deleteMySale(user.id, id);
  }

  @Get('admin/sales')
  @Roles(Role.ADMIN)
  async adminListAllSales() {
    return this.partnerService.adminListAllSales();
  }

  @Get('admin/houses')
  @Roles(Role.ADMIN)
  async adminListAllHouses() {
    return this.partnerService.adminListAllHouses();
  }

  @Delete('admin/houses/:houseId')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  async adminDeleteHouse(@Param('houseId') houseId: string) {
    return this.partnerService.adminDeleteHouse(houseId);
  }

  @Post('me/sales/:id/pay-commission')
  @Roles(Role.PARTNER)
  async startSaleCommissionCheckout(
    @CurrentUser() user: { id: string; email?: string | null },
    @Param('id') id: string,
    @Body() dto: StartPartnerSaleCommissionCheckoutDto,
  ) {
    const frontendBase =
      process.env.FRONTEND_URL?.replace(/\/$/, '') ||
      'https://comunidade.rafaapelomundo.com';
    const successUrl =
      dto.successUrl ?? `${frontendBase}/dashboard/my-sales?paid=1`;
    const cancelUrl = dto.cancelUrl ?? `${frontendBase}/dashboard/my-sales`;
    return this.partnerService.startMySaleCommissionCheckout({
      partnerUserId: user.id,
      partnerEmail: user.email,
      saleId: id,
      commissionEur: dto.commissionEur,
      wantsInvoice: dto.wantsInvoice,
      successUrl,
      cancelUrl,
      method: 'card',
    });
  }

  @Post('me/sales/:id/pay-commission-mbway')
  @Roles(Role.PARTNER)
  async startSaleCommissionCheckoutMbWay(
    @CurrentUser() user: { id: string; email?: string | null },
    @Param('id') id: string,
    @Body() dto: StartPartnerSaleCommissionCheckoutDto,
  ) {
    const frontendBase =
      process.env.FRONTEND_URL?.replace(/\/$/, '') ||
      'https://comunidade.rafaapelomundo.com';
    const successUrl =
      dto.successUrl ?? `${frontendBase}/dashboard/my-sales?paid=1`;
    const cancelUrl = dto.cancelUrl ?? `${frontendBase}/dashboard/my-sales`;
    return this.partnerService.startMySaleCommissionCheckout({
      partnerUserId: user.id,
      partnerEmail: user.email,
      saleId: id,
      commissionEur: dto.commissionEur,
      wantsInvoice: dto.wantsInvoice,
      successUrl,
      cancelUrl,
      method: 'mbway',
    });
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

