#!/usr/bin/env node

import { handleBootstrapError } from './bootstrap-runtime.js';

try {
  const { ensureSupportedNodeRuntime } = await import('../dist/runtime/node-launcher.js');
  await ensureSupportedNodeRuntime(import.meta.url);
  await import('../dist/cli.js');
} catch (err) {
  handleBootstrapError(err, 'response');
}
