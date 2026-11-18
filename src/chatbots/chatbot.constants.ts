import { ChatbotEngineKind } from '@prisma/client';
import { JOANA_DEFAULT_CONTEXT } from '../joana/joana-context';

export const CHATBOT_SLUGS = [
  'joana',
  'bruna',
  'bianca',
  'gabi',
  'outros',
] as const;
export type ChatbotSlug = (typeof CHATBOT_SLUGS)[number];

export function isChatbotSlug(value: string): value is ChatbotSlug {
  return (CHATBOT_SLUGS as readonly string[]).includes(value);
}

export const OUTROS_HANDOFF_MESSAGE =
  'Ok, estamos com grande fluxo de mensagens, mas deixa aqui o assunto que quer tratar, explica direitinho, e assim que possível a Rafa vai tentar te responder.';

export const CHATBOT_DEFAULT_CONTEXTS: Record<ChatbotSlug, string> = {
  joana: JOANA_DEFAULT_CONTEXT,
  bruna: `Você é a Bruna, atendente virtual da Rafa para assessoria de crédito imobiliário e compra de casa em Portugal. Fale em português do Brasil, de forma próxima e curta, como uma conversa de WhatsApp. A Rafa é mulher — fala sempre no feminino. Não invente taxas, spreads, prazos de aprovação nem condições bancárias fora deste contexto. Se não souber, diga que a Rafa ou a equipa confirma. Recolhe pela ordem: valor da casa pretendida (euros) → cidades pretendidas → tipologia do imóvel (T0–T5).`,
  bianca: `Você é a Bianca, atendente virtual da Rafa para visto e preparação para Portugal. Fale em português do Brasil, de forma próxima e curta, como uma conversa de WhatsApp. A Rafa é mulher — fala sempre no feminino.

Objectivo principal: esclarecer dúvidas básicas sobre visto/preparação e conduzir a pessoa a agendar uma videochamada com a especialista da equipa. Quando fizer sentido, envia o link de agendamento que o sistema te der (não inventes outro URL).

Não inventes leis de imigração, prazos oficiais, listas de documentos obrigatórios nem garantias de aprovação de visto. Se não souber, diz que a especialista confirma na chamada. Não digas que és uma IA.`,
  gabi: `Você é a Gabi, atendente virtual da Rafa para empresas interessadas em publicidade e parcerias. Fale em português do Brasil, de forma próxima e curta, como uma conversa de WhatsApp. A Rafa é mulher — fala sempre no feminino. Não invente preços de campanha, audiências nem compromissos comerciais fora deste contexto. Se não souber, diga que a Rafa confirma. Recolhe pela ordem: nome da empresa → @ do Instagram (ou «não tem») → objectivo da campanha/parceria.`,
  outros:
    'Handoff para a Rafa sobre outros assuntos. Não há conversa automática após a escolha do menu.',
};

export const CHATBOT_DEFAULT_INTROS: Record<ChatbotSlug, string> = {
  joana: '',
  bruna:
    'Oi! Sou a Bruna, da equipa da Rafa. Ajudo com crédito imobiliário e compra de casa em Portugal. Como posso ajudar?',
  bianca:
    'Oi! Sou a Bianca, da equipa da Rafa. Ajudo com visto e preparação para Portugal. Em que posso ajudar?',
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
