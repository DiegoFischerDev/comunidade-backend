import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from '../auth/public.decorator';
import { VerifyLeadDocumentsDto } from './dto/verify-lead.dto';
import { LeadDocumentsService } from './lead-documents.service';
import { MAX_DOC_FILE_BYTES } from './lead-documents.constants';

/**
 * Endpoints públicos para o lead enviar documentos ao parceiro de financiamento atribuído.
 *
 * Autorização: o lead «autentica-se» enviando o WhatsApp registado no `Lead`. O backend
 * procura o lead mais recente para esse WhatsApp e devolve os dados do parceiro associado;
 * não há `leadId` no path porque o WhatsApp é a chave estável (o utilizador pode aceder ao
 * formulário a partir do banner em `/financiamento` sem ter de saber o ID do lead).
 */
@Controller('lead-documents')
export class LeadDocumentsController {
  constructor(private readonly service: LeadDocumentsService) {}

  /** Confirma o WhatsApp do lead e devolve dados para a página de upload. */
  @Public()
  @Post('verify')
  verify(@Body() dto: VerifyLeadDocumentsDto) {
    return this.service.verifyByWhatsapp(dto.whatsapp);
  }

  /**
   * Recebe os ficheiros + dados do formulário (multipart/form-data) e envia o email ao
   * parceiro com tudo em anexo. Cada campo de ficheiro tem o nome do `field` (ex.:
   * `cartao_residencia_ou_passaporte`); os campos de texto vão no `body`.
   */
  @Public()
  @Post('submit')
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOC_FILE_BYTES, files: 30 },
    }),
  )
  async submit(
    @UploadedFiles() rawFiles: Express.Multer.File[] | undefined,
    @Body() body: Record<string, string | string[] | undefined>,
  ) {
    const whatsapp = String(body.whatsapp ?? '');
    const mode = String(body.mode ?? 'main');
    const nome = String(body.nome ?? '');
    const estadoCivil = String(body.estado_civil ?? '');
    const numDependentes = String(body.num_dependentes ?? '');
    const anosEmprego = String(body.anos_emprego_atual ?? '');
    const vinculoLaboral = String(body.vinculo_laboral ?? '');
    const disponibilidadeFiador = String(body.disponibilidade_fiador ?? '');
    const financiamento100Raw = body.financiamento_100;
    const financiamento100 =
      financiamento100Raw === '1' ||
      financiamento100Raw === 'true' ||
      financiamento100Raw === 'on';
    const mensagem = String(body.mensagem_gestora ?? '');

    const semDocsRaw = body.sem_docs_labels;
    const semDocsLabels = Array.isArray(semDocsRaw)
      ? semDocsRaw.map((s) => String(s))
      : typeof semDocsRaw === 'string' && semDocsRaw.length
        ? semDocsRaw.split(',').map((s) => s.trim())
        : [];

    const files = (rawFiles ?? []).map((f) => ({
      fieldName: f.fieldname,
      originalName: f.originalname,
      mimeType: f.mimetype,
      buffer: f.buffer,
    }));

    return this.service.submit({
      whatsapp,
      mode,
      nome,
      estadoCivil,
      numDependentes,
      anosEmprego,
      vinculoLaboral,
      disponibilidadeFiador,
      financiamento100,
      semDocsLabels,
      mensagem,
      files,
    });
  }
}
