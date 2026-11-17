import { Injectable } from '@nestjs/common';
import { JOANA_DEFAULT_CONTEXT } from './joana-context';
import {
  JOANA_TYPOLOGIES,
  type JoanaProposal,
  type JoanaTypology,
  canonicalImmigration,
  parseJoanaTypology,
} from './joana-turn';

@Injectable()
export class JoanaOpenAiService {
  private get apiKey(): string {
    return (process.env.OPENAI_API_KEY || '').trim();
  }

  private get model(): string {
    return (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async interpret(input: {
    context: string;
    transcript: string;
    profileSummary: string;
    pendingQuestion: string | null;
    combinedText: string;
  }): Promise<{ reply: string; proposal: JoanaProposal }> {
    if (!this.isConfigured()) {
      throw new Error('OPENAI_API_KEY não está configurada.');
    }

    const system = [
      input.context.trim() || JOANA_DEFAULT_CONTEXT,
      '',
      'Você responde no WhatsApp. A resposta em "reply" responde só ao que a pessoa perguntou ou, se for o primeiro contacto, apresenta-se como Joana e explica o serviço do Rafa em poucas frases.',
      'Não peça dados do CRM e não peça confirmação de atualização. O sistema acrescenta essa pergunta depois.',
      'Não diga que gravou um dado. Não invente preço nem horário.',
      'Devolva só JSON com as chaves: reply, interested, confirmation, name, immigration, cities, typology, hasPet.',
      'interested: true se a pessoa quer o relocation ou está a pedir informação para avançar; false se recusou; null se ainda não deu para saber.',
      'confirmation: "yes" se a pessoa aceitou a confirmação pendente, "no" se recusou, null se não havia confirmação ou a resposta não foi sim nem não.',
      'name, immigration, cities, typology, hasPet: omita a chave se a pessoa não falou desse dado. immigration é YYYY-MM-DD, "IMEDIATO", ou "" para apagar. typology é uma de: QUARTO, T0, T1, T2, T3, T4, T5. hasPet é true ou false.',
      'cities pode juntar várias cidades numa frase.',
    ].join('\n');

    const user = [
      `Ficha atual: ${input.profileSummary}`,
      input.pendingQuestion
        ? `Confirmação pendente: ${input.pendingQuestion}`
        : 'Sem confirmação pendente.',
      input.transcript ? `Histórico:\n${input.transcript}` : 'Sem histórico.',
      `Mensagem agora:\n${input.combinedText}`,
    ].join('\n\n');

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
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`OpenAI respondeu ${res.status}: ${body.slice(0, 500)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content ?? '';
      return parseJoanaModelJson(content);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function parseJoanaModelJson(content: string): {
  reply: string;
  proposal: JoanaProposal;
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {
      reply: '',
      proposal: { interested: null, confirmation: null },
    };
  }

  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim().slice(0, 1500) : '';
  const interested =
    parsed.interested === true ? true : parsed.interested === false ? false : null;
  const confirmation =
    parsed.confirmation === 'yes' || parsed.confirmation === 'no'
      ? parsed.confirmation
      : null;

  const proposal: JoanaProposal = { interested, confirmation };

  if (typeof parsed.name === 'string') proposal.name = parsed.name;
  if (typeof parsed.immigration === 'string') {
    const canonical = canonicalImmigration(parsed.immigration);
    if (canonical !== null) proposal.immigration = canonical;
  }
  if (typeof parsed.cities === 'string') proposal.cities = parsed.cities;
  if (typeof parsed.typology === 'string') {
    const typology = parseJoanaTypology(parsed.typology);
    if (typology && (JOANA_TYPOLOGIES as readonly string[]).includes(typology)) {
      proposal.typology = typology as JoanaTypology;
    } else if (!parsed.typology.trim()) {
      proposal.typology = '';
    }
  }
  if (parsed.hasPet === true || parsed.hasPet === false) proposal.hasPet = parsed.hasPet;

  return { reply, proposal };
}
