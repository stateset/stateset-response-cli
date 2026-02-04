import type { GorgiasConfig } from './config.js';

interface GorgiasRequestOptions {
  method: string;
  endpoint: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}

export interface GorgiasApi {
  requestRaw: (method: string, endpoint: string, query?: Record<string, string | number | boolean | undefined> | null, body?: Record<string, unknown> | null) => Promise<any>;
  listTickets: (params?: Record<string, string | number | undefined>) => Promise<any>;
  getTicket: (ticketId: number) => Promise<any>;
  updateTicket: (ticketId: number, data: Record<string, unknown>) => Promise<any>;
  addMessage: (ticketId: number, message: Record<string, unknown>) => Promise<any>;
  getTicketMessages: (ticketId: number) => Promise<any>;
  listMacros: () => Promise<any>;
  getMacro: (macroId: number) => Promise<any>;
  applyMacro: (ticketId: number, macroId: number) => Promise<any>;
  mergeTickets: (primaryId: number, secondaryIds: number[]) => Promise<any>;
  listUsers: () => Promise<any>;
  listTeams: () => Promise<any>;
}

export function createGorgiasApi({ domain, apiKey, email }: GorgiasConfig): GorgiasApi {
  const baseUrl = `https://${domain}.gorgias.com/api`;
  const auth = Buffer.from(`${email}:${apiKey}`).toString('base64');

  async function request({ method, endpoint, query, body = null }: GorgiasRequestOptions): Promise<any> {
    let normalizedEndpoint = String(endpoint || '').trim();
    if (!normalizedEndpoint) {
      throw new Error('Endpoint is required');
    }
    if (normalizedEndpoint.startsWith('http://') || normalizedEndpoint.startsWith('https://')) {
      throw new Error('Endpoint must be relative (e.g., /tickets, /customers/123)');
    }
    if (!normalizedEndpoint.startsWith('/')) {
      normalizedEndpoint = `/${normalizedEndpoint}`;
    }

    const url = new URL(`${baseUrl}${normalizedEndpoint}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gorgias API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  return {
    async requestRaw(method, endpoint, query = null, body = null) {
      return request({ method, endpoint, query, body });
    },
    async listTickets(params = {}) {
      const query = new URLSearchParams();
      if (params.status) query.append('status', String(params.status));
      if (params.channel) query.append('channel', String(params.channel));
      if (params.limit) query.append('limit', String(params.limit));
      if (params.created_after) query.append('created_datetime__gte', String(params.created_after));
      if (params.created_before) query.append('created_datetime__lte', String(params.created_before));
      if (params.assignee_email) query.append('assignee_user__email', String(params.assignee_email));

      const queryStr = query.toString();
      return request({ method: 'GET', endpoint: `/tickets${queryStr ? `?${queryStr}` : ''}` });
    },

    async getTicket(ticketId: number) {
      return request({ method: 'GET', endpoint: `/tickets/${ticketId}` });
    },

    async updateTicket(ticketId: number, data: Record<string, unknown>) {
      return request({ method: 'PUT', endpoint: `/tickets/${ticketId}`, body: data });
    },

    async addMessage(ticketId: number, message: Record<string, unknown>) {
      return request({ method: 'POST', endpoint: `/tickets/${ticketId}/messages`, body: message });
    },

    async getTicketMessages(ticketId: number) {
      return request({ method: 'GET', endpoint: `/tickets/${ticketId}/messages` });
    },

    async listMacros() {
      return request({ method: 'GET', endpoint: '/macros' });
    },

    async getMacro(macroId: number) {
      return request({ method: 'GET', endpoint: `/macros/${macroId}` });
    },

    async applyMacro(ticketId: number, macroId: number) {
      return request({ method: 'POST', endpoint: `/tickets/${ticketId}/apply-macro`, body: { macro_id: macroId } });
    },

    async mergeTickets(primaryId: number, secondaryIds: number[]) {
      return request({ method: 'POST', endpoint: `/tickets/${primaryId}/merge`, body: { ticket_ids: secondaryIds } });
    },

    async listUsers() {
      return request({ method: 'GET', endpoint: '/users' });
    },

    async listTeams() {
      return request({ method: 'GET', endpoint: '/teams' });
    },
  };
}
