import http from 'node:http';
import { logger } from '../lib/logger.js';
import type { OrchestratorHealthSnapshot } from './orchestrator.js';

export interface GatewayHealthSource {
  getHealth: () => OrchestratorHealthSnapshot;
}

export interface GatewayHealthServerOptions {
  port: number;
  source: GatewayHealthSource;
}

export interface GatewayHealthServerHandle {
  server: http.Server;
  stop: () => Promise<void>;
}

function writeJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export function startGatewayHealthServer(
  options: GatewayHealthServerOptions,
): GatewayHealthServerHandle {
  const log = logger.child('gateway-health');
  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const path = req.url ?? '/';
    const snapshot = options.source.getHealth();

    if (method !== 'GET') {
      writeJson(res, 405, { status: 'method-not-allowed' });
      return;
    }

    if (path === '/' || path === '/health') {
      writeJson(res, 200, { status: 'ok', ...snapshot });
      return;
    }

    if (path === '/healthz') {
      writeJson(res, snapshot.running ? 200 : 503, {
        status: snapshot.running ? 'ok' : 'unhealthy',
        ...snapshot,
      });
      return;
    }

    if (path === '/readyz') {
      writeJson(res, snapshot.ready ? 200 : 503, {
        status: snapshot.ready ? 'ready' : 'not-ready',
        ...snapshot,
      });
      return;
    }

    writeJson(res, 404, { status: 'not-found' });
  });

  server.listen(options.port, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port;
    log.info(`Gateway health server listening on port ${port}`);
  });

  return {
    server,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
