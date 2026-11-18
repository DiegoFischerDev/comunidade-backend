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
  /** Nome do perfil (Graph User Profile) — o webhook não traz isto. */
  profileName?: string | null;
  /** @username do Instagram (Graph User Profile). */
  profileUsername?: string | null;
  /** URL temporária da foto (Graph) — expira em poucos dias; descarregar e guardar. */
  profilePicUrl?: string | null;
  raw: unknown;
};

export type InstagramUserProfile = {
  name: string | null;
  username: string | null;
  /** URL CDN Meta; pode ser null e expira em poucos dias. */
  profilePicUrl: string | null;
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
