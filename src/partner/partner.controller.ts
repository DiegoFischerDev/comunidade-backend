import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { getFrontendBaseUrl } from '../config/frontend-base-url';
import { PartnerService } from './partner.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { Roles } from '../auth/roles.decorator';
import { PartnerHouseStatus, Role } from '@prisma/client';
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
import { SetPartnerReactionDto } from './dto/set-partner-reaction.dto';
import { CreatePartnerCommentDto } from './dto/create-partner-comment.dto';
import { AdminManualLeadDto } from './dto/admin-manual-lead.dto';

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

  @Post('admin/:partnerId/leads/manual')
  @Roles(Role.ADMIN)
  @HttpCode(201)
  async adminManualLead(
    @Param('partnerId') partnerId: string,
    @Body() dto: AdminManualLeadDto,
  ) {
    return this.partnerService.adminManualLead(partnerId, dto);
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
  async listRelocationHousesPublic(
    @Query('partnerId') partnerId?: string,
    @Query('city') city?: string,
    @Query('typology') typology?: string,
    @Query('businessType') businessType?: string,
  ) {
    return this.partnerService.listPublicRelocationHouses({
      partnerId: partnerId || undefined,
      city: city || undefined,
      typology: typology || undefined,
      businessType: businessType || undefined,
    });
  }

  /** Categoria Relocation (nome, slug, imagem de capa para hero). */
  @Public()
  @Get('relocation/category')
  async getRelocationCategoryPublic() {
    return this.partnerService.getRelocationCategoryPublic();
  }

  /** Página pública do anúncio (detalhes + parceiro relocation). */
  @Public()
  @Get('houses/:houseId/public')
  async getHousePublic(@Param('houseId') houseId: string) {
    return this.partnerService.getPublicHousePage(houseId);
  }

  /** Dados mínimos do anúncio para contacto (público: fluxo WhatsApp admin sem login). */
  @Public()
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
    const partner = await this.partnerService.getCurrentPartner(user.id);
    const extras = await this.partnerService.getPartnerLeadDashboardExtras(
      partner.id,
    );
    return { ...partner, ...extras };
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

  @Post('me/leads/:leadId/contact')
  @Roles(Role.PARTNER)
  @HttpCode(200)
  async openLeadWhatsApp(
    @CurrentUser() user: { id: string },
    @Param('leadId') leadId: string,
  ) {
    return this.partnerService.openLeadWhatsApp(leadId, user.id);
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
    @Body() body: { status: PartnerHouseStatus },
  ) {
    return this.partnerService.updateMyHouseStatus(user.id, id, body.status);
  }

  @Delete('me/houses/:id')
  @Roles(Role.PARTNER)
  @HttpCode(200)
  async deleteMyHouse(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.partnerService.deleteMyHouse(user.id, id);
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

  @Post('admin/houses')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 6 },
        { name: 'video', maxCount: 1 },
      ],
      {
        limits: {
          files: 7,
          fileSize: 48 * 1024 * 1024,
        },
        storage: memoryStorage(),
      },
    ),
  )
  async adminCreateHousePost(
    @CurrentUser() user: { id: string },
    @Body() dto: CreatePartnerHouseDto,
    @UploadedFiles()
    files: { images?: Express.Multer.File[]; video?: Express.Multer.File[] },
  ) {
    return this.partnerService.adminCreateHousePost(
      user.id,
      dto,
      files?.images ?? [],
      files?.video?.[0] ?? null,
    );
  }

  @Delete('admin/houses/:houseId')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  async adminDeleteHouse(@Param('houseId') houseId: string) {
    return this.partnerService.adminDeleteHouse(houseId);
  }

  @Patch('admin/houses/:houseId/featured')
  @Roles(Role.ADMIN)
  async adminSetHouseFeatured(
    @Param('houseId') houseId: string,
    @Body() body: { featured: boolean },
  ) {
    return this.partnerService.adminSetHouseFeatured(houseId, Boolean(body?.featured));
  }

  @Post('me/sales/:id/pay-commission')
  @Roles(Role.PARTNER)
  async startSaleCommissionCheckout(
    @CurrentUser() user: { id: string; email?: string | null },
    @Param('id') id: string,
    @Body() dto: StartPartnerSaleCommissionCheckoutDto,
  ) {
    const frontendBase = getFrontendBaseUrl();
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
    const frontendBase = getFrontendBaseUrl();
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

  @Public()
  @Get(':id/engagement')
  async getPartnerEngagement(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = this.partnerService.getOptionalUserIdFromAuthHeader(authorization);
    return this.partnerService.getPartnerEngagement(id, userId);
  }

  @Public()
  @Get(':id/comments')
  async listPartnerComments(
    @Param('id') id: string,
    @Query('take') takeStr?: string,
  ) {
    const take = Math.min(
      2000,
      Math.max(1, Number.parseInt(takeStr ?? '500', 10) || 500),
    );
    return this.partnerService.listPartnerComments(id, take);
  }

  @Public()
  @Post(':id/share')
  @HttpCode(200)
  async recordPartnerShare(@Param('id') id: string) {
    return this.partnerService.recordPartnerShare(id);
  }

  @Put(':id/engagement/reaction')
  async setPartnerReaction(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: SetPartnerReactionDto,
  ) {
    return this.partnerService.setPartnerReaction(id, user.id, dto.type);
  }

  @Post(':id/comments')
  @HttpCode(201)
  async createPartnerComment(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreatePartnerCommentDto,
  ) {
    return this.partnerService.createPartnerComment(
      id,
      user.id,
      dto.body,
      dto.parentId,
    );
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(200)
  async deletePartnerComment(
    @Param('id') partnerId: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.partnerService.deletePartnerComment(
      partnerId,
      commentId,
      user.id,
      user.role,
    );
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

