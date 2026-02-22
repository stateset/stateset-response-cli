import { BASE_SYSTEM_PROMPT } from './agent.js';
import { getCurrentOrg } from './config.js';
import { getIntegrationFlagsFromEnv, isIntegrationConfigured } from './integrations/config.js';
import { INTEGRATION_DEFINITIONS } from './integrations/registry.js';
import { getStateSetDir } from './session.js';
import { getSkill, loadContextFiles, loadSystemPromptFiles } from './resources.js';

/**
 * Inputs for system prompt assembly: session identity, optional persistent
 * memory, working directory for context files, and active skill names.
 */
export interface PromptContext {
  sessionId: string;
  memory?: string;
  cwd?: string;
  activeSkills?: string[];
}

function getTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Assembles the full system prompt from the base prompt (or override file),
 * session metadata, integration status, events info, context files, active skills, and memory.
 */
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

  sections.push(
    `## Session\n- Org: ${orgId}\n- Session: ${context.sessionId}\n- Timezone: ${getTimezone()}`,
  );

  const integrationFlags = getIntegrationFlagsFromEnv();
  const integrationLines = INTEGRATION_DEFINITIONS.map(
    (def) => `- ${def.label}: ${isIntegrationConfigured(def.id) ? 'configured' : 'not configured'}`,
  );
  integrationLines.push(`- Writes enabled: ${integrationFlags.allowApply ? 'yes' : 'no'}`);
  integrationLines.push(`- Redaction: ${integrationFlags.redact ? 'enabled' : 'disabled'}`);
  sections.push(`## Integrations\n${integrationLines.join('\n')}`);

  const eventsDir = `${getStateSetDir()}/events`;
  sections.push(
    `## Events\nYou can schedule background runs by creating JSON files in ${eventsDir}. Supported types: immediate, one-shot, periodic.`,
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
