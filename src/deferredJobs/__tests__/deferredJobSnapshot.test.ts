import { describe, expect, it } from 'vitest';

import { JobStore } from '@/multiAgent/jobStore';

describe('deferred job input snapshot', () => {
  it('persists tm_execution_context and tools parity on create', () => {
    const jobs = new JobStore();
    const job = jobs.create('parity snapshot test', {
      job_kind: 'deferred_batch',
      tm_execution_context: {
        mcp_server_ids: ['search::playwright', 'pipe::sequential-thinking'],
        enabled_plugin_ids: ['tavily_search'],
      },
      tm_enabled_plugin_count: 12,
      tools_parity_at_start: { ok: true, explain: 'pi_tool_count=5' },
    });
    const stored = jobs.get(job.id)?.input;
    expect(stored?.tm_execution_context?.mcp_server_ids).toEqual([
      'search::playwright',
      'pipe::sequential-thinking',
    ]);
    expect(stored?.tm_enabled_plugin_count).toBe(12);
    expect(stored?.tools_parity_at_start?.ok).toBe(true);
  });

  it('persists tool_catalog_v1 on create', () => {
    const jobs = new JobStore();
    const catalog = {
      schema_version: 1,
      catalog_hash: 'abc123',
      tools: [],
    };
    const job = jobs.create('catalog', {
      job_kind: 'deferred_batch',
      tool_catalog_v1: catalog,
      relay_mode: 'optional',
    });
    expect(jobs.get(job.id)?.input?.tool_catalog_v1).toEqual(catalog);
  });
});
