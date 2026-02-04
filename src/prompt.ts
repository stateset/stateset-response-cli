import { BASE_SYSTEM_PROMPT } from './agent.js';
import { getCurrentOrg } from './config.js';
import { getIntegrationFlagsFromEnv, getGorgiasConfigFromEnv, getKlaviyoConfigFromEnv, getLoopConfigFromEnv, getRechargeConfigFromEnv, getShipFusionConfigFromEnv, getShipHawkConfigFromEnv, getShipHeroConfigFromEnv, getShipStationConfigFromEnv, getShopifyConfigFromEnv, getZendeskConfigFromEnv } from './integrations/config.js';
import { getStateSetDir } from './session.js';
import { getSkill, loadContextFiles, loadSystemPromptFiles } from './resources.js';

export interface PromptContext {
  sessionId: string;
  memory?: string;
  cwd?: string;
  activeSkills?: string[];
}

function getTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function buildSystemPrompt(context: PromptContext): string {
  const cwd = context.cwd || process.cwd();
  const { override, append } = loadSystemPromptFiles(cwd);
  const basePrompt = override?.content || BASE_SYSTEM_PROMPT;
  const sections: string[] = [basePrompt.trim()];

  let orgId = 'unknown';
  try {
    orgId = getCurrentOrg().orgId;
  } catch {
    // ignore if not configured
  }

  sections.push(`## Session\n- Org: ${orgId}\n- Session: ${context.sessionId}\n- Timezone: ${getTimezone()}`);

  const integrationFlags = getIntegrationFlagsFromEnv();
  let shopifyConfigured = false;
  let gorgiasConfigured = false;
  let rechargeConfigured = false;
  let klaviyoConfigured = false;
  let loopConfigured = false;
  let shipstationConfigured = false;
  let shipheroConfigured = false;
  let shipfusionConfigured = false;
  let shiphawkConfigured = false;
  let zendeskConfigured = false;

  try {
    shopifyConfigured = Boolean(getShopifyConfigFromEnv());
  } catch {
    shopifyConfigured = false;
  }

  try {
    gorgiasConfigured = Boolean(getGorgiasConfigFromEnv());
  } catch {
    gorgiasConfigured = false;
  }

  try {
    rechargeConfigured = Boolean(getRechargeConfigFromEnv());
  } catch {
    rechargeConfigured = false;
  }

  try {
    klaviyoConfigured = Boolean(getKlaviyoConfigFromEnv());
  } catch {
    klaviyoConfigured = false;
  }

  try {
    loopConfigured = Boolean(getLoopConfigFromEnv());
  } catch {
    loopConfigured = false;
  }

  try {
    shipstationConfigured = Boolean(getShipStationConfigFromEnv());
  } catch {
    shipstationConfigured = false;
  }

  try {
    shipheroConfigured = Boolean(getShipHeroConfigFromEnv());
  } catch {
    shipheroConfigured = false;
  }

  try {
    shipfusionConfigured = Boolean(getShipFusionConfigFromEnv());
  } catch {
    shipfusionConfigured = false;
  }

  try {
    shiphawkConfigured = Boolean(getShipHawkConfigFromEnv());
  } catch {
    shiphawkConfigured = false;
  }

  try {
    zendeskConfigured = Boolean(getZendeskConfigFromEnv());
  } catch {
    zendeskConfigured = false;
  }

  sections.push(
    `## Integrations\n- Shopify: ${shopifyConfigured ? 'configured' : 'not configured'}\n- Gorgias: ${gorgiasConfigured ? 'configured' : 'not configured'}\n- Recharge: ${rechargeConfigured ? 'configured' : 'not configured'}\n- Klaviyo: ${klaviyoConfigured ? 'configured' : 'not configured'}\n- Loop Returns: ${loopConfigured ? 'configured' : 'not configured'}\n- ShipStation: ${shipstationConfigured ? 'configured' : 'not configured'}\n- ShipHero: ${shipheroConfigured ? 'configured' : 'not configured'}\n- ShipFusion: ${shipfusionConfigured ? 'configured' : 'not configured'}\n- ShipHawk: ${shiphawkConfigured ? 'configured' : 'not configured'}\n- Zendesk: ${zendeskConfigured ? 'configured' : 'not configured'}\n- Writes enabled: ${integrationFlags.allowApply ? 'yes' : 'no'}\n- Redaction: ${integrationFlags.redact ? 'enabled' : 'disabled'}`
  );

  const eventsDir = `${getStateSetDir()}/events`;
  sections.push(
    `## Events\nYou can schedule background runs by creating JSON files in ${eventsDir}. Supported types: immediate, one-shot, periodic.`
  );

  const contextFiles = loadContextFiles(cwd);
  if (contextFiles.length > 0) {
    const contextText = contextFiles
      .map((file) => `### ${file.displayPath}\n${file.content}`)
      .join('\n\n');
    sections.push(`## Context Files\n${contextText}`);
  }

  const activeSkills = context.activeSkills || [];
  if (activeSkills.length > 0) {
    const skillBlocks: string[] = [];
    for (const skillName of activeSkills) {
      const skill = getSkill(skillName, cwd);
      if (!skill) continue;
      const header = `### ${skill.name}${skill.displayPath ? ` (${skill.displayPath})` : ''}`;
      skillBlocks.push(`${header}\n${skill.content}`);
    }
    if (skillBlocks.length > 0) {
      sections.push(`## Skills\n${skillBlocks.join('\n\n')}`);
    }
  }

  if (context.memory) {
    sections.push(`## Memory\n${context.memory}`);
  }

  if (append.length > 0) {
    const appendText = append.map((file) => file.content).join('\n\n');
    sections.push(appendText.trim());
  }

  return sections.join('\n\n') + '\n';
}
