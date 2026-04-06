import { describe, expect, it } from 'vitest';
import {
  buildBootstrapBinding,
  buildResponseAutomationBinding,
  createWorkflowStudioAutomationConfigFromTemplate,
  listWorkflowStudioTemplateIds,
} from '../lib/workflow-studio-bootstrap.js';

describe('workflow-studio-bootstrap', () => {
  it('lists supported workflow-studio templates', () => {
    expect(listWorkflowStudioTemplateIds()).toEqual([
      'ecommerce',
      'subscription',
      'knowledge_base',
    ]);
  });

  it('builds template automation config with brand identifiers', () => {
    const config = createWorkflowStudioAutomationConfigFromTemplate('subscription', {
      brandId: 'brand-1',
      brandSlug: 'acme',
    });

    expect(config).toEqual(
      expect.objectContaining({
        brand_id: 'brand-1',
        brand_slug: 'acme',
        workflow_name: 'ResponseAutomationV2',
        post_actions: expect.any(Array),
      }),
    );
  });

  it('builds bootstrap and response-automation bindings', () => {
    expect(buildBootstrapBinding()).toEqual(
      expect.objectContaining({
        workflow_type: 'response',
        deterministic_config: expect.objectContaining({
          workflow_name: 'ResponseAutomationV2',
        }),
      }),
    );

    expect(
      buildResponseAutomationBinding({
        brandId: 'brand-1',
        brandSlug: 'acme',
      }),
    ).toEqual(
      expect.objectContaining({
        workflow_type: 'response-automation-v2',
        deterministic_config: expect.objectContaining({
          brand_id: 'brand-1',
          brand_slug: 'acme',
          workflow_name: 'ResponseAutomationV2',
        }),
      }),
    );
  });
});
