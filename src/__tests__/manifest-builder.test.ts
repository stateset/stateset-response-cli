import { describe, it, expect } from 'vitest';
import {
  buildDefaultAutomationConfig,
  buildDefaultManifest,
  buildConnector,
  CONNECTOR_DEFAULTS,
} from '../lib/manifest-builder.js';

describe('manifest-builder', () => {
  describe('buildDefaultAutomationConfig', () => {
    it('returns a valid config with defaults', () => {
      const config = buildDefaultAutomationConfig();
      expect(config.workflow_name).toBe('ResponseAutomationV2');
      expect(config.provider).toBe('anthropic');
      expect(config.model).toBe('claude-sonnet-4-6');
      expect(config.temperature).toBeGreaterThan(0);
      expect(config.max_tokens).toBeGreaterThan(0);
      expect(config.skip_rules).toEqual([]);
      expect(config.escalation_rules.enabled).toBe(true);
      expect(config.escalation_rules.patterns.length).toBeGreaterThan(0);
      expect(config.context_sources.length).toBeGreaterThan(0);
      expect(config.tool_definitions.length).toBeGreaterThan(0);
      expect(config.classification.enabled).toBe(true);
      expect(config.review_gate.enabled).toBe(true);
      expect(config.review_gate.review_timeout_secs).toBe(3600);
      expect(config.review_gate.on_timeout).toBe('escalate');
      expect(config.review_gate.max_review_rounds).toBe(0);
      expect(config.advanced_message.enabled).toBe(false);
      expect(config.time_sensitive_check.enabled).toBe(false);
      expect(config.intelligent_auto_close.enabled).toBe(false);
      expect(config.gorgias_custom_fields.enabled).toBe(false);
      expect(config.dispatch.enabled).toBe(true);
      expect(config.dispatch.sender_id).toBeNull();
    });

    it('accepts custom provider and model', () => {
      const config = buildDefaultAutomationConfig({
        provider: 'openai',
        model: 'gpt-4.1',
      });
      expect(config.provider).toBe('openai');
      expect(config.model).toBe('gpt-4.1');
    });

    it('includes brand slug when provided', () => {
      const config = buildDefaultAutomationConfig({ brandSlug: 'test-brand' });
      expect(config.brand_slug).toBe('test-brand');
    });

    it('includes brand name in system prompt', () => {
      const config = buildDefaultAutomationConfig({ brandName: 'Acme Corp' });
      expect(config.system_prompt_template).toContain('Acme Corp');
    });
  });

  describe('buildDefaultManifest', () => {
    it('returns a valid manifest with defaults', () => {
      const manifest = buildDefaultManifest('test-brand', 'Test Brand');
      expect(manifest.slug).toBe('test-brand');
      expect(manifest.display_name).toBe('Test Brand');
      expect(manifest.status).toBe('draft');
      expect(manifest.routing_mode).toBe('shadow');
      expect(manifest.region).toBe('us');
      expect(manifest.workflow_bindings).toHaveLength(1);
      expect(manifest.workflow_bindings[0].workflow_type).toBe('response-automation-v2');
      expect(manifest.workflow_bindings[0].enabled).toBe(true);
      expect(manifest.connectors).toEqual([]);
    });

    it('accepts custom automation config', () => {
      const config = buildDefaultAutomationConfig({ provider: 'openai', model: 'gpt-4.1' });
      const manifest = buildDefaultManifest('brand', 'Brand', config);
      expect(manifest.workflow_bindings[0].deterministic_config.provider).toBe('openai');
    });

    it('has sensible quota defaults', () => {
      const manifest = buildDefaultManifest('brand', 'Brand');
      expect(manifest.quotas.max_inflight_workflows).toBeGreaterThan(0);
      expect(manifest.quotas.events_per_minute).toBeGreaterThan(0);
      expect(manifest.quotas.max_payload_bytes).toBeGreaterThan(0);
    });
  });

  describe('buildConnector', () => {
    it('builds a connector with required fields', () => {
      const conn = buildConnector('shopify', {
        baseUrl: 'https://store.myshopify.com',
        secretRef: 'env://SHOPIFY_TOKEN',
      });
      expect(conn.connector_type).toBe('shopify');
      expect(conn.connector_key).toBe('shopify-primary');
      expect(conn.direction).toBe('outbound');
      expect(conn.target.base_url).toBe('https://store.myshopify.com');
      expect(conn.auth.secret_ref).toBe('env://SHOPIFY_TOKEN');
      expect(conn.enabled).toBe(true);
    });

    it('accepts custom key and direction', () => {
      const conn = buildConnector('gorgias', {
        baseUrl: 'https://acme.gorgias.com',
        secretRef: 'env://GORGIAS_KEY',
        direction: 'inbound',
        key: 'gorgias-inbound',
      });
      expect(conn.connector_key).toBe('gorgias-inbound');
      expect(conn.direction).toBe('inbound');
    });

    it('includes api version when provided', () => {
      const conn = buildConnector('shopify', {
        baseUrl: 'https://store.myshopify.com',
        secretRef: 'env://TOKEN',
        apiVersion: '2024-01',
      });
      expect(conn.target.api_version).toBe('2024-01');
    });
  });

  describe('CONNECTOR_DEFAULTS', () => {
    it('has defaults for key connectors', () => {
      expect(CONNECTOR_DEFAULTS.shopify).toBeDefined();
      expect(CONNECTOR_DEFAULTS.gorgias).toBeDefined();
      expect(CONNECTOR_DEFAULTS.recharge).toBeDefined();
      expect(CONNECTOR_DEFAULTS.gmail).toBeDefined();
      expect(CONNECTOR_DEFAULTS.openai).toBeDefined();
    });

    it('each default has label, urlTemplate, and envVar', () => {
      for (const [key, def] of Object.entries(CONNECTOR_DEFAULTS)) {
        expect(def.label, `${key}.label`).toBeTruthy();
        expect(def.urlTemplate, `${key}.urlTemplate`).toBeTruthy();
        expect(def.envVar, `${key}.envVar`).toBeTruthy();
      }
    });
  });
});
