import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sendLeadDocumentsEmail } from './lead-documents-email';
import {
  ACCEPTED_DOC_EXTENSIONS,
  DOC_STANDARD_NAMES,
  isDocFieldName,
  isLeadDocumentSubmissionMode,
  isVinculoLaboral,
  MAX_DOC_FILE_BYTES,
  safeExtensionFor,
  type DocFieldName,
  type LeadDocumentSubmissionMode,
  type VinculoLaboral,
} from './lead-documents.constants';

/** Apenas dígitos (mantém prefixos internacionais). */
function normalizeWhatsapp(input: string | null | undefined): string {
  return String(input ?? '').replace(/\D+/g, '');
}

/** Forma pública de um lead devolvida após a verificação do WhatsApp. */
export type LeadDocumentsContext = {
  lead: { id: string; name: string; email: string };
  partner: {
    id: string;
    name: string;
    whatsapp: string;
    logoUrl: string | null;
    shortDescription: string | null;
    email: string | null;
  };
  docsSentAt: Date | null;
  lastSubmissionAt: Date | null;
  submissionsCount: number;
};

@Injectable()
export class LeadDocumentsService {
  private readonly logger = new Logger(LeadDocumentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Confirma que o WhatsApp introduzido coincide com o do lead. Devolve dados públicos da
   * página (nome, email do lead + contactos do parceiro). Não devolve nada sensível antes da
   * confirmação — o ID do lead já é o «segredo» partilhado, mas confirmar o WhatsApp evita
   * que terceiros explorem URLs por força bruta.
   */
  async verifyByWhatsapp(
    leadId: string,
    whatsapp: string,
  ): Promise<LeadDocumentsContext> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        name: true,
        email: true,
        whatsapp: true,
        docsSentAt: true,
        partner: {
          select: {
            id: true,
            name: true,
            whatsapp: true,
            logoUrl: true,
            shortDescription: true,
            user: { select: { email: true } },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const provided = normalizeWhatsapp(whatsapp);
    if (!provided || provided.length < 6) {
      throw new BadRequestException('WhatsApp inválido.');
    }

    if (normalizeWhatsapp(lead.whatsapp) !== provided) {
      throw new ForbiddenException(
        'O número de WhatsApp não coincide com o registado para este lead.',
      );
    }

    const lastSubmission = await this.prisma.leadDocumentSubmission.findFirst({
      where: { leadId },
      orderBy: { submittedAt: 'desc' },
      select: { submittedAt: true },
    });
    const submissionsCount = await this.prisma.leadDocumentSubmission.count({
      where: { leadId },
    });

    return {
      lead: { id: lead.id, name: lead.name, email: lead.email },
      partner: {
        id: lead.partner.id,
        name: lead.partner.name,
        whatsapp: lead.partner.whatsapp,
        logoUrl: lead.partner.logoUrl,
        shortDescription: lead.partner.shortDescription,
        email: lead.partner.user?.email ?? null,
      },
      docsSentAt: lead.docsSentAt,
      lastSubmissionAt: lastSubmission?.submittedAt ?? null,
      submissionsCount,
    };
  }

  /**
   * Recebe os ficheiros + dados do formulário e dispara o email ao parceiro com tudo em
   * anexo. Regista a submissão em `LeadDocumentSubmission` e (no primeiro envio) marca
   * `Lead.docsSentAt`.
   */
  async submit(input: {
    leadId: string;
    whatsapp: string;
    mode: string;
    nome: string;
    estadoCivil: string;
    numDependentes: string;
    anosEmprego: string;
    vinculoLaboral: string;
    disponibilidadeFiador: string;
    financiamento100: boolean;
    semDocsLabels: string[];
    mensagem: string;
    files: Array<{
      fieldName: string;
      originalName: string;
      mimeType?: string;
      buffer: Buffer;
    }>;
  }): Promise<{ ok: true; documentCount: number }> {
    if (!isLeadDocumentSubmissionMode(input.mode)) {
      throw new BadRequestException('Modo de envio inválido.');
    }
    const mode: LeadDocumentSubmissionMode = input.mode;

    if (!isVinculoLaboral(input.vinculoLaboral)) {
      throw new BadRequestException('Vínculo laboral inválido.');
    }
    const vinculo: VinculoLaboral = input.vinculoLaboral;

    // Valida o WhatsApp e carrega dados do parceiro destinatário.
    const ctx = await this.verifyByWhatsapp(input.leadId, input.whatsapp);
    const partnerEmail = (ctx.partner.email ?? '').trim();
    if (!partnerEmail) {
      throw new InternalServerErrorException(
        'O parceiro atribuído ainda não tem email configurado. Avisa-nos por WhatsApp para reatribuirmos o lead.',
      );
    }

    if (input.files.length === 0) {
      throw new BadRequestException(
        'Anexa pelo menos um documento antes de enviar.',
      );
    }

    const attachments: {
      filename: string;
      content: Buffer;
      contentType?: string;
    }[] = [];
    const acceptedFields = new Set<DocFieldName>();
    for (const file of input.files) {
      if (!isDocFieldName(file.fieldName)) {
        // Ignora silenciosamente campos desconhecidos — o frontend pode estar numa versão
        // antiga que enviou campos extra. Não tem efeito sobre o que chega à gestora.
        continue;
      }
      if (acceptedFields.has(file.fieldName)) {
        // O frontend envia apenas um ficheiro por campo, mas defendemos-nos por garantia.
        continue;
      }
      if (file.buffer.length > MAX_DOC_FILE_BYTES) {
        throw new PayloadTooLargeException(
          `O ficheiro "${DOC_STANDARD_NAMES[file.fieldName]}" excede o limite de 15 MB.`,
        );
      }
      const ext = safeExtensionFor(file.originalName);
      if (!(ACCEPTED_DOC_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new BadRequestException(
          `Formato não aceite no documento "${DOC_STANDARD_NAMES[file.fieldName]}". Usa PDF, JPG ou PNG.`,
        );
      }
      acceptedFields.add(file.fieldName);
      attachments.push({
        filename: `${DOC_STANDARD_NAMES[file.fieldName]}${ext}`,
        content: file.buffer,
        contentType: file.mimeType || undefined,
      });
    }

    if (attachments.length === 0) {
      throw new BadRequestException(
        'Os ficheiros enviados não correspondem a documentos válidos.',
      );
    }

    // Envia o email ao parceiro (com CC para o lead) — se falhar, abortamos antes de
    // persistir a submissão para não criar lixo na DB.
    try {
      await sendLeadDocumentsEmail({
        mode,
        partnerEmail,
        leadName: input.nome.trim() || ctx.lead.name,
        leadEmail: ctx.lead.email,
        leadWhatsapp: input.whatsapp,
        estadoCivil: input.estadoCivil.trim(),
        numDependentes: input.numDependentes.trim(),
        anosEmprego: input.anosEmprego.trim(),
        vinculoLaboral: vinculo,
        disponibilidadeFiador: input.disponibilidadeFiador.trim(),
        financiamento100: input.financiamento100,
        semDocsLabels: input.semDocsLabels.map((s) => s.trim()).filter(Boolean),
        mensagem: input.mensagem.trim(),
        attachments,
      });
    } catch (e) {
      this.logger.error(
        `Falha ao enviar documentos do lead ${ctx.lead.id} ao parceiro ${ctx.partner.id}: ${(e as Error).message}`,
      );
      throw new InternalServerErrorException(
        'Não conseguimos enviar os documentos por email. Tenta de novo em instantes.',
      );
    }

    // Regista a submissão e, no primeiro envio, marca `docsSentAt`.
    await this.prisma.$transaction(async (tx) => {
      await tx.leadDocumentSubmission.create({
        data: {
          leadId: ctx.lead.id,
          mode,
          documentCount: attachments.length,
          vinculoLaboral: vinculo,
          estadoCivil: input.estadoCivil.trim() || null,
        },
      });
      if (!ctx.docsSentAt) {
        await tx.lead.update({
          where: { id: ctx.lead.id },
          data: { docsSentAt: new Date() },
        });
      }
    });

    return { ok: true, documentCount: attachments.length };
  }
}
