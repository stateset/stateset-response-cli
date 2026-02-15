import { normalizePath, applyQueryParams } from './http.js';
import type { GorgiasConfig } from './config.js';
import { NotFoundError, ServiceUnavailableError, StateSetError } from '../lib/errors.js';

interface GorgiasRequestOptions {
  method: string;
  endpoint: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}

export interface GorgiasApi {
  requestRaw: (
    method: string,
    endpoint: string,
    query?: Record<string, string | number | boolean | undefined> | null,
    body?: Record<string, unknown> | null,
  ) => Promise<Record<string, unknown>>;
  listTickets: (
    params?: Record<string, string | number | undefined>,
  ) => Promise<Record<string, unknown>>;
  getTicket: (ticketId: number) => Promise<Record<string, unknown>>;
  updateTicket: (
    ticketId: number,
    data: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  addMessage: (
    ticketId: number,
    message: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  getTicketMessages: (ticketId: number) => Promise<Record<string, unknown>>;
  listMacros: () => Promise<Record<string, unknown>>;
  getMacro: (macroId: number) => Promise<Record<string, unknown>>;
  applyMacro: (ticketId: number, macroId: number) => Promise<Record<string, unknown>>;
  mergeTickets: (primaryId: number, secondaryIds: number[]) => Promise<Record<string, unknown>>;
  listUsers: () => Promise<Record<string, unknown>>;
  listTeams: () => Promise<Record<string, unknown>>;
}

export function createGorgiasApi({ domain, apiKey, email }: GorgiasConfig): GorgiasApi {
  const baseUrl = `https://${domain}.gorgias.com/api`;
  const auth = Buffer.from(`${email}:${apiKey}`).toString('base64');

  async function request({
    method,
    endpoint,
    query,
    body = null,
  }: GorgiasRequestOptions): Promise<Record<string, unknown>> {
    const normalizedEndpoint = normalizePath(endpoint, '/tickets, /customers/123');

    const url = new URL(`${baseUrl}${normalizedEndpoint}`);
    applyQueryParams(url, query);

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 404)
        throw new NotFoundError(`Gorgias API error (${response.status}): ${error}`);
      if (response.status >= 500)
        throw new ServiceUnavailableError(`Gorgias API error (${response.status}): ${error}`);
      throw new StateSetError(
        `Gorgias API error (${response.status}): ${error}`,
        'HTTP_ERROR',
        response.status,
      );
    }

    return response.json() as Promise<Record<string, unknown>>;
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
      if (params.created_before)
        query.append('created_datetime__lte', String(params.created_before));
      if (params.assignee_email)
        query.append('assignee_user__email', String(params.assignee_email));

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
      const payload: Record<string, unknown> = { ...message };
      if (!('via' in payload) || !payload.via) {
        payload.via = 'api';
      }
      return request({ method: 'POST', endpoint: `/tickets/${ticketId}/messages`, body: payload });
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
      return request({
        method: 'POST',
        endpoint: `/tickets/${ticketId}/apply-macro`,
        body: { macro_id: macroId },
      });
    },

    async mergeTickets(primaryId: number, secondaryIds: number[]) {
      return request({
        method: 'POST',
        endpoint: `/tickets/${primaryId}/merge`,
        body: { ticket_ids: secondaryIds },
      });
    },

    async listUsers() {
      return request({ method: 'GET', endpoint: '/users' });
    },

    async listTeams() {
      return request({ method: 'GET', endpoint: '/teams' });
    },
  };
}
