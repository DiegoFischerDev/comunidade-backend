import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PARTNER_HOUSE_CITY_CODES,
  PARTNER_HOUSE_ENTRADA_COUNT,
  PARTNER_HOUSE_FURNISHED_VALUES,
  PARTNER_HOUSE_TYPOLOGY_CODES,
} from './create-partner-house.dto';

/** Multipart PATCH — todos os campos opcionais. */
export class UpdatePartnerHouseDto {
  @IsOptional()
  @IsString({ message: 'O título deve ser texto.' })
  @MinLength(3, { message: 'O título deve ter pelo menos 3 caracteres.' })
  @MaxLength(120, { message: 'O título não pode ter mais de 120 caracteres.' })
  title?: string;

  @IsOptional()
  @IsString({ message: 'A descrição deve ser texto.' })
  @MinLength(10, { message: 'A descrição deve ter pelo menos 10 caracteres.' })
  @MaxLength(2000, { message: 'A descrição não pode ter mais de 2000 caracteres.' })
  description?: string;

  @IsOptional()
  @IsString({ message: 'Indica uma cidade válida.' })
  @IsIn(PARTNER_HOUSE_CITY_CODES as unknown as string[], {
    message: 'Cidade inválida.',
  })
  city?: (typeof PARTNER_HOUSE_CITY_CODES)[number];

  @IsOptional()
  @IsString({ message: 'Indica uma tipologia válida.' })
  @IsIn(PARTNER_HOUSE_TYPOLOGY_CODES as unknown as string[], {
    message: 'Tipologia inválida.',
  })
  typology?: (typeof PARTNER_HOUSE_TYPOLOGY_CODES)[number];

  @IsOptional()
  @IsDateString(
    {},
    {
      message:
        'A data «Disponível em» é inválida. Usa o formato AAAA-MM-DD.',
    },
  )
  availableFrom?: string;

  @IsOptional()
  @IsString({ message: 'Indica o valor da renda mensal.' })
  @MinLength(1, { message: 'Indica o valor da renda mensal.' })
  @MaxLength(40, { message: 'O valor da renda mensal é demasiado longo.' })
  priceEur?: string;

  @IsOptional()
  @IsString({ message: 'Indica a taxa de relocation.' })
  @MinLength(1, { message: 'Indica a taxa de relocation.' })
  @MaxLength(20, { message: 'O valor da taxa de relocation é demasiado longo.' })
  relocationFeeEur?: string;

  @IsOptional()
  @IsString({ message: 'Indica o número de cauções (0 a 12).' })
  @IsIn([...PARTNER_HOUSE_ENTRADA_COUNT] as unknown as string[], {
    message: 'Número de cauções inválido.',
  })
  caucoesCount?: string;

  @IsOptional()
  @IsString({ message: 'Indica o número de rendas antecipadas (0 a 12).' })
  @IsIn([...PARTNER_HOUSE_ENTRADA_COUNT] as unknown as string[], {
    message: 'Número de rendas antecipadas inválido.',
  })
  rendasEntradaCount?: string;

  @IsOptional()
  @IsString({ message: 'Indica se o imóvel é mobilado (sim ou não).' })
  @IsIn([...PARTNER_HOUSE_FURNISHED_VALUES] as unknown as string[], {
    message: 'Valor de «mobilado» inválido.',
  })
  furnished?: string;

  /**
   * JSON array de URLs de imagens existentes a manter (ordem).
   * Omissão = manter todas as atuais se não houver novos ficheiros `images`.
   */
  @IsOptional()
  @IsString()
  keepImageUrls?: string;

  /** `"true"` para remover o vídeo sem enviar ficheiro novo. */
  @IsOptional()
  @IsString()
  removeVideo?: string;

  /** Índice 0–5 da foto principal na lista final (imagens mantidas + novas, nessa ordem). Omissão = manter se ainda válida. */
  @IsOptional()
  @IsString()
  @IsIn(['0', '1', '2', '3', '4', '5'], {
    message: 'Índice da foto principal inválido.',
  })
  coverImageIndex?: string;
}
