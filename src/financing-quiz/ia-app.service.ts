import { BadRequestException, Injectable, Logger } from '@nestjs/common';

/** Estrutura mínima conhecida do objeto `gestora` devolvido pela ia-app. */
export type GestoraShape = {
  id?: number;
  nome?: string | null;
  email?: string | null;
  email_para_leads?: string | null;
  whatsapp?: string | null;
  foto_perfil?: string | null;
  boas_vindas?: string | null;
};

/** Estrutura mínima conhecida do objeto `lead` devolvido pela ia-app. */
export type GestoraLeadShape = {
  id?: number;
  whatsapp_number?: string | null;
  nome?: string | null;
  upload_url?: string | null;
};

/**
 * Wrapper para a integração HTTP com a `ia-app` (https://ia.rafaapelomundo.com), que é a fonte
 * de verdade dos leads e gestoras. Espelha as 3 chamadas que o receiver wa-verify usa.
 */
@Injectable()
export class IaAppService {
  private readonly logger = new Logger(IaAppService.name);

  private get baseUrl(): string {
    const raw = process.env.IA_APP_BASE_URL || 'https://ia.rafaapelomundo.com/';
    return raw.replace(/\/$/, '');
  }

  private get secret(): string {
    return process.env.IA_APP_INTEGRATION_SECRET?.trim() || '';
  }

  private assertConfigured(): void {
    if (!this.secret) {
      throw new BadRequestException('Integração com a ia-app não configurada no servidor.');
    }
  }

  /** Normaliza WhatsApp para dígitos. */
  static normalizeWhatsapp(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  /** Cria (ou reaproveita) um lead na ia-app. Devolve `{ ok, lead, upload_url }`. */
  async createLead(params: {
    whatsapp: string;
    nome: string;
    comentario?: string;
  }): Promise<{ ok: true; upload_url: string; [k: string]: unknown }> {
    this.assertConfigured();
    const body: Record<string, string> = {
      whatsapp: params.whatsapp,
      nome: params.nome || 'Cliente Comunidade',
    };
    const c = (params.comentario ?? '').trim();
    if (c) body.comentario = c;

    const res = await fetch(`${this.baseUrl}/api/integration/leads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Integration-Secret': this.secret,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    const ok =
      (res.status === 201 || res.status === 200) &&
      json.ok === true &&
      typeof json.upload_url === 'string' &&
      json.upload_url;
    if (ok) {
      return json as { ok: true; upload_url: string };
    }
    throw new BadRequestException(this.extractApiMessage(json, raw, res.status));
  }

  /** Atualiza o comentário de um lead (por WhatsApp). */
  async patchLeadComment(params: {
    whatsapp: string;
    comentario: string;
  }): Promise<void> {
    this.assertConfigured();
    const body = {
      whatsapp: params.whatsapp,
      comentario: (params.comentario ?? '').trim(),
    };
    if (!body.comentario) throw new BadRequestException('Comentário vazio.');

    const res = await fetch(`${this.baseUrl}/api/integration/leads/comment`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'X-Integration-Secret': this.secret,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    if (res.status === 200 && json.ok === true) return;
    throw new BadRequestException(this.extractApiMessage(json, raw, res.status));
  }

  /**
   * Solicita atendimento (atribuição de gestora). Devolve `{ ok, lead, gestora }`.
   * O objeto `gestora` segue o contrato documentado em `API-INTEGRACAO.md` e inclui:
   * `nome`, `email`, `email_para_leads`, `whatsapp`, `foto_perfil`, `boas_vindas`.
   *
   * Se a ia-app responder 404 (lead não existe), retorna `{ leadNotFound: true }` para o
   * caller decidir criar primeiro e tentar novamente.
   */
  async requestAtendimento(whatsapp: string): Promise<
    | { ok: true; lead?: GestoraLeadShape; gestora?: GestoraShape }
    | { leadNotFound: true }
  > {
    this.assertConfigured();
    const res = await fetch(`${this.baseUrl}/api/integration/leads/request-atendimento`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Integration-Secret': this.secret,
      },
      body: JSON.stringify({ whatsapp }),
    });
    const raw = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    if (res.status === 200 && json.ok === true) {
      return json as { ok: true; lead?: GestoraLeadShape; gestora?: GestoraShape };
    }
    if (res.status === 404) {
      return { leadNotFound: true };
    }
    throw new BadRequestException(this.extractApiMessage(json, raw, res.status));
  }

  /** Extrai nome legível da gestora a partir do objeto devolvido pela ia-app (formato flexível). */
  static extractGestoraName(g: unknown): string | null {
    if (!g || typeof g !== 'object') return null;
    const candidates = [
      (g as Record<string, unknown>).nome,
      (g as Record<string, unknown>).name,
      (g as Record<string, unknown>).displayName,
      (g as Record<string, unknown>).fullName,
      (g as Record<string, unknown>).firstName,
    ];
    for (const c of candidates) {
      const v = String(c ?? '').trim();
      if (v) return v;
    }
    return null;
  }

  /** Extrai WhatsApp (dígitos) da gestora. */
  static extractGestoraWhatsapp(g: unknown): string {
    if (!g || typeof g !== 'object') return '';
    const o = g as Record<string, unknown>;
    const candidates = [
      o.whatsapp,
      o.whatsapp_number,
      o.whatsappNumber,
      o.phone,
      o.phoneNumber,
      o.telefone,
      o.telephone,
      o.mobile,
      o.celular,
    ];
    for (const c of candidates) {
      const digits = String(c ?? '').replace(/\D/g, '').trim();
      if (digits) return digits;
    }
    return '';
  }

  /** wa.me link com mensagem pré-preenchida para o lead contactar a gestora. */
  static buildGestoraWhatsAppLink(input: {
    gestoraWhatsapp: string;
    leadName: string;
    quizSummary: string;
  }): string {
    const digits = String(input.gestoraWhatsapp ?? '').replace(/\D/g, '').trim();
    if (!digits) return '';
    const nome = String(input.leadName ?? '').trim() || 'Cliente';
    const resumo = String(input.quizSummary ?? '').trim() || 'não informado';
    const text = `Ola, meu nome é ${nome}, e vim pela Rafa, minhas respostas ao questionario: ${resumo}`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }

  /** Email da gestora a usar para contacto do lead (prefere `email_para_leads`). */
  static extractGestoraEmail(g: unknown): string {
    if (!g || typeof g !== 'object') return '';
    const o = g as Record<string, unknown>;
    const candidates = [o.email_para_leads, o.emailParaLeads, o.email];
    for (const c of candidates) {
      const v = String(c ?? '').trim();
      if (v) return v;
    }
    return '';
  }

  /** Mensagem de boas-vindas (HTML-safe) configurada pela gestora. */
  static extractGestoraBoasVindas(g: unknown): string {
    if (!g || typeof g !== 'object') return '';
    const o = g as Record<string, unknown>;
    const candidates = [o.boas_vindas, o.boasVindas, o.welcomeMessage];
    for (const c of candidates) {
      const v = String(c ?? '').trim();
      if (v) return v;
    }
    return '';
  }

  /**
   * Normaliza `foto_perfil` da gestora para um `src` utilizável em `<img>` (data URL ou HTTP).
   * A ia-app pode devolver: data URL completa, URL externa, ou base64 puro (assume `image/jpeg`).
   */
  static fotoSrcFromGestora(g: unknown): string {
    if (!g || typeof g !== 'object') return '';
    const o = g as Record<string, unknown>;
    const candidates = [o.foto_perfil, o.fotoPerfil, o.photoUrl, o.avatar];
    for (const c of candidates) {
      const raw = String(c ?? '').trim();
      if (!raw) continue;
      if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) {
        return raw;
      }
      return `data:image/jpeg;base64,${raw}`;
    }
    return '';
  }

  private extractApiMessage(json: Record<string, unknown>, raw: string, status: number): string {
    const msgField = (json as { message?: unknown }).message;
    const errField = (json as { error?: unknown }).error;
    const msg = Array.isArray(msgField) ? msgField.join(' ') : msgField;
    const candidate =
      (typeof msg === 'string' ? msg : '') ||
      (typeof errField === 'string' ? errField : '') ||
      (raw && raw.length < 800 ? raw.trim() : '') ||
      `Erro HTTP ${status}`;
    return String(candidate).trim() || `Erro HTTP ${status}`;
  }
}
