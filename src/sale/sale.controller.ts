import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { SaleService } from './sale.service';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';

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

  // Usuário - lookup de parceiros
  @Get('user/lookup')
  @Roles(Role.USER, Role.PARTNER)
  async getUserLookup() {
    return this.saleService.getUserLookup();
  }

  // Usuário - listar serviços de um parceiro
  @Get('user/partners/:partnerId/services')
  @Roles(Role.USER, Role.PARTNER)
  async listServicesForPartner(@Param('partnerId') partnerId: string) {
    return this.saleService.listServicesForPartner(partnerId);
  }

  // Usuário - criar registro de compra
  @Post('user')
  @Roles(Role.USER, Role.PARTNER)
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
  @Roles(Role.USER, Role.PARTNER)
  async listUserSales(@CurrentUser() user: { id: string }) {
    return this.saleService.listUserSales(user.id);
  }
}

