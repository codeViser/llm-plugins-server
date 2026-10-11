import { describe, expect, it } from 'vitest';

import { computeCatalogHash } from '@/executionSurface/catalogHash';

import { DeferredRunRequestSchema } from '../deferredJobs.model';
import { OR_GATHER_PROFILE } from './fixtures';

const minimalGather = {
  schema_version: 2 as const,
  model_id: 'anthropic/claude-haiku-5.5',
  ref: 'anthropic/claude-haiku-5.5',
  api_family: 'openrouter_chat_completions' as const,
  model_slug: 'anthropic/claude-haiku-5.5',
};

describe('DeferredRunRequestSchema', () => {
  it('accepts realistic plugin payload', () => {
    const body = {
      goal: 'probe',
      dry_run: true,
      gather_profile: {
        ...minimalGather,
        profile_source: 'custom_imported_active',
        body_extensions: { reasoning_effort: 'medium', stream: false },
        chat_overlay: { reasoningEffort: 'auto', maxTokens: 32000 },
      },
      think_profile: {
        schema_version: 2,
        model_id: 'anthropic/claude-sonnet-5.5',
        api_family: 'openrouter_chat_completions',
        model_slug: 'anthropic/claude-sonnet-5.5',
        body_extensions: { reasoning_effort: 'medium' },
      },
      gather_reasoning_effort: 'medium',
      think_reasoning_effort: 'medium',
      tm_enabled_plugin_count: 12,
      tm_execution_context: { mcp_server_ids: ['pipe::x'], enabled_plugin_ids: ['a'] },
      async: true,
      skip_batch: true,
    };
    expect(DeferredRunRequestSchema.safeParse(body).success).toBe(true);
  });

  it('accepts TM plugin payload when chat_overlay and chat_wire are null', () => {
    const body = {
      goal: 'research',
      gather_profile: {
        ...OR_GATHER_PROFILE,
        chat_overlay: null,
      },
      think_profile: {
        ...OR_GATHER_PROFILE,
        model_id: 'anthropic/claude-sonnet-5.5',
        model_slug: 'anthropic/claude-sonnet-5.5',
        chat_overlay: null,
      },
      tm_execution_context: {
        mcp_server_ids: ['pipe::sequential-thinking'],
        enabled_plugin_ids: ['plugin-a'],
        chat_wire: null,
      },
      tm_enabled_plugin_count: 1,
      async: true,
    };
    const parsed = DeferredRunRequestSchema.safeParse(body);
    if (!parsed.success) {
      console.log(parsed.error.issues);
    }
    expect(parsed.success).toBe(true);
    expect(parsed.data.gather_profile.chat_overlay).toBeUndefined();
    expect(parsed.data.tm_execution_context?.chat_wire).toBeUndefined();
  });

  it('accepts omitted chat_overlay and chat_wire', () => {
    const body = {
      goal: 'x',
      gather_profile: minimalGather,
      tm_execution_context: { mcp_server_ids: [] },
    };
    expect(DeferredRunRequestSchema.safeParse(body).success).toBe(true);
  });

  it('accepts tool_catalog_v1', () => {
    const tools = [
      {
        handle: 'plugin:tavily_search',
        function: {
          name: 'tavily_search',
          description: 'search',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const body = {
      goal: 'x',
      gather_profile: minimalGather,
      tool_catalog_v1: {
        schema_version: 1,
        catalog_hash: computeCatalogHash(tools),
        tools,
      },
    };
    expect(DeferredRunRequestSchema.safeParse(body).success).toBe(true);
  });

  it('rejects gather_profile without model_id or ref', () => {
    const body = {
      goal: 'x',
      gather_profile: {
        schema_version: 2,
        api_family: 'openrouter_chat_completions',
        model_slug: 'x',
      },
    };
    expect(DeferredRunRequestSchema.safeParse(body).success).toBe(false);
  });
});
