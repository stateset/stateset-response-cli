import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KlaviyoConfig } from '../../integrations/config.js';
import type { KlaviyoToolOptions } from './klaviyo-common.js';
import { registerKlaviyoRawRequestTool } from './klaviyo-common.js';
import { registerKlaviyoProfileTools } from './klaviyo-profiles.js';
import { registerKlaviyoListTools } from './klaviyo-lists.js';
import { registerKlaviyoCampaignTools } from './klaviyo-campaigns.js';
import { registerKlaviyoContentTools } from './klaviyo-content.js';

export type { KlaviyoToolOptions } from './klaviyo-common.js';

export function registerKlaviyoTools(
  server: McpServer,
  klaviyo: KlaviyoConfig,
  options: KlaviyoToolOptions,
) {
  registerKlaviyoRawRequestTool(server, klaviyo, options);
  registerKlaviyoProfileTools(server, klaviyo, options);
  registerKlaviyoListTools(server, klaviyo, options);
  registerKlaviyoCampaignTools(server, klaviyo, options);
  registerKlaviyoContentTools(server, klaviyo, options);
}
