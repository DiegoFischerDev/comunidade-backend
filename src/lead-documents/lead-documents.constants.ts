/**
 * Constantes do módulo de upload de documentos por leads de financiamento.
 *
 * As regras (que documentos pedir) dependem das respostas que o lead dá no próprio formulário
 * de upload (vínculo laboral + checkbox de financiamento 100%). Estado civil e número de
 * dependentes vão para o corpo do email, mas não alteram a lista de documentos.
 *
 * Estes valores são partilhados entre o backend (validação + email) e o frontend (lista de
 * blocos do formulário) — manter os dois lados em sincronia.
 */

/** Modos de envio: principal (`main`), do cônjuge (`spouse`) ou complementar (`extra`). */
export const LEAD_DOCUMENT_SUBMISSION_MODES = [
  'main',
  'spouse',
  'extra',
] as const;
export type LeadDocumentSubmissionMode =
  (typeof LEAD_DOCUMENT_SUBMISSION_MODES)[number];

export function isLeadDocumentSubmissionMode(
  value: unknown,
): value is LeadDocumentSubmissionMode {
  return (
    typeof value === 'string' &&
    (LEAD_DOCUMENT_SUBMISSION_MODES as readonly string[]).includes(value)
  );
}

/** Vínculos laborais aceites (mesmos valores que o legado ia-app). */
export const VINCULOS_LABORAIS = [
  'Contrato Efetivo',
  'Contrato temporário',
  'Recibos verdes',
] as const;
export type VinculoLaboral = (typeof VINCULOS_LABORAIS)[number];

export function isVinculoLaboral(value: unknown): value is VinculoLaboral {
  return (
    typeof value === 'string' &&
    (VINCULOS_LABORAIS as readonly string[]).includes(value)
  );
}

/**
 * Nome canónico do ficheiro de cada documento. Concatenamos com a extensão original
 * (.pdf/.jpg/.jpeg/.png) ao montar os attachments do email.
 */
export const DOC_STANDARD_NAMES: Record<DocFieldName, string> = {
  cartao_residencia_ou_passaporte: 'Cartão de residência ou passaporte',
  recibo_vencimento_1: 'Recibo de vencimento 1',
  recibo_vencimento_2: 'Recibo de vencimento 2',
  recibo_vencimento_3: 'Recibo de vencimento 3',
  contrato_ou_declaracao_efetividade: 'Contrato ou declaração de efetividade',
  contrato_temporario: 'Contrato',
  extrato_recibos_12_meses: 'Extrato dos últimos 12 meses de recibos verdes',
  declaracao_abertura_atividade: 'Declaração de abertura de atividade',
  irs_declaracao: 'Declaração de IRS',
  irs_nota_liquidacao: 'Nota de liquidação IRS',
  comprovativo_morada: 'Comprovativo de morada',
  mapa_responsabilidades: 'Mapa de responsabilidades de crédito',
  declaracao_nao_divida_financas: 'Declaração de não dívida (Finanças)',
  declaracao_nao_divida_seguranca_social:
    'Declaração de não dívida (Segurança Social)',
  declaracao_predial: 'Declaração Predial negativa',
};

/** Conjunto fechado de chaves de campo aceites no upload. */
export type DocFieldName =
  | 'cartao_residencia_ou_passaporte'
  | 'recibo_vencimento_1'
  | 'recibo_vencimento_2'
  | 'recibo_vencimento_3'
  | 'contrato_ou_declaracao_efetividade'
  | 'contrato_temporario'
  | 'extrato_recibos_12_meses'
  | 'declaracao_abertura_atividade'
  | 'irs_declaracao'
  | 'irs_nota_liquidacao'
  | 'comprovativo_morada'
  | 'mapa_responsabilidades'
  | 'declaracao_nao_divida_financas'
  | 'declaracao_nao_divida_seguranca_social'
  | 'declaracao_predial';

export const DOC_FIELDS: readonly DocFieldName[] = Object.keys(
  DOC_STANDARD_NAMES,
) as DocFieldName[];

export function isDocFieldName(value: unknown): value is DocFieldName {
  return (
    typeof value === 'string' &&
    (DOC_FIELDS as readonly string[]).includes(value)
  );
}

/**
 * Conjunto base de documentos pedidos a qualquer lead (independente do vínculo).
 */
const COMMON_FIELDS: DocFieldName[] = [
  'cartao_residencia_ou_passaporte',
  'irs_declaracao',
  'irs_nota_liquidacao',
  'comprovativo_morada',
  'mapa_responsabilidades',
];

/**
 * Devolve a lista de campos obrigatórios para um lead, conforme o vínculo laboral e a flag
 * de «financiamento a 100%». Esta é a função canónica de regras, idêntica à do legado
 * `getRequiredDocFieldsByVinculo` mas tipada.
 */
export function getRequiredDocFields(input: {
  vinculo: VinculoLaboral;
  financiamento100: boolean;
}): DocFieldName[] {
  const byVinculo: DocFieldName[] =
    input.vinculo === 'Contrato temporário'
      ? [
          'recibo_vencimento_1',
          'recibo_vencimento_2',
          'recibo_vencimento_3',
          'contrato_temporario',
        ]
      : input.vinculo === 'Recibos verdes'
        ? ['extrato_recibos_12_meses', 'declaracao_abertura_atividade']
        : [
            'recibo_vencimento_1',
            'recibo_vencimento_2',
            'recibo_vencimento_3',
            'contrato_ou_declaracao_efetividade',
          ];

  const cartao: DocFieldName = 'cartao_residencia_ou_passaporte';
  const base = [
    cartao,
    ...byVinculo,
    ...COMMON_FIELDS.filter((f) => f !== cartao),
  ];

  if (!input.financiamento100) return base;

  return [
    ...base,
    'declaracao_nao_divida_financas',
    'declaracao_nao_divida_seguranca_social',
    'declaracao_predial',
  ];
}

/** Extensões aceites para upload (case-insensitive). Outros tipos são rejeitados. */
export const ACCEPTED_DOC_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
] as const;

/** Tamanho máximo por ficheiro: 15 MB (mesmo limite do legado). */
export const MAX_DOC_FILE_BYTES = 15 * 1024 * 1024;

/** Normaliza a extensão de um nome de ficheiro ou fica em `.pdf` por defeito. */
export function safeExtensionFor(
  originalName: string | null | undefined,
): string {
  if (!originalName) return '.pdf';
  const idx = originalName.lastIndexOf('.');
  if (idx === -1) return '.pdf';
  const ext = originalName.slice(idx).toLowerCase();
  return (ACCEPTED_DOC_EXTENSIONS as readonly string[]).includes(ext)
    ? ext
    : '.pdf';
}
