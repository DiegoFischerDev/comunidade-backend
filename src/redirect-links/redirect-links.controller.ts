import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Res,
  Query,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { RedirectClickKind } from '@prisma/client';
import { RedirectLinksService } from './redirect-links.service';
import { CreatePartnerShareLinkDto } from './dto/create-partner-share-link.dto';

@Controller('redirect-links')
export class RedirectLinksController {
  constructor(private readonly redirectLinksService: RedirectLinksService) {}

  @Get('admin/overview')
  @Roles(Role.ADMIN)
  async adminOverview() {
    return this.redirectLinksService.adminOverview();
  }

  @Get('admin/clicks')
  @Roles(Role.ADMIN)
  async adminClicks(
    @Query('kind') kindRaw?: string,
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
    return this.redirectLinksService.adminClickHistory({
      kind,
      limit,
      offset,
    });
  }

  @Post('admin/custom')
  @Roles(Role.ADMIN)
  async createCustom(@Body() dto: CreatePartnerShareLinkDto) {
    return this.redirectLinksService.createPartnerShareLink(dto);
  }

  @Get('public/by-titulo/:slug')
  @Public()
  async redirectByTitulo(@Param('slug') slug: string, @Res() res: Response) {
    const url = await this.redirectLinksService.resolveCustomRedirect(slug);
    return res.redirect(302, url);
  }

  @Get('public/by-house/:houseKey')
  @Public()
  async redirectByHouse(
    @Param('houseKey') houseKey: string,
    @Res() res: Response,
    @Query('mode') mode?: string,
  ) {
    const url = await this.redirectLinksService.resolveHouseRedirect(houseKey, mode);
    return res.redirect(302, url);
  }
}
