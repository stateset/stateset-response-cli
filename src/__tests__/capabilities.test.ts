import { describe, expect, it } from 'vitest';
import {
  findCapabilityArea,
  listCapabilityAreas,
  listCapabilityWorkflows,
  renderCapabilityMap,
} from '../cli/capabilities.js';

describe('capabilities', () => {
  it('lists the major capability areas', () => {
    const areas = listCapabilityAreas();
    expect(areas.map((area) => area.id)).toEqual(
      expect.arrayContaining([
        'setup',
        'runtime',
        'workflow-studio',
        'curation',
        'operations',
        'resources',
      ]),
    );
  });

  it('matches capability areas by prefix', () => {
    expect(findCapabilityArea('workflow')?.id).toBe('workflow-studio');
    expect(findCapabilityArea('cur')?.id).toBe('curation');
  });

  it('renders a human-readable filtered capability map', () => {
    const output = renderCapabilityMap('curation');
    expect(output).toContain('Curation & Training Data');
    expect(output).toContain('response evals create-from-response <response-id> --seed rejected');
    expect(output).not.toContain('Setup & Access');
  });

  it('renders JSON for tooling and docs', () => {
    const output = renderCapabilityMap(undefined, true);
    const parsed = JSON.parse(output) as {
      areas: Array<{ id: string }>;
      workflows: Array<{ name: string }>;
    };

    expect(parsed.areas.some((area) => area.id === 'workflow-studio')).toBe(true);
    expect(
      parsed.workflows.some((workflow) => workflow.name === 'Iterate on workflow automation'),
    ).toBe(true);
    expect(listCapabilityWorkflows().length).toBeGreaterThan(0);
  });
});
