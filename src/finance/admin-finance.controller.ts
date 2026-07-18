import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  CreateFinanceEntryDto,
  UpdateFinanceEntryDto,
} from './dto/finance-entry.dto';
import { FinanceService } from './finance.service';

@Controller('admin/finance')
@Roles(Role.ADMIN)
export class AdminFinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get()
  list() {
    return this.finance.listEntries();
  }

  @Post()
  create(@Body() dto: CreateFinanceEntryDto) {
    return this.finance.createEntry({
      kind: dto.kind,
      title: dto.title,
      paidAt: dto.paidAt,
      amount: dto.amount,
      receiptImageUrl: dto.receiptImageUrl,
      comment: dto.comment,
      whatsapp: dto.whatsapp,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFinanceEntryDto) {
    return this.finance.updateEntry({
      id: id.trim(),
      kind: dto.kind,
      title: dto.title,
      paidAt: dto.paidAt,
      amount: dto.amount,
      receiptImageUrl: dto.receiptImageUrl,
      comment: dto.comment,
      whatsapp: dto.whatsapp,
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.finance.deleteEntry(id.trim());
  }
}
