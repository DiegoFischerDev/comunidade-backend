import { IsInt, IsObject, IsOptional } from 'class-validator';
import { Prisma } from '@prisma/client';

export class UpdateChecklistDto {
  @IsObject()
  data: Prisma.InputJsonValue;

  @IsOptional()
  @IsInt()
  version?: number;
}

