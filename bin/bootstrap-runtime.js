import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_NAME = 'stateset-response-cli';

function isSourceCheckout() {
  const hasGitDir = fs.existsSync(path.join(PACKAGE_ROOT, '.git'));
  const hasSourceTree =
    fs.existsSync(path.join(PACKAGE_ROOT, 'src')) &&
    fs.existsSync(path.join(PACKAGE_ROOT, 'package.json'));
  return hasGitDir || hasSourceTree;
}

function formatMissingBuildMessage(commandName) {
  if (isSourceCheckout()) {
    return [
      'Build artifacts not found for this source checkout.',
      'Run "npm ci" and then "npm run build" from the repository root.',
      `After that, re-run "${commandName}".`,
      `If you only need the published CLI, run "npm install -g ${PACKAGE_NAME}@latest".`,
    ].join('\n');
  }

  return [
    'Build artifacts not found for this installation.',
    `Reinstall the published CLI with "npm install -g ${PACKAGE_NAME}@latest".`,
    `Then re-run "${commandName}".`,
  ].join('\n');
}

export function handleBootstrapError(err, commandName) {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'ERR_MODULE_NOT_FOUND') {
    console.error(`Error: ${formatMissingBuildMessage(commandName)}`);
  } else {
    console.error('Error:', err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
}
