/**
 * The four read-only tools.
 * @module dsh-zotero-bridge/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { ZoteroError } from './local-api.ts'
import type { ZoteroBridgeRuntime } from './runtime.ts'

const ERROR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

function failure(code: string, message: string) {
  return { ok: false as const, error: { code, message } }
}

function codeOf(error: unknown): string {
  return error instanceof ZoteroError ? error.code : 'ERROR'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Build `zotero_status`. */
export function makeZoteroStatusTool(runtime: ZoteroBridgeRuntime) {
  return defineTool({
    name: 'zotero_status',
    description: [
      'Report how dsh-zotero-bridge can reach the local Zotero library (dsh-zotero-bridge).',
      '',
      'Tries the Zotero Local API on loopback; if that is down, looks for a zotero.sqlite to read through a temporary copy. The bridge is read-only in every mode: it never writes, syncs or deletes library data.',
    ].join('\n'),
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          mode: { type: 'string' },
          baseUrl: { type: 'string' },
          database: { type: 'string' },
          readOnly: { type: 'boolean' },
          hints: { type: 'array', items: { type: 'string' } },
          error: ERROR_SCHEMA,
        },
      },
      render: (_args, value) => {
        const result = value as { ok: boolean; mode?: string; baseUrl?: string; database?: string; hints?: string[]; error?: { code: string; message: string } }
        if (!result.ok) return [{ type: 'text', text: `zotero_status failed (${result.error?.code}): ${result.error?.message}` }]
        const lines = [`zotero_status: ${result.mode} (read-only)`, `Local API: ${result.baseUrl ?? '?'}`]
        if (result.database !== undefined) lines.push(`database: ${result.database}`)
        for (const hint of result.hints ?? []) lines.push(`  hint: ${hint}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute() {
      try {
        const status = await runtime.status()
        return { ok: true as const, ...status, hints: [...status.hints] }
      } catch (error) {
        return failure(codeOf(error), messageOf(error))
      }
    },
  })
}

/** Build `zotero_search`. */
export function makeZoteroSearchTool(runtime: ZoteroBridgeRuntime) {
  return defineTool({
    name: 'zotero_search',
    description: [
      'Search the local Zotero library (dsh-zotero-bridge).',
      '',
      'Uses the Local API when available; otherwise reads a temporary copy of zotero.sqlite and filters in memory. Returns normalized items (title, creators, year, DOI, tags, collections, attachments); no PDF download and no write.',
    ].join('\n'),
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text query (title, author, abstract).' },
      limit: { type: 'integer', description: 'Result cap (bounded by config.maxResults).' },
      itemType: { type: 'string', description: 'Optional Zotero item type filter (Local API mode).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          mode: { type: 'string' },
          count: { type: 'integer' },
          items: { type: 'json' },
          error: ERROR_SCHEMA,
        },
      },
      render: (_args, value) => {
        const result = value as { ok: boolean; mode?: string; items?: Array<{ key: string; title?: string; year?: number }>; error?: { code: string; message: string } }
        if (!result.ok) return [{ type: 'text', text: `zotero_search failed (${result.error?.code}): ${result.error?.message}` }]
        const items = result.items ?? []
        const lines = [`zotero_search (${result.mode}): ${items.length} item(s)`]
        for (const item of items.slice(0, 10)) lines.push(`  ${item.year ?? '?'} · ${item.title ?? '(no title)'} [${item.key}]`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(input: unknown) {
      const args = (input ?? {}) as { query?: string; limit?: number; itemType?: string }
      if (typeof args.query !== 'string' || args.query.trim() === '') return failure('INVALID_INPUT', 'query must be a non-empty string')
      try {
        const result = await runtime.search(args.query, {
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.itemType === undefined ? {} : { itemType: args.itemType }),
        })
        return { ok: true as const, mode: result.mode, count: result.items.length, items: result.items as never }
      } catch (error) {
        return failure(codeOf(error), messageOf(error))
      }
    },
  })
}

/** Build `zotero_item`. */
export function makeZoteroItemTool(runtime: ZoteroBridgeRuntime) {
  return defineTool({
    name: 'zotero_item',
    description: 'Read one Zotero item and its attachment metadata by key (dsh-zotero-bridge). Read-only; no attachment download.',
    parameters: {
      key: { type: 'string', required: true, description: 'Zotero item key (8 characters, from zotero_search).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          mode: { type: 'string' },
          item: { type: 'json' },
          error: ERROR_SCHEMA,
        },
      },
      render: (_args, value) => {
        const result = value as { ok: boolean; mode?: string; item?: { key: string; title?: string; creators?: string[]; attachments?: unknown[] }; error?: { code: string; message: string } }
        if (!result.ok) return [{ type: 'text', text: `zotero_item failed (${result.error?.code}): ${result.error?.message}` }]
        const item = result.item
        const lines = [`zotero_item (${result.mode}): ${item?.title ?? '(no title)'} [${item?.key ?? '?'}]`]
        if ((item?.creators ?? []).length > 0) lines.push(`  ${(item?.creators ?? []).join('; ')}`)
        lines.push(`  attachments: ${(item?.attachments ?? []).length}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(input: unknown) {
      const args = (input ?? {}) as { key?: string }
      if (typeof args.key !== 'string' || args.key.trim() === '') return failure('INVALID_INPUT', 'key must be a non-empty string')
      try {
        const result = await runtime.item(args.key.trim())
        return { ok: true as const, mode: result.mode, item: result.item as never }
      } catch (error) {
        return failure(codeOf(error), messageOf(error))
      }
    },
  })
}

/** Build `zotero_to_rep`. */
export function makeZoteroToRepTool(runtime: ZoteroBridgeRuntime) {
  return defineTool({
    name: 'zotero_to_rep',
    description: [
      'Register one Zotero item as REP evidence (dsh-zotero-bridge).',
      '',
      'Captures the normalized item metadata as an immutable JSON snapshot and adds one REP evidence record; without ctx.researchEvidence it writes `<root>/items/<key>.json` instead. Attachment bytes are not downloaded — use doc_anchor on the attachment path when full-text anchors are needed.',
    ].join('\n'),
    parameters: {
      key: { type: 'string', required: true, description: 'Zotero item key.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          key: { type: 'string' },
          persistence: { type: 'json' },
          warnings: { type: 'array', items: { type: 'string' } },
          error: ERROR_SCHEMA,
        },
      },
      render: (_args, value) => {
        const result = value as { ok: boolean; key?: string; persistence?: { mode: string; evidenceId?: string; path?: string }; warnings?: string[]; error?: { code: string; message: string } }
        if (!result.ok) return [{ type: 'text', text: `zotero_to_rep failed (${result.error?.code}): ${result.error?.message}` }]
        const persistence = result.persistence
        const where = persistence?.mode === 'rep'
          ? `REP evidence ${persistence.evidenceId ?? '?'}`
          : persistence?.mode === 'file'
            ? `file ${persistence.path ?? '?'}`
            : 'none'
        const lines = [`zotero_to_rep: ${result.key ?? '?'} → ${where}`]
        for (const warning of result.warnings ?? []) lines.push(`  warning: ${warning}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(input: unknown) {
      const args = (input ?? {}) as { key?: string }
      if (typeof args.key !== 'string' || args.key.trim() === '') return failure('INVALID_INPUT', 'key must be a non-empty string')
      try {
        const result = await runtime.toRep(args.key.trim())
        return { ok: true as const, key: result.item.key, persistence: result.persistence as never, warnings: [...result.warnings] }
      } catch (error) {
        return failure(codeOf(error), messageOf(error))
      }
    },
  })
}
