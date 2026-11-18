import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
  ArrayMinSize,
} from 'class-validator';

export class CreateCrmLeadDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(8)
  whatsapp!: string;

  @IsOptional()
  @IsString()
  columnId?: string;
}

export class UpdateCrmLeadDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  guestName?: string;

  @IsOptional()
  @IsString()
  columnId?: string;

  @IsOptional()
  @IsBoolean()
  botEnabled?: boolean;

  @IsOptional()
  @IsString()
  crmComments?: string | null;

  @IsOptional()
  @IsString()
  companyName?: string | null;

  @IsOptional()
  @IsString()
  instagramHandle?: string | null;
}

export class CreateCrmColumnDto {
  @IsString()
  @MinLength(2)
  label!: string;

  @IsOptional()
  @IsString()
  tone?: string | null;

  @IsOptional()
  @IsBoolean()
  pausesBot?: boolean;
}

export class UpdateCrmColumnDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  label?: string;

  @IsOptional()
  @IsString()
  tone?: string | null;

  @IsOptional()
  @IsBoolean()
  pausesBot?: boolean;

  @IsOptional()
  sortOrder?: number;
}

export class ReorderCrmColumnsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  columnIds!: string[];
}
