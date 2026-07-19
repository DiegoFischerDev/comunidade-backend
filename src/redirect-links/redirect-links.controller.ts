import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Patch,
  Param,
  Post,
  Body,
  Req,
  Res,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { RedirectClickKind } from '@prisma/client';
import { RedirectLinksService } from './redirect-links.service';
import { CreatePartnerShareLinkDto } from './dto/create-partner-share-link.dto';
import { UpdatePartnerShareLinkDto } from './dto/update-partner-share-link.dto';
import { getCountryCodeFromRequest } from './redirect-request-country';

/** Expira cookie legado `rd_vid` (já não usamos ID de visitante persistente). */
function clearLegacyRedirectVisitorCookieHeader(): string {
  const secure =
    process.env.REDIRECT_COOKIE_SECURE === 'true' ||
    process.env.NODE_ENV === 'production';
  const parts = [
    'rd_vid=',
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

@Controller('redirect-links')
export class RedirectLinksController {
  constructor(private readonly redirectLinksService: RedirectLinksService) {}

  @Get('admin/overview')
  @Roles(Role.ADMIN)
  async adminOverview(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.redirectLinksService.adminOverview({ from, to });
  }

  private parseAdminClickKind(
    kindRaw?: string,
  ): RedirectClickKind | undefined {
    if (kindRaw == null || kindRaw === '') return undefined;
    if (
      kindRaw !== RedirectClickKind.CUSTOM_LINK &&
      kindRaw !== RedirectClickKind.HOUSE
    ) {
      throw new BadRequestException(
        'Parâmetro kind inválido (use CUSTOM_LINK ou HOUSE).',
      );
    }
    return kindRaw as RedirectClickKind;
  }

  @Get('admin/clicks')
  @Roles(Role.ADMIN)
  async adminClicks(
    @Query('kind') kindRaw?: string,
    @Query('partnerShareLinkId') partnerShareLinkId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const kind = this.parseAdminClickKind(kindRaw);
    const limit = limitRaw != null ? parseInt(limitRaw, 10) : 50;
    const offset = offsetRaw != null ? parseInt(offsetRaw, 10) : 0;
    if (Number.isNaN(limit) || Number.isNaN(offset)) {
      throw new BadRequestException('limit e offset devem ser números.');
    }
    const linkId = (partnerShareLinkId ?? '').trim();
    return this.redirectLinksService.adminClickHistory({
      kind: linkId ? undefined : kind,
      partnerShareLinkId: linkId || undefined,
      from: (from ?? '').trim() || undefined,
      to: (to ?? '').trim() || undefined,
      limit,
      offset,
    });
  }

  @Get('admin/clicks/stats')
  @Roles(Role.ADMIN)
  async adminClickStats(
    @Query('kind') kindRaw?: string,
    @Query('partnerShareLinkId') partnerShareLinkId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('periodGrain') periodGrainRaw?: string,
    @Query('periodKey') periodKeyRaw?: string,
    @Query('country') countryRaw?: string,
  ) {
    const kind = this.parseAdminClickKind(kindRaw);
    const linkId = (partnerShareLinkId ?? '').trim();
    const grainRaw = (periodGrainRaw ?? '').trim().toLowerCase();
    let periodGrain: 'year' | 'month' | undefined;
    if (grainRaw === 'year' || grainRaw === 'month') {
      periodGrain = grainRaw;
    } else if (grainRaw) {
      throw new BadRequestException(
        'periodGrain inválido (use year ou month).',
      );
    }
    const country = (countryRaw ?? '').trim().toUpperCase();
    if (country && !/^[A-Z]{2}$/.test(country)) {
      throw new BadRequestException(
        'country inválido (use código ISO de 2 letras, ex.: PT).',
      );
    }
    return this.redirectLinksService.adminClickStats({
      kind: linkId ? undefined : kind,
      partnerShareLinkId: linkId || undefined,
      from: (from ?? '').trim() || undefined,
      to: (to ?? '').trim() || undefined,
      periodGrain,
      periodKey: (periodKeyRaw ?? '').trim() || undefined,
      visitorCountryCode: country || undefined,
    });
  }

  @Post('admin/custom')
  @Roles(Role.ADMIN)
  async createCustom(@Body() dto: CreatePartnerShareLinkDto) {
    return this.redirectLinksService.createPartnerShareLink(dto);
  }

  @Get('admin/custom/:id')
  @Roles(Role.ADMIN)
  async getCustom(@Param('id') id: string) {
    return this.redirectLinksService.adminGetPartnerShareLink(id);
  }

  @Patch('admin/custom/:id')
  @Roles(Role.ADMIN)
  async updateCustom(
    @Param('id') id: string,
    @Body() dto: UpdatePartnerShareLinkDto,
  ) {
    return this.redirectLinksService.adminUpdatePartnerShareLink(id, dto);
  }

  @Post('admin/custom/:id/og-image')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async uploadCustomOgImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.redirectLinksService.adminUploadPartnerShareOgImage(id, file);
  }

  @Delete('admin/custom/:id/og-image')
  @Roles(Role.ADMIN)
  async deleteCustomOgImage(@Param('id') id: string) {
    return this.redirectLinksService.adminDeletePartnerShareOgImage(id);
  }

  @Delete('admin/custom/:id/clicks')
  @Roles(Role.ADMIN)
  async clearCustomClicks(@Param('id') id: string) {
    return this.redirectLinksService.adminClearPartnerShareLinkClicks(id);
  }

  @Delete('admin/custom/:id')
  @Roles(Role.ADMIN)
  async deleteCustom(@Param('id') id: string) {
    return this.redirectLinksService.adminDeletePartnerShareLink(id);
  }

  /** JSON: URL wa.me (sem registo de clique) — fallback na página de entrada do site. */
  @Get('public/custom-whatsapp-target/:slug')
  @Public()
  async customWhatsappTarget(@Param('slug') slug: string) {
    const r =
      await this.redirectLinksService.getPublicCustomWhatsappTarget(slug);
    if (!r) throw new NotFoundException('Link não encontrado.');
    return r;
  }

  /** Metadados OG para crawlers (WhatsApp, etc.) — sem registo de clique. */
  @Get('public/og-meta/by-titulo/:slug')
  @Public()
  async ogMetaByTitulo(@Param('slug') slug: string) {
    const r = await this.redirectLinksService.getPublicOgMetaBySlug(slug);
    if (!r) throw new NotFoundException('Link não encontrado.');
    return r;
  }

  @Get('public/house-whatsapp-target/:houseKey')
  @Public()
  async houseWhatsappTarget(@Param('houseKey') houseKey: string) {
    const r =
      await this.redirectLinksService.getPublicHouseWhatsappTarget(houseKey);
    if (!r) throw new NotFoundException('Imóvel não encontrado.');
    return r;
  }

  @Get('public/by-titulo/:slug')
  @Public()
  async redirectByTitulo(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const country = getCountryCodeFromRequest(req);
    const url = await this.redirectLinksService.resolveCustomRedirect(
      slug,
      country,
    );
    res.appendHeader('Set-Cookie', clearLegacyRedirectVisitorCookieHeader());
    return res.redirect(302, url);
  }

  @Get('public/by-house/:houseKey')
  @Public()
  async redirectByHouse(
    @Param('houseKey') houseKey: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const country = getCountryCodeFromRequest(req);
    const url = await this.redirectLinksService.resolveHouseRedirect(
      houseKey,
      country,
    );
    res.appendHeader('Set-Cookie', clearLegacyRedirectVisitorCookieHeader());
    return res.redirect(302, url);
  }
}
