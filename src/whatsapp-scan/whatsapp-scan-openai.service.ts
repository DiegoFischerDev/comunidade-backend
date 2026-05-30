import { Injectable, Logger } from '@nestjs/common';

/** Resultado da extração da OpenAI: classificação + campos do imóvel (quando aplicável). */
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

/**
 * Converte um valor monetário em formato livre/europeu para número.
 * Trata "." e espaços como separadores de milhar e "," como separador decimal.
 * Ex.: "200.000" → 200000, "750,50" → 750.5, "200 000" → 200000. Devolve null se não for número.
 */
function parseEurAmount(raw: string): number | null {
  const cleaned = (raw ?? '').replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return null;
  // remove pontos e espaços (milhar) e usa vírgula como decimal
  const normalized = cleaned
    .replace(/\./g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

const SYSTEM_PROMPT = `És um assistente que analisa mensagens enviadas em grupos de WhatsApp sobre imóveis em Portugal.
A tua tarefa tem dois passos:
1) Classificar se a mensagem é um ANÚNCIO de imóvel (arrendamento ou venda). Mensagens de conversa, perguntas, procura de casa ("procuro T2 em Lisboa"), saudações ou spam NÃO são anúncios.
2) Se for um anúncio, extrair os dados estruturados do imóvel.

Regras de extração:
- "businessType": "RENT" para arrendamento/aluguer, "SALE" para venda. POR DEFEITO usa "RENT". Só usa "SALE" se a mensagem deixar claro que é para venda (ex.: "vende-se", "para venda", "à venda"). Valores acima de 5000€ normalmente indicam venda; valores até 5000€ indicam arrendamento (renda mensal).
- "typology": uma de T0, T1, T2, T3, T4, T5 ou QUARTO_AP_COMPARTILHADO (quarto/quarto em apartamento partilhado). Se não souberes, usa "T2".
- "city": nome da cidade/localidade em Portugal mencionada (ex.: "Lisboa", "Porto"). Se não houver, usa "".
- "priceEur": valor da renda/preço APENAS com números (ex.: "750" ou "750,50"). Sem símbolos nem texto. Se não houver, usa "".
- "relocationFeeEur": taxa de relocation/serviço se mencionada; caso contrário "0".
- "caucoesCount": nº de cauções exigidas (inteiro 0–12). Se não souberes, 0.
- "rendasEntradaCount": nº de rendas adiantadas exigidas (inteiro 0–12). Se não souberes, 0.
- "furnished": true se mobilado, senão false.
- "availableFrom": data de disponibilidade no formato AAAA-MM-DD se mencionada, senão null.
- "title": título curto e descritivo (máx. ~80 caracteres) baseado na mensagem.
- "description": usa o texto do anúncio (limpo) como descrição.

Responde SEMPRE em JSON válido, sem texto adicional, no formato:
{"isListing": boolean, "confidence": number (0..1), "house": {...} | null}
Quando "isListing" for false, "house" deve ser null.`;

/**
 * Serviço que usa a OpenAI para classificar mensagens de grupos de WhatsApp e extrair, quando
 * aplicável, os dados de um anúncio de imóvel num JSON estruturado.
 */
@Injectable()
export class WhatsappScanOpenAiService {
  private readonly logger = new Logger(WhatsappScanOpenAiService.name);

  private get apiKey(): string {
    return (process.env.OPENAI_API_KEY || '').trim();
  }

  private get model(): string {
    return (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Envia o texto à OpenAI e devolve a classificação + dados extraídos.
   * Lança erro se a OpenAI não estiver configurada ou a chamada falhar.
   */
  async extractListing(rawText: string): Promise<ScanExtractionResult> {
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
            { role: 'system', content: SYSTEM_PROMPT },
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
      const content = data.choices?.[0]?.message?.content ?? '';
      return this.normalize(content);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Valida/normaliza o JSON devolvido pela OpenAI para o nosso formato. */
  private normalize(content: string): ScanExtractionResult {
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

    const h = obj.house as Record<string, unknown>;
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

    // Regra determinística: por defeito arrendamento. O preço é o sinal mais forte —
    // valores até 5000€ são renda mensal (RENT); acima disso, venda (SALE). Sem preço,
    // respeita a classificação da IA (que por defeito devolve RENT).
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
      ? availableFromRaw.slice(0, 10)
      : null;

    const house: ScanExtractionHouse = {
      title: str(h.title).slice(0, 120) || 'Imóvel (via WhatsApp)',
      description: str(h.description) || str(h.title) || '—',
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

    return { isListing: true, confidence, house };
  }
}
