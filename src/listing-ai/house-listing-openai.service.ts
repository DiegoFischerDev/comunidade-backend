import { Injectable, Logger } from '@nestjs/common';

/** Campos estruturados de um imóvel extraídos pela OpenAI. */
export interface ScanExtractionHouse {
  title: string;
  description: string;
  businessType: 'RENT' | 'SALE';
  typology: 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'QUARTO_AP_COMPARTILHADO';
  city: string;
  priceEur: string;
  relocationFeeEur: string;
  caucoesCount: number;
  rendasEntradaCount: number;
  furnished: boolean;
  availableFrom: string | null;
}

export interface ScanExtractionResult {
  isListing: boolean;
  confidence: number;
  house: ScanExtractionHouse | null;
}

/** Campos de uma oferta de trabalho extraídos pela OpenAI. */
export interface JobOfferExtraction {
  title: string;
  jobFunction: string;
  city: string;
  description: string;
  publishedAt: string;
}

export interface JobOfferParseResult {
  isJobOffer: boolean;
  confidence: number;
  offer: JobOfferExtraction | null;
}

function parseEurAmount(raw: string): number | null {
  const cleaned = (raw ?? '').replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return null;
  const normalized = cleaned
    .replace(/\./g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function extractionRulesBlock(todayIso: string, year: number): string {
  return `Contexto temporal: hoje é ${todayIso} (ano atual: ${year}). Ao interpretar datas relativas (ex.: "entrada 5 de julho", "disponível em setembro"), assume SEMPRE o ano atual (${year}); se essa data já tiver passado este ano, usa o ano seguinte. NUNCA uses anos passados.

Regras de extração:
- "businessType": "RENT" para arrendamento/aluguer, "SALE" para venda. POR DEFEITO usa "RENT". Só usa "SALE" se o texto deixar claro que é para venda (ex.: "vende-se", "para venda", "à venda"). Valores acima de 5000€ normalmente indicam venda; valores até 5000€ indicam arrendamento (renda mensal).
- "typology": uma de T0, T1, T2, T3, T4, T5 ou QUARTO_AP_COMPARTILHADO (quarto/quarto em apartamento partilhado). Se não souberes, usa "T2".
- "city": nome da cidade/localidade em Portugal mencionada (ex.: "Lisboa", "Porto"). Se não houver, usa "".
- "priceEur": valor da renda/preço APENAS com números (ex.: "750" ou "750,50"). Sem símbolos nem texto. Se não houver, usa "".
- "relocationFeeEur": taxa de relocation/serviço se mencionada; caso contrário "0".
- "caucoesCount": nº de cauções exigidas (inteiro 0–12). Se não souberes, 0.
- "rendasEntradaCount": nº de rendas adiantadas exigidas (inteiro 0–12). Se não souberes, 0.
- "furnished": true se mobilado, senão false.
- "availableFrom": data de disponibilidade no formato AAAA-MM-DD usando as regras de contexto temporal acima; se não for mencionada, null.
- "title": título curto e descritivo (máx. ~80 caracteres) baseado no texto.
- "description": reescreve o anúncio em estilo de mensagem de WhatsApp, apelativo e fácil de ler, COM emojis e quebras de linha reais (usa \\n entre as linhas). Diretrizes:
  • começa com um emoji de casa (🏡) e a frase de abertura;
  • lista cada característica numa linha própria começando por "✔️ ";
  • usa "📍 " para localização e datas (ex.: entrada/disponibilidade);
  • usa "📩 " para a linha de contacto, se existir;
  • mantém SOMENTE a informação presente no texto (não inventes dados, valores, nem características);
  • não incluas o preço dentro da descrição.`;
}

function buildWhatsAppScanSystemPrompt(): string {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const year = now.getFullYear();
  return `És um assistente que analisa mensagens enviadas em grupos de WhatsApp sobre imóveis em Portugal.

${extractionRulesBlock(todayIso, year)}

A tua tarefa tem dois passos:
1) Classificar se a mensagem é um ANÚNCIO de imóvel (arrendamento ou venda). Mensagens de conversa, perguntas, procura de casa ("procuro T2 em Lisboa"), saudações ou spam NÃO são anúncios.
2) Se for um anúncio, extrair os dados estruturados do imóvel.

Responde SEMPRE em JSON válido, sem texto adicional, no formato:
{"isListing": boolean, "confidence": number (0..1), "house": {...} | null}
Quando "isListing" for false, "house" deve ser null.`;
}

function buildJobOfferSystemPrompt(): string {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const year = now.getFullYear();
  return `És um assistente que analisa mensagens e textos sobre emprego em Portugal.

Contexto temporal: hoje é ${todayIso} (ano atual: ${year}).

A tua tarefa tem dois passos:
1) Classificar se o texto é uma OFERTA DE TRABALHO — ou seja, alguém (empresa, recrutador, agência) está a PUBLICAR uma vaga para contratar. NÃO é oferta de trabalho:
   • mensagens de conversa, saudações, spam ou links genéricos;
   • anúncios de imóveis, serviços, produtos ou eventos;
   • candidatos à procura de emprego ("procuro trabalho", "disponível para...", CV de candidato);
   • notícias, opiniões ou partilhas sem vaga concreta.
2) Se e só se for oferta de trabalho, extrair os dados estruturados da vaga.

Regras de extração (campo "offer", só quando isJobOffer for true):
- "title": título curto da vaga (máx. ~120 caracteres) — empresa, contexto ou resumo da oportunidade.
- "jobFunction" (obrigatório): função/cargo a desempenhar (ex.: "Empregado de mesa", "Canalizador"). Máx. ~80 caracteres; usa SEMPRE a chave JSON "jobFunction", nunca "funcao" nem "cargo".
- "city": cidade ou localidade principal em Portugal (ex.: "Lisboa", "Porto"). Se remoto sem cidade, "Remoto". Se várias, a principal ou "Várias".
- "description": texto completo da oferta para o candidato — parágrafos com quebras de linha (\\n); mantém requisitos, benefícios, salário, horário e contacto do original. Não inventes dados.
- "publishedAt": data de publicação AAAA-MM-DD; se não houver data no texto, usa ${todayIso}.

Responde SEMPRE em JSON válido, sem texto adicional:
{"isJobOffer": boolean, "confidence": number (0..1), "offer": {"title", "jobFunction", "city", "description", "publishedAt"} | null}
Quando "isJobOffer" for false, "offer" deve ser null.`;
}

function buildPartnerDescriptionSystemPrompt(): string {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const year = now.getFullYear();
  return `És um assistente que extrai dados estruturados de anúncios de imóveis em Portugal a partir de descrições escritas por parceiros de relocation.

${extractionRulesBlock(todayIso, year)}

O texto do utilizador é SEMPRE um anúncio de imóvel. Extrai todos os campos possíveis.

Responde SEMPRE em JSON válido, sem texto adicional, no formato:
{"house": { "title", "description", "businessType", "typology", "city", "priceEur", "relocationFeeEur", "caucoesCount", "rendasEntradaCount", "furnished", "availableFrom" }}`;
}

function ensureFutureDate(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  let year = parseInt(m[1], 10);
  let d = new Date(year, month - 1, day);
  if (d < today) {
    year = today.getFullYear();
    d = new Date(year, month - 1, day);
    if (d < today) {
      year += 1;
    }
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeHouseRecord(
  h: Record<string, unknown>,
  defaults: { title: string; description: string },
): ScanExtractionHouse {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const intInRange = (v: unknown): number => {
    let n: number;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string') n = parseInt(v, 10);
    else n = NaN;
    if (Number.isNaN(n)) return 0;
    return Math.min(12, Math.max(0, Math.trunc(n)));
  };

  const typologyRaw = str(h.typology).toUpperCase().replace(/\s+/g, '_');
  const allowedTypology = [
    'T0',
    'T1',
    'T2',
    'T3',
    'T4',
    'T5',
    'QUARTO_AP_COMPARTILHADO',
  ];
  const typology = (
    allowedTypology.includes(typologyRaw) ? typologyRaw : 'T2'
  ) as ScanExtractionHouse['typology'];

  const priceEur = str(h.priceEur).replace(/[^\d.,]/g, '');
  const numericPrice = parseEurAmount(priceEur);

  const modelBusinessType =
    str(h.businessType).toUpperCase() === 'SALE' ? 'SALE' : 'RENT';
  const businessType: 'RENT' | 'SALE' =
    numericPrice != null && numericPrice > 0
      ? numericPrice > 5000
        ? 'SALE'
        : 'RENT'
      : modelBusinessType;

  const availableFromRaw = str(h.availableFrom);
  const availableFrom = /^\d{4}-\d{2}-\d{2}/.test(availableFromRaw)
    ? ensureFutureDate(availableFromRaw.slice(0, 10))
    : null;

  return {
    title: str(h.title).slice(0, 120) || defaults.title,
    description: str(h.description) || defaults.description,
    businessType,
    typology,
    city: str(h.city),
    priceEur,
    relocationFeeEur: str(h.relocationFeeEur).replace(/[^\d.,]/g, '') || '0',
    caucoesCount: intInRange(h.caucoesCount),
    rendasEntradaCount: intInRange(h.rendasEntradaCount),
    furnished: h.furnished === true,
    availableFrom,
  };
}

@Injectable()
export class HouseListingOpenAiService {
  private readonly logger = new Logger(HouseListingOpenAiService.name);

  private get apiKey(): string {
    return (process.env.OPENAI_API_KEY || '').trim();
  }

  private get model(): string {
    return (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private async chatJson(
    systemPrompt: string,
    rawText: string,
  ): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('OPENAI_API_KEY não está configurada.');
    }

    const controller = new AbortController();
    const timeoutMs = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 45000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: rawText },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `OpenAI respondeu ${res.status}: ${body.slice(0, 500)}`,
        );
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timeout);
    }
  }

  async extractListing(rawText: string): Promise<ScanExtractionResult> {
    const content = await this.chatJson(buildWhatsAppScanSystemPrompt(), rawText);
    return this.normalizeScanResponse(content);
  }

  /**
   * Extrai campos estruturados a partir da descrição escrita pelo parceiro (modal "Adicionar casa").
   */
  async extractJobOfferFromText(rawText: string): Promise<JobOfferParseResult> {
    const trimmed = rawText.trim();
    const content = await this.chatJson(buildJobOfferSystemPrompt(), trimmed);
    return this.normalizeJobOfferParseResponse(content, trimmed);
  }

  async extractHouseFromDescription(
    rawText: string,
  ): Promise<ScanExtractionHouse> {
    const trimmed = rawText.trim();
    const content = await this.chatJson(
      buildPartnerDescriptionSystemPrompt(),
      trimmed,
    );
    const house = this.normalizePartnerHouseResponse(content, trimmed);
    if (!house) {
      throw new Error(
        'Não foi possível extrair os dados do imóvel a partir da descrição.',
      );
    }
    return house;
  }

  private normalizeScanResponse(content: string): ScanExtractionResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      this.logger.warn(
        `Resposta da OpenAI não é JSON válido: ${content.slice(0, 200)}`,
      );
      return { isListing: false, confidence: 0, house: null };
    }

    const obj = (parsed ?? {}) as Record<string, unknown>;
    const isListing = obj.isListing === true;
    const confidence =
      typeof obj.confidence === 'number'
        ? Math.min(1, Math.max(0, obj.confidence))
        : 0;

    if (!isListing || obj.house == null || typeof obj.house !== 'object') {
      return { isListing, confidence, house: null };
    }

    const house = normalizeHouseRecord(obj.house as Record<string, unknown>, {
      title: 'Imóvel (via WhatsApp)',
      description: '—',
    });

    return { isListing: true, confidence, house };
  }

  private normalizeJobOfferParseResponse(
    content: string,
    fallbackDescription: string,
  ): JobOfferParseResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      this.logger.warn(
        `Resposta da OpenAI (oferta) não é JSON válido: ${content.slice(0, 200)}`,
      );
      return { isJobOffer: false, confidence: 0, offer: null };
    }

    const obj = (parsed ?? {}) as Record<string, unknown>;
    const isJobOffer = obj.isJobOffer === true;
    const confidence =
      typeof obj.confidence === 'number'
        ? Math.min(1, Math.max(0, obj.confidence))
        : 0;

    if (!isJobOffer || obj.offer == null || typeof obj.offer !== 'object') {
      return { isJobOffer, confidence, offer: null };
    }

    const offer = this.normalizeJobOfferFields(
      obj.offer as Record<string, unknown>,
      fallbackDescription,
    );
    if (!offer) {
      return { isJobOffer: false, confidence, offer: null };
    }

    return { isJobOffer: true, confidence, offer };
  }

  private normalizeJobOfferFields(
    raw: Record<string, unknown>,
    fallbackDescription: string,
  ): JobOfferExtraction | null {
    const str = (v: unknown): string =>
      typeof v === 'string' ? v.trim() : '';

    const title = str(raw.title).slice(0, 200);
    const jobFunction = (
      str(raw.jobFunction) ||
      str(raw.funcao) ||
      str(raw['função']) ||
      str(raw.function) ||
      str(raw.cargo) ||
      str(raw.role)
    ).slice(0, 120);
    const city = str(raw.city).slice(0, 120);
    const description = str(raw.description) || fallbackDescription;
    if (!title || !jobFunction || !city || !description) {
      return null;
    }

    const publishedRaw = str(raw.publishedAt);
    const todayIso = new Date().toISOString().slice(0, 10);
    const publishedAt = /^\d{4}-\d{2}-\d{2}/.test(publishedRaw)
      ? publishedRaw.slice(0, 10)
      : todayIso;

    return { title, jobFunction, city, description, publishedAt };
  }

  private normalizePartnerHouseResponse(
    content: string,
    fallbackDescription: string,
  ): ScanExtractionHouse | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      this.logger.warn(
        `Resposta da OpenAI (parceiro) não é JSON válido: ${content.slice(0, 200)}`,
      );
      return null;
    }

    const obj = (parsed ?? {}) as Record<string, unknown>;
    if (obj.house == null || typeof obj.house !== 'object') {
      return null;
    }

    return normalizeHouseRecord(obj.house as Record<string, unknown>, {
      title: 'Imóvel',
      description: fallbackDescription || '—',
    });
  }
}

/** Alias para compatibilidade com o módulo WhatsApp scan. */
export { HouseListingOpenAiService as WhatsappScanOpenAiService };
