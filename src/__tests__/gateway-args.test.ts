import { describe, expect, it } from 'vitest';
import { parseGatewayArgs, parseSlackArgs, parseWhatsAppArgs } from '../cli/gateway-args.js';

describe('parseGatewayArgs', () => {
  it('applies default values', () => {
    expect(parseGatewayArgs([])).toEqual({
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
    });
  });

  it('parses gateway options with mixed formats', () => {
    const parsed = parseGatewayArgs([
      '-m',
      'opus',
      '--slack-allow',
      'U1, U2, U1',
      '--whatsapp-allow=+10001,+10002',
      '--no-whatsapp',
      '--whatsapp-groups',
      '--whatsapp-self-chat',
      '--whatsapp-auth-dir',
      '/tmp/wa',
      '--verbose',
    ]);

    expect(parsed).toEqual({
      model: 'opus',
      verbose: true,
      showHelp: false,
      showVersion: false,
      slackEnabled: true,
      whatsappEnabled: false,
      slackAllowList: ['U1', 'U2'],
      whatsappAllowList: ['+10001', '+10002'],
      whatsappAllowGroups: true,
      whatsappSelfChatOnly: true,
      whatsappAuthDir: '/tmp/wa',
    });
  });

  it('returns help/version flags and errors on unknown args', () => {
    expect(parseGatewayArgs(['--help']).showHelp).toBe(true);
    expect(parseGatewayArgs(['-V']).showVersion).toBe(true);
    expect(() => parseGatewayArgs(['--bad-option'])).toThrow('Unknown option "--bad-option".');
    expect(() => parseGatewayArgs(['value'])).toThrow('Unexpected argument "value".');
    expect(() => parseGatewayArgs(['--model'])).toThrow('Missing value for --model.');
  });
});

describe('parseSlackArgs', () => {
  it('parses Slack options and defaults', () => {
    const parsed = parseSlackArgs(['--model=haiku', '--allow', 'U1,,U2,U1', '--verbose']);

    expect(parsed).toEqual({
      model: 'haiku',
      allowList: ['U1', 'U2'],
      verbose: true,
      showHelp: false,
      showVersion: false,
    });
  });

  it('throws on missing allow value', () => {
    expect(() => parseSlackArgs(['--allow'])).toThrow('Missing value for --allow.');
    expect(() => parseSlackArgs(['--bogus'])).toThrow('Unknown option "--bogus".');
  });
});

describe('parseWhatsAppArgs', () => {
  it('parses WhatsApp options and defaults', () => {
    const parsed = parseWhatsAppArgs([
      '--model',
      'sonnet',
      '--allow=15551234567, 15551234567, 15557654321',
      '--groups',
      '--self-chat',
      '--auth-dir',
      '/tmp/wa',
      '--reset',
      '--verbose',
    ]);

    expect(parsed).toEqual({
      model: 'sonnet',
      allowList: ['15551234567', '15557654321'],
      allowGroups: true,
      selfChatOnly: true,
      authDir: '/tmp/wa',
      resetAuth: true,
      verbose: true,
      showHelp: false,
      showVersion: false,
    });
  });

  it('throws on missing or unknown options', () => {
    expect(() => parseWhatsAppArgs(['--auth-dir'])).toThrow('Missing value for --auth-dir.');
    expect(() => parseWhatsAppArgs(['--bad'])).toThrow('Unknown option "--bad".');
  });
});
