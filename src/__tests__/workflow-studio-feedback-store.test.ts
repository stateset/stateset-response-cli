import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  loadWorkflowStudioFeedbackStore,
  syncWorkflowStudioFeedbackFromGorgias,
  syncWorkflowStudioFeedbackFromZendesk,
} from '../lib/workflow-studio-feedback-store.js';

function makeFixtureDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-feedback-store-'));
}

describe('syncWorkflowStudioFeedbackFromGorgias', () => {
  it('syncs live-style Gorgias ticket data into the normalized feedback store', async () => {
    const root = makeFixtureDir();
    const requestRaw = vi.fn().mockImplementation(async (_method: string, endpoint: string) => {
      if (endpoint === '/custom-fields') {
        return {
          data: [
            { id: 1, name: 'AI Intent' },
            { id: 2, name: 'Type' },
          ],
        };
      }
      if (endpoint === '/tickets') {
        return {
          data: [
            {
              id: 1001,
              subject: 'Cancel my subscription',
              status: 'open',
              channel: 'email',
              updated_datetime: '2026-04-14T10:00:00Z',
              created_datetime: '2026-04-14T09:50:00Z',
              customer: { email: 'one@example.com' },
              tags: [{ name: 'agent-take-over' }, { name: 'Ecoriginals AU' }],
              satisfaction_survey: { score: 'positive' },
            },
            {
              id: 1002,
              subject: 'Wholesale pitch',
              status: 'open',
              channel: 'email',
              updated_datetime: '2026-04-14T09:00:00Z',
              created_datetime: '2026-04-14T08:50:00Z',
              customer: { email: 'lead@example.com' },
              tags: [{ name: 'non-support-related' }, { name: 'wholesale' }],
            },
          ],
        };
      }
      if (endpoint === '/tickets/1001/custom-fields') {
        return {
          data: [
            { custom_field_id: 1, value: 'Subscription::Cancel::Other' },
            { custom_field_id: 2, value: 'Account Management::Cancellation' },
          ],
        };
      }
      if (endpoint === '/tickets/1002/custom-fields') {
        return {
          data: [],
        };
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });
    const getTicketMessages = vi.fn(async (ticketId: number) => {
      if (ticketId === 1001) {
        return {
          data: [
            {
              id: 'm-1001-c1',
              sender: { email: 'one@example.com' },
              body_text: 'Please cancel this subscription.',
              created_datetime: '2026-04-14T09:50:00Z',
              from_agent: false,
            },
            {
              id: 'm-1001-a1',
              sender: { email: 'agent@brand.test' },
              body_text: 'We can help with that.',
              created_datetime: '2026-04-14T10:00:00Z',
              from_agent: true,
            },
          ],
        };
      }
      return {
        data: [
          {
            id: 'm-1002-c1',
            sender: { email: 'lead@example.com' },
            body_text: 'Can we sell through your channel?',
            created_datetime: '2026-04-14T08:50:00Z',
            from_agent: false,
          },
          {
            id: 'm-1002-a1',
            sender: { email: 'agent@brand.test' },
            body_text: 'Thanks for reaching out.',
            created_datetime: '2026-04-14T09:00:00Z',
            from_agent: true,
          },
        ],
      };
    });

    const result = await syncWorkflowStudioFeedbackFromGorgias({
      brandRef: 'ecoriginals-au',
      cwd: root,
      api: {
        requestRaw,
        getTicketMessages,
      } as never,
    });

    expect(result.brandSlug).toBe('ecoriginals-au');
    expect(result.ticketsUpserted).toBe(2);
    expect(result.responsesUpserted).toBe(2);

    const store = loadWorkflowStudioFeedbackStore('ecoriginals-au', root);
    expect(store.tickets).toHaveLength(2);
    expect(store.responses).toHaveLength(2);
    expect(store.state.newestTicketUpdatedAt).toBe('2026-04-14T10:00:00.000Z');
    expect(store.tickets[0]).toEqual(
      expect.objectContaining({
        ticketId: '1001',
        aiIntent: 'Subscription::Cancel::Other',
        issueType: 'Account Management::Cancellation',
      }),
    );
    expect(store.tickets[1]).toEqual(
      expect.objectContaining({
        ticketId: '1002',
        aiIntent: 'Other::Unclassified::Other',
      }),
    );
    expect(store.responses[0]).toEqual(
      expect.objectContaining({
        ticketId: '1002',
        customerMessage: 'Can we sell through your channel?',
      }),
    );
    expect(store.responses[1]).toEqual(
      expect.objectContaining({
        ticketId: '1001',
        handledBy: 'agent@brand.test',
        rating: 'positive',
      }),
    );
  });

  it('uses the watermark to only upsert newly updated tickets on later syncs', async () => {
    const root = makeFixtureDir();
    const requestRaw = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: 1, name: 'AI Intent' }],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 1001,
            subject: 'Cancel my subscription',
            status: 'open',
            channel: 'email',
            updated_datetime: '2026-04-14T10:00:00Z',
            created_datetime: '2026-04-14T09:50:00Z',
            customer: { email: 'one@example.com' },
            tags: [{ name: 'agent-take-over' }],
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [{ custom_field_id: 1, value: 'Subscription::Cancel::Other' }],
      })
      .mockResolvedValueOnce({
        data: [{ id: 1, name: 'AI Intent' }],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 1002,
            subject: 'Track my order',
            status: 'open',
            channel: 'email',
            updated_datetime: '2026-04-14T11:00:00Z',
            created_datetime: '2026-04-14T10:55:00Z',
            customer: { email: 'two@example.com' },
            tags: [{ name: 'shipping' }],
          },
          {
            id: 1001,
            subject: 'Cancel my subscription',
            status: 'open',
            channel: 'email',
            updated_datetime: '2026-04-14T10:00:00Z',
            created_datetime: '2026-04-14T09:50:00Z',
            customer: { email: 'one@example.com' },
            tags: [{ name: 'agent-take-over' }],
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [],
      });

    const getTicketMessages = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: 'm-1001-c1',
            sender: { email: 'one@example.com' },
            body_text: 'Please cancel this subscription.',
            created_datetime: '2026-04-14T09:50:00Z',
            from_agent: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'm-1002-c1',
            sender: { email: 'two@example.com' },
            body_text: 'Where is my order?',
            created_datetime: '2026-04-14T10:55:00Z',
            from_agent: false,
          },
          {
            id: 'm-1002-a1',
            sender: { email: 'agent@brand.test' },
            body_text: 'Your order is on the way.',
            created_datetime: '2026-04-14T11:00:00Z',
            from_agent: true,
          },
        ],
      });

    await syncWorkflowStudioFeedbackFromGorgias({
      brandRef: 'ecoriginals-au',
      cwd: root,
      api: {
        requestRaw,
        getTicketMessages,
      } as never,
    });

    const second = await syncWorkflowStudioFeedbackFromGorgias({
      brandRef: 'ecoriginals-au',
      cwd: root,
      api: {
        requestRaw,
        getTicketMessages,
      } as never,
    });

    expect(second.ticketsUpserted).toBe(1);
    expect(getTicketMessages).toHaveBeenCalledTimes(2);

    const store = loadWorkflowStudioFeedbackStore('ecoriginals-au', root);
    expect(store.tickets.map((ticket) => ticket.ticketId).sort()).toEqual(['1001', '1002']);
    expect(store.state.newestTicketUpdatedAt).toBe('2026-04-14T11:00:00.000Z');
  });
});

describe('syncWorkflowStudioFeedbackFromZendesk', () => {
  it('syncs incremental Zendesk tickets into the normalized feedback store', async () => {
    const root = makeFixtureDir();
    const zendeskRequest = vi.fn().mockImplementation(async ({ path }: { path: string }) => {
      if (path === '/ticket_fields.json') {
        return {
          status: 200,
          data: {
            ticket_fields: [
              { id: 1, title: 'AI Intent' },
              { id: 2, title: 'Brand' },
              { id: 3, title: 'Type' },
            ],
            next_page: null,
          },
        };
      }
      if (path === '/incremental/tickets/cursor') {
        return {
          status: 200,
          data: {
            tickets: [
              {
                id: 2001,
                subject: 'Pause my subscription',
                status: 'open',
                updated_at: '2026-04-14T10:00:00Z',
                created_at: '2026-04-14T09:50:00Z',
                requester_id: 501,
                tags: ['agent-take-over', 'ecoriginals-au'],
                via: { channel: 'email' },
                satisfaction_rating: { score: 'good' },
                custom_fields: [
                  { id: 1, value: 'Subscription::Pause::Other' },
                  { id: 2, value: 'ecoriginals-au' },
                  { id: 3, value: 'Account Management::Subscription Management' },
                ],
              },
              {
                id: 2002,
                subject: 'Wholesale introduction',
                status: 'open',
                updated_at: '2026-04-14T09:00:00Z',
                created_at: '2026-04-14T08:50:00Z',
                requester_id: 777,
                tags: ['wholesale'],
                via: { channel: 'web' },
                custom_fields: [{ id: 2, value: 'ecoriginals-au' }],
              },
            ],
            after_cursor: 'cursor-2',
            end_of_stream: true,
          },
        };
      }
      if (path === '/tickets/2001/comments.json') {
        return {
          status: 200,
          data: {
            comments: [
              {
                id: 'zd-2001-c1',
                author_id: 501,
                public: true,
                body: 'Please pause my subscription for a month.',
                created_at: '2026-04-14T09:50:00Z',
              },
              {
                id: 'zd-2001-a1',
                author_id: 9001,
                public: true,
                body: 'Done. I have paused it.',
                created_at: '2026-04-14T10:00:00Z',
              },
            ],
            next_page: null,
          },
        };
      }
      if (path === '/tickets/2002/comments.json') {
        return {
          status: 200,
          data: {
            comments: [
              {
                id: 'zd-2002-c1',
                author_id: 777,
                public: true,
                body: 'Can we discuss a wholesale partnership?',
                created_at: '2026-04-14T08:50:00Z',
              },
              {
                id: 'zd-2002-a1',
                author_id: 9002,
                public: true,
                body: 'Thanks for reaching out.',
                created_at: '2026-04-14T09:00:00Z',
              },
            ],
            next_page: null,
          },
        };
      }
      throw new Error(`Unexpected Zendesk path: ${path}`);
    });

    const result = await syncWorkflowStudioFeedbackFromZendesk({
      brandRef: 'ecoriginals-au',
      cwd: root,
      zendeskConfig: {
        subdomain: 'test',
        email: 'ops@example.com',
        apiToken: 'token',
      },
      zendeskRequest,
    });

    expect(result.provider).toBe('zendesk');
    expect(result.ticketsUpserted).toBe(2);
    expect(result.responsesUpserted).toBe(2);

    const store = loadWorkflowStudioFeedbackStore('ecoriginals-au', root, 'zendesk');
    expect(store.paths.dir).toContain('.stateset/feedback-zendesk/ecoriginals-au');
    expect(store.state.providerCursor).toBe('cursor-2');
    expect(store.tickets[0]).toEqual(
      expect.objectContaining({
        ticketId: '2001',
        source: 'zendesk',
        aiIntent: 'Subscription::Pause::Other',
        issueType: 'Account Management::Subscription Management',
      }),
    );
    expect(store.tickets[1]).toEqual(
      expect.objectContaining({
        ticketId: '2002',
        aiIntent: 'Other::Unclassified::Other',
      }),
    );
    expect(store.responses[0]).toEqual(
      expect.objectContaining({
        ticketId: '2002',
        customerMessage: 'Can we discuss a wholesale partnership?',
        handledBy: 'author:9002',
      }),
    );
    expect(store.responses[1]).toEqual(
      expect.objectContaining({
        ticketId: '2001',
        rating: 'good',
      }),
    );
  });
});
