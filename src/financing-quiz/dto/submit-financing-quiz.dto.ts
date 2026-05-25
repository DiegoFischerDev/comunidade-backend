import {
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class FinancingQuizAnswersDto {
  @IsIn(['SIM', 'NAO'])
  residencePt!: 'SIM' | 'NAO';

  @IsIn(['casado', 'solteiro'])
  mode!: 'casado' | 'solteiro';

  // Trilha residente
  @IsOptional()
  @IsIn(['SIM', 'NAO'])
  q2?: 'SIM' | 'NAO';

  @IsOptional()
  @IsIn(['SIM', 'NAO'])
  q3?: 'SIM' | 'NAO';

  @IsOptional()
  @IsIn(['SIM', 'NAO'])
  q5?: 'SIM' | 'NAO';

  @IsOptional()
  @IsIn(['SIM', 'NAO'])
  q7?: 'SIM' | 'NAO';

  @IsOptional()
  @IsIn(['SIM', 'NAO'])
  capitalOk?: 'SIM' | 'NAO';

  // Trilha estrangeiro
  @IsOptional()
  @IsIn(['SIM', 'NAO'])
  foreignCtef?: 'SIM' | 'NAO';

  @IsOptional()
  @IsIn(['SIM', 'NAO'])
  foreignCapital?: 'SIM' | 'NAO';
}

export class SubmitFinancingQuizDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(8)
  whatsapp!: string;

  @ValidateNested()
  @Type(() => FinancingQuizAnswersDto)
  answers!: FinancingQuizAnswersDto;
}

export class RequestAtendimentoDto {
  @IsString()
  @MinLength(8)
  whatsapp!: string;
}
