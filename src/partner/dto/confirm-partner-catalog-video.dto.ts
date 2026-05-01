import { IsString, Matches } from 'class-validator';

export class ConfirmPartnerCatalogVideoDto {
  @IsString()
  @Matches(/^partner-catalog-videos\/[0-9]+-[a-f0-9]+\.(mp4|mov|webm|3gp)$/)
  objectKey: string;
}
