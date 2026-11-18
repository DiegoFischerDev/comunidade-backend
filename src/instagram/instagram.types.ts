/** Mensagem inbound normalizada (DM Instagram). */
export type InstagramInboundMessage = {
  channel: 'instagram';
  /** IGSID do utilizador (remetente). */
  instagramUserId: string;
  /** IGSID da conta business (destinatário / nosso IG). */
  igBusinessAccountId: string;
  externalMessageId: string;
  text: string;
  timestampMs: number;
  raw: unknown;
};

export type InstagramWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
      };
    }>;
  }>;
};
