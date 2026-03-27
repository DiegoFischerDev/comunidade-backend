import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { SaleService } from './sale.service';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';

@Controller('sales')
export class SaleController {
  constructor(private readonly saleService: SaleService) {}

  // Parceiro - lookup (leads + serviços)
  @Get('partner/lookup')
  @Roles(Role.PARTNER)
  async getPartnerLookup(@CurrentUser() user: { id: string }) {
    return this.saleService.getPartnerLookup(user.id);
  }

  // Parceiro - criar venda
  @Post('partner')
  @Roles(Role.PARTNER)
  async createPartnerSale(
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      leadId: string;
      serviceId: string;
      month: number;
      year: number;
      amount?: number;
    },
  ) {
    return this.saleService.createPartnerSale({
      userId: user.id,
      leadId: body.leadId,
      serviceId: body.serviceId,
      month: body.month,
      year: body.year,
      amount: body.amount,
    });
  }

  // Parceiro - listar vendas (pendentes, aprovadas, recusadas)
  @Get('partner')
  @Roles(Role.PARTNER)
  async listPartnerSales(@CurrentUser() user: { id: string }) {
    return this.saleService.listPartnerSales(user.id);
  }

  // Parceiro - iniciar pagamento de comissão (Stripe MB WAY)
  @Post('partner/:id/pay-commission')
  @Roles(Role.PARTNER)
  async createPartnerCommissionPayment(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') saleId: string,
    @Body()
    body: {
      amountEuro: number;
      successUrl: string;
      cancelUrl: string;
      wantsInvoice?: boolean;
    },
  ) {
    return this.saleService.createPartnerCommissionPayment({
      userId: user.id,
      saleId,
      amountEuro: body.amountEuro,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      wantsInvoice: body.wantsInvoice ?? false,
    });
  }

  // Parceiro - aprovar / recusar venda
  @Patch('partner/:id/status')
  @Roles(Role.PARTNER)
  async updatePartnerSaleStatus(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { status: 'APPROVED' | 'REJECTED' },
  ) {
    return this.saleService.updatePartnerSaleStatus({
      userId: user.id,
      saleId: id,
      status: body.status,
    });
  }

  // Usuário - lookup de parceiros (USER, PARTNER e ADMIN para ver página Cashback)
  @Get('user/lookup')
  @Roles(Role.USER, Role.PARTNER, Role.ADMIN)
  async getUserLookup() {
    return this.saleService.getUserLookup();
  }

  // Usuário - listar serviços de um parceiro
  @Get('user/partners/:partnerId/services')
  @Roles(Role.USER, Role.PARTNER, Role.ADMIN)
  async listServicesForPartner(@Param('partnerId') partnerId: string) {
    return this.saleService.listServicesForPartner(partnerId);
  }

  // Usuário - criar registro de compra
  @Post('user')
  @Roles(Role.USER, Role.PARTNER, Role.ADMIN)
  async createUserSale(
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      partnerId: string;
      serviceId: string;
      month: number;
      year: number;
      amount?: number;
    },
  ) {
    return this.saleService.createUserSale({
      userId: user.id,
      partnerId: body.partnerId,
      serviceId: body.serviceId,
      month: body.month,
      year: body.year,
      amount: body.amount,
    });
  }

  // Usuário - listar compras
  @Get('user')
  @Roles(Role.USER, Role.PARTNER, Role.ADMIN)
  async listUserSales(@CurrentUser() user: { id: string }) {
    return this.saleService.listUserSales(user.id);
  }

  // Usuário - solicitar cashback (MB Way)
  @Post('user/:id/cashback')
  @Roles(Role.USER, Role.PARTNER, Role.ADMIN)
  async requestCashback(
    @CurrentUser() user: { id: string },
    @Param('id') saleId: string,
    @Body() body: { mbwayNumber: string; mbwayName: string },
  ) {
    return this.saleService.requestCashback({
      userId: user.id,
      saleId,
      mbwayNumber: body.mbwayNumber ?? '',
      mbwayName: body.mbwayName ?? '',
    });
  }

  // Usuário - enviar comprovativo de pagamento (print)
  @Post('user/:id/payment-proof')
  @Roles(Role.USER, Role.PARTNER, Role.ADMIN)
  async addPaymentProof(
    @CurrentUser() user: { id: string },
    @Param('id') saleId: string,
    @Body() body: { paymentProofUrl: string },
  ) {
    return this.saleService.addPaymentProofForUser({
      userId: user.id,
      saleId,
      paymentProofUrl: body.paymentProofUrl,
    });
  }

  // Admin - listar todas as compras (com filtros)
  @Get('admin')
  @Roles(Role.ADMIN)
  async listAllSalesForAdmin(
    @Query('partnerId') partnerId?: string,
    @Query('status') status?: 'PENDING_PARTNER' | 'APPROVED' | 'REJECTED',
    @Query('cashbackOnly') cashbackOnly?: string,
  ) {
    return this.saleService.listAllSalesForAdmin({
      partnerId: partnerId || undefined,
      status,
      cashbackOnly: cashbackOnly === 'true' || cashbackOnly === '1',
    });
  }

  // Admin - marcar cashback como pago (mbway pago)
  @Patch('admin/:id/cashback-paid')
  @Roles(Role.ADMIN)
  async markCashbackPaid(@Param('id') saleId: string) {
    return this.saleService.markCashbackPaid(saleId);
  }

  // Admin - excluir registro de compra
  @Delete('admin/:id')
  @Roles(Role.ADMIN)
  async deleteSaleForAdmin(@Param('id') saleId: string) {
    return this.saleService.deleteSaleForAdmin(saleId);
  }

  // Admin - enviar fatura (upload PDF + email ao parceiro)
  @Post('admin/:id/invoice')
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
          const ext = extname(file.originalname) || '.pdf';
          cb(null, `invoice-${unique}${ext}`);
        },
      }),
    }),
  )
  async uploadAndSendInvoice(
    @Param('id') saleId: string,
    @UploadedFile() file: any,
  ) {
    return this.saleService.uploadAndSendInvoiceAdmin({ saleId, file });
  }
}

