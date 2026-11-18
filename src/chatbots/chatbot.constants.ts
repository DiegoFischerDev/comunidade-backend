import { ChatbotEngineKind } from '@prisma/client';
import { JOANA_DEFAULT_CONTEXT } from '../joana/joana-context';

export const CHATBOT_SLUGS = ['joana', 'bruna', 'gabi', 'outros'] as const;
export type ChatbotSlug = (typeof CHATBOT_SLUGS)[number];

export function isChatbotSlug(value: string): value is ChatbotSlug {
  return (CHATBOT_SLUGS as readonly string[]).includes(value);
}

export const OUTROS_HANDOFF_MESSAGE =
  'Ok, estamos com grande fluxo de mensagens, mas deixa aqui o assunto que quer tratar, explica direitinho, e assim que possível a Rafa vai tentar te responder.';

export const CHATBOT_DEFAULT_CONTEXTS: Record<ChatbotSlug, string> = {
  joana: JOANA_DEFAULT_CONTEXT,
  bruna: `Você é a Bruna, atendente virtual da Rafa para assessoria de crédito imobiliário e compra de casa em Portugal. Fale em português do Brasil, de forma próxima e curta, como uma conversa de WhatsApp. A Rafa é mulher — fala sempre no feminino. Não invente taxas, spreads, prazos de aprovação nem condições bancárias fora deste contexto. Se não souber, diga que a Rafa ou a equipa confirma. Ofereça-se para esclarecer dúvidas e recolher o interesse da pessoa.`,
  gabi: `Você é a Gabi, atendente virtual da Rafa para empresas interessadas em publicidade e parcerias. Fale em português do Brasil, de forma próxima e curta, como uma conversa de WhatsApp. A Rafa é mulher — fala sempre no feminino. Não invente preços de campanha, audiências nem compromissos comerciais fora deste contexto. Se não souber, diga que a Rafa confirma. Recolhe o nome da empresa e o @ do Instagram (se tiverem; se não tiverem, anota que não se aplica). Depois podes perguntar o objectivo da campanha.`,
  outros:
    'Handoff para a Rafa sobre outros assuntos. Não há conversa automática após a escolha do menu.',
};

export const CHATBOT_DEFAULT_INTROS: Record<ChatbotSlug, string> = {
  joana: '',
  bruna:
    'Oi! Sou a Bruna, da equipa da Rafa. Ajudo com crédito imobiliário e compra de casa em Portugal. Como posso ajudar?',
  gabi:
    'Oi! Sou a Gabi, da equipa da Rafa. Trato de publicidade e parcerias com empresas. Em que posso ajudar?',
  outros: '',
};

export function chatbotWhatsappInstance(): string {
  return (
    process.env.JOANA_WHATSAPP_INSTANCE ||
    process.env.RAFA_CALL_WHATSAPP_TRIGGER_INSTANCE ||
    'comunidade MEO'
  ).trim();
}

export function chatbotDebounceMs(): number {
  const raw = Number(process.env.JOANA_DEBOUNCE_MS ?? 15_000);
  if (!Number.isFinite(raw) || raw < 0) return 15_000;
  return Math.min(raw, 120_000);
}

export { ChatbotEngineKind };
