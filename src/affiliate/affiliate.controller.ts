import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Role, CashbackPayoutMethod } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AffiliateService } from './affiliate.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';

@Controller('affiliate')
export class AffiliateController {
  constructor(private readonly affiliateService: AffiliateService) {}

  @Post('enroll')
  @Roles(Role.USER, Role.PARTNER, Role.ADMIN)
  async enroll(
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      instagramHandle: string;
      termsAccepted: boolean;
      payoutMethod: CashbackPayoutMethod;
      mbwayNumber?: string;
      mbwayName?: string;
      pixKey?: string;
      pixName?: string;
    },
  ) {
    return this.affiliateService.enroll({
      userId: user.id,
      instagramHandle: body.instagramHandle,
      termsAccepted: body.termsAccepted,
      payoutMethod: body.payoutMethod,
      mbwayNumber: body.mbwayNumber,
      mbwayName: body.mbwayName,
      pixKey: body.pixKey,
      pixName: body.pixName,
    });
  }

  @Get('me')
  @Roles(Role.USER, Role.PARTNER, Role.ADMIN)
  async me(@CurrentUser() user: { id: string }) {
    return this.affiliateService.me(user.id);
  }

  @Patch('me/payout')
  @Roles(Role.USER, Role.PARTNER, Role.ADMIN)
  async updatePayout(
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      payoutMethod: CashbackPayoutMethod;
      mbwayNumber?: string;
      mbwayName?: string;
      pixKey?: string;
      pixName?: string;
    },
  ) {
    return this.affiliateService.updatePayout({
      userId: user.id,
      payoutMethod: body.payoutMethod,
      mbwayNumber: body.mbwayNumber,
      mbwayName: body.mbwayName,
      pixKey: body.pixKey,
      pixName: body.pixName,
    });
  }

  @Get('my-referrals')
  @Roles(Role.USER, Role.PARTNER, Role.ADMIN)
  async myReferrals(@CurrentUser() user: { id: string }) {
    return this.affiliateService.myReferrals(user.id);
  }

  @Get('my-commissions')
  @Roles(Role.USER, Role.PARTNER, Role.ADMIN)
  async myCommissions(@CurrentUser() user: { id: string }) {
    return this.affiliateService.myCommissions(user.id);
  }

  @Get('admin/list')
  @Roles(Role.ADMIN)
  async adminList() {
    return this.affiliateService.adminList();
  }

  @Get('admin/:affiliateId/paid-commissions')
  @Roles(Role.ADMIN)
  async adminPaidCommissions(@Param('affiliateId') affiliateId: string) {
    return this.affiliateService.adminPaidCommissionsHistory(affiliateId);
  }

  @Post('admin/:affiliateId/pay')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads');
          mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (_req, file, cb) => {
          const unique = Date.now();
          const ext = extname(file.originalname) || '';
          cb(null, `affiliate-commission-proof-${unique}${ext}`);
        },
      }),
    }),
  )
  async adminPay(
    @Param('affiliateId') affiliateId: string,
    @UploadedFile() file: any,
    @Body() body: { commissionIds?: string[] },
  ) {
    return this.affiliateService.adminPayCommissions({
      affiliateId,
      file,
      commissionIds: body.commissionIds,
    });
  }
}

