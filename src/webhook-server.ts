/**
 * Local webhook development server.
 *
 * Starts an HTTP server that receives webhook payloads, logs them,
 * and optionally forwards them to the workflow engine for processing.
 *
 * Usage: response serve --port 3000 [--forward-to-engine]
 */

import http from 'node:http';
import chalk from 'chalk';
import { logger } from './lib/logger.js';

export interface WebhookServerOptions {
  port: number;
  forwardToEngine: boolean;
  verbose: boolean;
}

interface WebhookEvent {
  id: number;
  timestamp: string;
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  contentType: string;
  size: number;
}

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

function parseBody(raw: string, contentType: string): unknown {
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function startWebhookServer(options: WebhookServerOptions): {
  server: http.Server;
  events: WebhookEvent[];
  stop: () => Promise<void>;
} {
  const events: WebhookEvent[] = [];
  let eventCounter = 0;

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const path = req.url ?? '/';
    const contentType = req.headers['content-type'] ?? '';

    // Health check endpoint
    if (path === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', events: events.length }));
      return;
    }

    // Collect body
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize <= MAX_BODY_SIZE) {
        chunks.push(chunk);
      }
    });

    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      const body = parseBody(rawBody, contentType);

      eventCounter++;
      const event: WebhookEvent = {
        id: eventCounter,
        timestamp: new Date().toISOString(),
        method,
        path,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
        contentType,
        size: totalSize,
      };

      events.push(event);

      // Keep last 500 events
      if (events.length > 500) {
        events.splice(0, events.length - 500);
      }

      // Log the event
      const ts = event.timestamp.slice(11, 23);
      const bodyPreview =
        typeof body === 'object' ? JSON.stringify(body).slice(0, 100) : String(body).slice(0, 100);
      console.log(
        `  ${chalk.gray(ts)} ${chalk.cyan(method.padEnd(6))} ${chalk.white(path)} ${chalk.gray(`(${totalSize}B)`)}`,
      );
      if (options.verbose && bodyPreview) {
        console.log(chalk.gray(`    ${bodyPreview}`));
      }

      // Optionally forward to workflow engine
      if (options.forwardToEngine) {
        try {
          const { getWorkflowEngineConfig } = await import('./config.js');
          const engineConfig = getWorkflowEngineConfig();
          if (engineConfig && typeof body === 'object' && body !== null) {
            const { EngineClient } = await import('./lib/engine-client.js');
            const client = new EngineClient(engineConfig);
            const payload = body as Record<string, unknown>;
            const brandSlug =
              (payload.brand_slug as string) ??
              (payload.brandSlug as string) ??
              path.split('/').filter(Boolean).pop() ??
              'default';

            await client.ingestEvent(
              brandSlug,
              {
                event_type: String(payload.event_type ?? payload.type ?? 'webhook'),
                workflow_type: 'response',
                source: 'webhook-server',
                payload,
              },
              `webhook-${eventCounter}-${Date.now()}`,
            );
            console.log(chalk.green(`    → Forwarded to engine (brand: ${brandSlug})`));
          }
        } catch (err) {
          logger.debug('Engine forward failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Respond with 200
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true, id: event.id }));
    });
  });

  server.listen(options.port, () => {
    console.log('');
    console.log(chalk.bold('  Webhook Dev Server'));
    console.log(chalk.gray(`  ─────────────────────────────────────`));
    console.log(chalk.gray(`  Listening on: http://localhost:${options.port}`));
    console.log(chalk.gray(`  Health:       http://localhost:${options.port}/health`));
    if (options.forwardToEngine) {
      console.log(chalk.gray(`  Forwarding:   → workflow engine`));
    }
    console.log(chalk.gray(`  Press Ctrl+C to stop.`));
    console.log('');
  });

  const stop = (): Promise<void> =>
    new Promise((resolve) => {
      server.close(() => resolve());
    });

  return { server, events, stop };
}
