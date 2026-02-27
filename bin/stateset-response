#!/usr/bin/env node

try {
  await import('../dist/cli.js');
} catch (err) {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('Error: Build artifacts not found. Run "npm run build" first.');
  } else {
    console.error('Error:', err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
}
