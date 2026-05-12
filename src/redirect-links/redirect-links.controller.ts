import {
  Controller,
  Get,
  Delete,
  Patch,
  Param,
  Post,
  Body,
  Req,
  Res,
  Query,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { RedirectClickKind } from '@prisma/client';
import { RedirectLinksService } from './redirect-links.service';
import { CreatePartnerShareLinkDto } from './dto/create-partner-share-link.dto';
import { UpdatePartnerShareLinkDto } from './dto/update-partner-share-link.dto';
import {
  buildRedirectVisitorSetCookieHeader,
  resolveRedirectVisitorId,
} from './redirect-visitor-id';

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

  @Get('admin/clicks')
  @Roles(Role.ADMIN)
  async adminClicks(
    @Query('kind') kindRaw?: string,
    @Query('partnerShareLinkId') partnerShareLinkId?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    let kind: RedirectClickKind | undefined;
    if (kindRaw != null && kindRaw !== '') {
      if (
        kindRaw !== RedirectClickKind.CUSTOM_LINK &&
        kindRaw !== RedirectClickKind.HOUSE
      ) {
        throw new BadRequestException(
          'Parâmetro kind inválido (use CUSTOM_LINK ou HOUSE).',
        );
      }
      kind = kindRaw as RedirectClickKind;
    }
    const limit = limitRaw != null ? parseInt(limitRaw, 10) : 50;
    const offset = offsetRaw != null ? parseInt(offsetRaw, 10) : 0;
    if (Number.isNaN(limit) || Number.isNaN(offset)) {
      throw new BadRequestException('limit e offset devem ser números.');
    }
    const linkId = (partnerShareLinkId ?? '').trim();
    return this.redirectLinksService.adminClickHistory({
      kind: linkId ? undefined : kind,
      partnerShareLinkId: linkId || undefined,
      limit,
      offset,
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

  @Patch('admin/custom/:id')
  @Roles(Role.ADMIN)
  async updateCustom(
    @Param('id') id: string,
    @Body() dto: UpdatePartnerShareLinkDto,
  ) {
    return this.redirectLinksService.adminUpdatePartnerShareLink(id, dto);
  }

  @Get('public/by-titulo/:slug')
  @Public()
  async redirectByTitulo(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res() res: Response,
    @Query('rd_vid') rdVid?: string,
  ) {
    const q = typeof rdVid === 'string' ? rdVid : undefined;
    const { visitorKey, setCookie } = resolveRedirectVisitorId({
      cookieHeader: req.headers.cookie,
      queryRdVid: q,
    });
    const url = await this.redirectLinksService.resolveCustomRedirect(
      slug,
      visitorKey,
    );
    if (setCookie) {
      res.appendHeader('Set-Cookie', buildRedirectVisitorSetCookieHeader(visitorKey));
    }
    return res.redirect(302, url);
  }

  @Get('public/by-house/:houseKey')
  @Public()
  async redirectByHouse(
    @Param('houseKey') houseKey: string,
    @Req() req: Request,
    @Res() res: Response,
    @Query('rd_vid') rdVid?: string,
  ) {
    const q = typeof rdVid === 'string' ? rdVid : undefined;
    const { visitorKey, setCookie } = resolveRedirectVisitorId({
      cookieHeader: req.headers.cookie,
      queryRdVid: q,
    });
    const url = await this.redirectLinksService.resolveHouseRedirect(
      houseKey,
      visitorKey,
    );
    if (setCookie) {
      res.appendHeader('Set-Cookie', buildRedirectVisitorSetCookieHeader(visitorKey));
    }
    return res.redirect(302, url);
  }
}
