import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { Role } from '@prisma/client';

const SALT_ROUNDS = 10;

@Injectable()
export class PartnerService {
  constructor(private readonly prisma: PrismaService) {}

  async createPartner(dto: CreatePartnerDto) {
    const normalizedEmail = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      throw new ConflictException('Já existe um usuário com este e-mail.');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          role: Role.PARTNER,
        },
      });

      const partner = await this.prisma.partner.create({
        data: {
          userId: user.id,
          name: dto.name,
          whatsapp: dto.whatsapp,
          logoUrl: dto.logoUrl,
        },
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        partner,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        'Erro ao criar parceiro. Tente novamente mais tarde.',
      );
    }
  }
}

