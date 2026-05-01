import { IsIn, IsString } from 'class-validator';

/** MIME enviado pelo browser antes do PUT assinado para R2. */
export class PresignPartnerCatalogVideoDto {
  @IsString()
  @IsIn(['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'])
  contentType: string;
}
