import {
  isOptionToken,
  parseCommaSeparated,
  readOptionValue,
  splitOptionToken,
} from './arg-utils.js';

export interface GatewayParseResult {
  model?: string;
  verbose: boolean;
  showHelp: boolean;
  showVersion: boolean;
}

export interface GatewayCLIArgs extends GatewayParseResult {
  slackEnabled: boolean;
  whatsappEnabled: boolean;
  slackAllowList?: string[];
  whatsappAllowList?: string[];
  whatsappAllowGroups: boolean;
  whatsappSelfChatOnly: boolean;
  whatsappAuthDir?: string;
}

export interface SlackCLIArgs extends GatewayParseResult {
  allowList?: string[];
}

export interface WhatsAppCLIArgs extends GatewayParseResult {
  allowList?: string[];
  allowGroups: boolean;
  selfChatOnly: boolean;
  authDir?: string;
  resetAuth: boolean;
}

export function parseGatewayArgs(args: string[]): GatewayCLIArgs {
  const parsed: GatewayCLIArgs = {
    model: undefined,
    verbose: false,
    showHelp: false,
    showVersion: false,
    slackEnabled: true,
    whatsappEnabled: true,
    slackAllowList: undefined,
    whatsappAllowList: undefined,
    whatsappAllowGroups: false,
    whatsappSelfChatOnly: false,
    whatsappAuthDir: undefined,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    const { option, inlineValue } = splitOptionToken(token);

    if (token === '') {
      continue;
    }

    switch (option) {
      case '--model':
      case '-m': {
        const { value, index } = readOptionValue(args, i, '--model', inlineValue);
        parsed.model = value;
        i = index;
        break;
      }
      case '--slack-allow': {
        const value = readOptionValue(args, i, '--slack-allow', inlineValue);
        parsed.slackAllowList = parseCommaSeparated(value.value);
        i = value.index;
        break;
      }
      case '--whatsapp-allow': {
        const value = readOptionValue(args, i, '--whatsapp-allow', inlineValue);
        parsed.whatsappAllowList = parseCommaSeparated(value.value);
        i = value.index;
        break;
      }
      case '--whatsapp-groups':
        parsed.whatsappAllowGroups = true;
        break;
      case '--whatsapp-self-chat':
        parsed.whatsappSelfChatOnly = true;
        break;
      case '--whatsapp-auth-dir': {
        const { value, index } = readOptionValue(args, i, '--whatsapp-auth-dir', inlineValue);
        parsed.whatsappAuthDir = value;
        i = index;
        break;
      }
      case '--no-slack':
        parsed.slackEnabled = false;
        break;
      case '--no-whatsapp':
        parsed.whatsappEnabled = false;
        break;
      case '--verbose':
      case '-v':
        parsed.verbose = true;
        break;
      case '--version':
      case '-V':
        parsed.showVersion = true;
        break;
      case '--help':
      case '-h':
        parsed.showHelp = true;
        break;
      default:
        if (isOptionToken(token)) {
          throw new Error(`Unknown option "${token}".`);
        }
        throw new Error(`Unexpected argument "${token}".`);
    }
  }

  return parsed;
}

export function parseSlackArgs(args: string[]): SlackCLIArgs {
  const parsed: SlackCLIArgs = {
    model: undefined,
    verbose: false,
    showHelp: false,
    showVersion: false,
    allowList: undefined,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    const { option, inlineValue } = splitOptionToken(token);

    if (token === '') {
      continue;
    }

    switch (option) {
      case '--model':
      case '-m': {
        const { value, index } = readOptionValue(args, i, '--model', inlineValue);
        parsed.model = value;
        i = index;
        break;
      }
      case '--allow': {
        const value = readOptionValue(args, i, '--allow', inlineValue);
        parsed.allowList = parseCommaSeparated(value.value);
        i = value.index;
        break;
      }
      case '--verbose':
      case '-v':
        parsed.verbose = true;
        break;
      case '--version':
      case '-V':
        parsed.showVersion = true;
        break;
      case '--help':
      case '-h':
        parsed.showHelp = true;
        break;
      default:
        if (isOptionToken(token)) {
          throw new Error(`Unknown option "${token}".`);
        }
        throw new Error(`Unexpected argument "${token}".`);
    }
  }

  return parsed;
}

export function parseWhatsAppArgs(args: string[]): WhatsAppCLIArgs {
  const parsed: WhatsAppCLIArgs = {
    model: undefined,
    verbose: false,
    showHelp: false,
    showVersion: false,
    allowList: undefined,
    allowGroups: false,
    selfChatOnly: false,
    authDir: undefined,
    resetAuth: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    const { option, inlineValue } = splitOptionToken(token);

    if (token === '') {
      continue;
    }

    switch (option) {
      case '--model':
      case '-m': {
        const { value, index } = readOptionValue(args, i, '--model', inlineValue);
        parsed.model = value;
        i = index;
        break;
      }
      case '--allow': {
        const value = readOptionValue(args, i, '--allow', inlineValue);
        parsed.allowList = parseCommaSeparated(value.value);
        i = value.index;
        break;
      }
      case '--groups':
        parsed.allowGroups = true;
        break;
      case '--self-chat':
        parsed.selfChatOnly = true;
        break;
      case '--auth-dir': {
        const value = readOptionValue(args, i, '--auth-dir', inlineValue);
        parsed.authDir = value.value;
        i = value.index;
        break;
      }
      case '--reset':
        parsed.resetAuth = true;
        break;
      case '--verbose':
      case '-v':
        parsed.verbose = true;
        break;
      case '--version':
      case '-V':
        parsed.showVersion = true;
        break;
      case '--help':
      case '-h':
        parsed.showHelp = true;
        break;
      default:
        if (isOptionToken(token)) {
          throw new Error(`Unknown option "${token}".`);
        }
        throw new Error(`Unexpected argument "${token}".`);
    }
  }

  return parsed;
}
