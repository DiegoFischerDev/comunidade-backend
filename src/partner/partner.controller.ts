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
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { getFrontendBaseUrl } from '../config/frontend-base-url';
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
import { Public } from '../auth/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { UpdateServiceCommissionDto } from './dto/update-service-commission.dto';
import {
  CreatePartnerSaleDto,
  StartPartnerSaleCommissionCheckoutDto,
} from './dto/create-partner-sale.dto';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { CreatePartnerHouseDto } from './dto/create-partner-house.dto';
import { AdminCreatePartnerHouseDto } from './dto/admin-create-partner-house.dto';
import { UpdatePartnerHouseDto } from './dto/update-partner-house.dto';
import { AdminUpdatePartnerHouseDto } from './dto/admin-update-partner-house.dto';
import { memoryStorage } from 'multer';
import { SetPartnerReactionDto } from './dto/set-partner-reaction.dto';
import { CreatePartnerCommentDto } from './dto/create-partner-comment.dto';
import { CreateHouseRelocationWhatsappGroupDto } from './dto/create-house-relocation-whatsapp-group.dto';
import { UpdateHouseRelocationWhatsappGroupDto } from './dto/update-house-relocation-whatsapp-group.dto';
import { StartAdvertisingTopupDto } from './dto/start-advertising-topup.dto';

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

  @Get('admin/:id/advertising-balance')
  @Roles(Role.ADMIN)
  async adminGetPartnerAdvertisingBalance(@Param('id') id: string) {
    return this.partnerService.adminGetPartnerAdvertisingBalance(id);
  }

  @Post('admin/:id/advertising-balance/credit')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  async adminCreditPartnerAdvertisingBalance(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { amountEurCents: number; note?: string },
  ) {
    return this.partnerService.adminCreditPartnerAdvertisingBalance(
      user.id,
      id,
      body.amountEurCents,
      body.note,
    );
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
    @Query('minPriceEur') minPriceEur?: string,
    @Query('maxPriceEur') maxPriceEur?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.partnerService.listPublicRelocationHouses({
      partnerId: partnerId || undefined,
      city: city || undefined,
      typology: typology || undefined,
      businessType: businessType || undefined,
      minPriceEur: minPriceEur || undefined,
      maxPriceEur: maxPriceEur || undefined,
      page: page || undefined,
      pageSize: pageSize || undefined,
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
  @UseGuards(OptionalJwtAuthGuard)
  @Get('houses/:houseId/public')
  async getHousePublic(
    @Param('houseId') houseId: string,
    @CurrentUser() viewer?: { id: string; role: Role } | null,
  ) {
    return this.partnerService.getPublicHousePage(houseId, viewer ?? undefined);
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

  /** Vídeo de perfil: multipart; mesmo pipeline dos imóveis (R2 ou disco local). */
  @Post('me/catalog-video')
  @Roles(Role.PARTNER)
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('video', {
      limits: {
        fileSize: 80 * 1024 * 1024,
      },
      storage: memoryStorage(),
    }),
  )
  async uploadMyCatalogVideo(
    @CurrentUser() user: { id: string },
    @UploadedFile() video: Express.Multer.File | undefined,
  ) {
    return this.partnerService.uploadMyCatalogVideo(user.id, video);
  }

  @Get('me/services')
  @Roles(Role.PARTNER)
  async listMyServices(@CurrentUser() user: { id: string }) {
    return this.partnerService.listMyServices(user.id);
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
        { name: 'thumbnail', maxCount: 1 },
      ],
      {
        limits: {
          files: 8,
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
    files: {
      images?: Express.Multer.File[];
      video?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
  ) {
    return this.partnerService.createMyHousePost(
      user.id,
      dto,
      files?.images ?? [],
      files?.video?.[0] ?? null,
      files?.thumbnail?.[0] ?? null,
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
        { name: 'thumbnail', maxCount: 1 },
      ],
      {
        limits: {
          files: 8,
          fileSize: 500 * 1024 * 1024,
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
    files: {
      images?: Express.Multer.File[];
      video?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
  ) {
    return this.partnerService.updateMyHouse(
      user.id,
      id,
      dto,
      files?.images ?? [],
      files?.video?.[0] ?? null,
      files?.thumbnail?.[0] ?? null,
    );
  }

  @Get('me/advertising-balance')
  @Roles(Role.PARTNER)
  async getMyAdvertisingBalance(@CurrentUser() user: { id: string }) {
    return this.partnerService.getMyAdvertisingBalance(user.id);
  }

  @Post('me/advertising-topup-checkout')
  @Roles(Role.PARTNER)
  async startAdvertisingTopupCheckout(
    @CurrentUser() user: { id: string; email?: string | null },
    @Body() dto: StartAdvertisingTopupDto,
  ) {
    return this.partnerService.startAdvertisingBalanceTopup(user.id, user.email, dto);
  }

  @Post('me/houses/:id/publish')
  @Roles(Role.PARTNER)
  @HttpCode(200)
  async publishMyHouse(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.partnerService.publishMyHouse(user.id, id);
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

  @Get('admin/relocation-cities')
  @Roles(Role.ADMIN)
  async adminListRelocationHouseCities() {
    return this.partnerService.adminListRelocationHouseCities();
  }

  @Get('admin/houses/:houseId')
  @Roles(Role.ADMIN)
  async adminGetHouse(@Param('houseId') houseId: string) {
    return this.partnerService.adminGetHouse(houseId);
  }

  @Patch('admin/houses/:houseId')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 6 },
        { name: 'video', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 },
      ],
      {
        limits: {
          files: 8,
          fileSize: 80 * 1024 * 1024,
        },
        storage: memoryStorage(),
      },
    ),
  )
  async adminUpdateHouse(
    @CurrentUser() user: { id: string },
    @Param('houseId') houseId: string,
    @Body() dto: AdminUpdatePartnerHouseDto,
    @UploadedFiles()
    files: { images?: Express.Multer.File[]; video?: Express.Multer.File[]; thumbnail?: Express.Multer.File[] },
  ) {
    return this.partnerService.adminUpdateHouse(
      user.id,
      houseId,
      dto,
      files?.images ?? [],
      files?.video?.[0] ?? null,
      files?.thumbnail?.[0] ?? null,
    );
  }

  @Get('admin/house-whatsapp-groups')
  @Roles(Role.ADMIN)
  async adminListHouseRelocationWhatsappGroups() {
    return this.partnerService.adminListHouseRelocationWhatsappGroups();
  }

  @Post('admin/house-whatsapp-groups')
  @Roles(Role.ADMIN)
  async adminCreateHouseRelocationWhatsappGroup(
    @Body() dto: CreateHouseRelocationWhatsappGroupDto,
  ) {
    return this.partnerService.adminCreateHouseRelocationWhatsappGroup(dto);
  }

  @Patch('admin/house-whatsapp-groups/:id')
  @Roles(Role.ADMIN)
  async adminUpdateHouseRelocationWhatsappGroup(
    @Param('id') id: string,
    @Body() dto: UpdateHouseRelocationWhatsappGroupDto,
  ) {
    return this.partnerService.adminUpdateHouseRelocationWhatsappGroup(id, dto);
  }

  @Delete('admin/house-whatsapp-groups/:id')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  async adminDeleteHouseRelocationWhatsappGroup(@Param('id') id: string) {
    return this.partnerService.adminDeleteHouseRelocationWhatsappGroup(id);
  }

  @Post('admin/houses')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 6 },
        { name: 'video', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 },
      ],
      {
        limits: {
          files: 8,
          fileSize: 500 * 1024 * 1024,
        },
        storage: memoryStorage(),
      },
    ),
  )
  async adminCreateHousePost(
    @CurrentUser() user: { id: string },
    @Body() dto: AdminCreatePartnerHouseDto,
    @UploadedFiles()
    files: { images?: Express.Multer.File[]; video?: Express.Multer.File[]; thumbnail?: Express.Multer.File[] },
  ) {
    return this.partnerService.adminCreateHousePost(
      user.id,
      dto,
      files?.images ?? [],
      files?.video?.[0] ?? null,
      files?.thumbnail?.[0] ?? null,
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

  @Post('admin/houses/:houseId/send-whatsapp-groups')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  async adminSendHouseToWhatsappGroups(@Param('houseId') houseId: string) {
    return this.partnerService.adminSendHouseToRelocationWhatsappGroups(houseId);
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

}

