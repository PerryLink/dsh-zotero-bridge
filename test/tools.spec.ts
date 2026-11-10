/**
 * Tool surface: status/search/item/to_rep, file and REP persistence.
 * @module test/tools.spec
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { LocalApiClient } from '../src/local-api.ts'
import { ZoteroBridgeRuntime, type EvidencePort } from '../src/runtime.ts'
import { makeZoteroItemTool, makeZoteroSearchTool, makeZoteroStatusTool, makeZoteroToRepTool } from '../src/tools.ts'
import { CHILD, ITEM, scriptedFetch } from './helpers.ts'

const AT = new Date('2026-11-10T12:00:00.000Z')
const EXEC = {} as never
const routes = [
  { match: '/api/users/0/items?limit=1', body: [] },
  { match: '/api/users/0/items?', body: [ITEM] },
  { match: '/api/users/0/items/ABCD1234/children', body: [CHILD] },
  { match: '/api/users/0/items/ABCD1234', body: ITEM },
]

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'zotero-bridge-tools-'))
})

afterEach(async () => {
  if (root.startsWith(tmpdir())) await rm(root, { recursive: true, force: true })
})

function runtime(options: { service?: EvidencePort; fail?: boolean } = {}): ZoteroBridgeRuntime {
  const { fetchImpl } = scriptedFetch(options.fail === true ? [] : routes)
  const client = new LocalApiClient({
    baseUrl: 'http://127.0.0.1:23119',
    timeoutMs: 1000,
    fetchImpl: options.fail === true
      ? (async () => { throw new Error('connect ECONNREFUSED') }) as typeof fetch
      : fetchImpl,
  })
  return new ZoteroBridgeRuntime({
    config: resolveConfig({ root }),
    client,
    now: () => AT,
    ...(options.service === undefined ? {} : { service: options.service }),
  })
}

describe('tools', () => {
  it('declares four read-only tools', () => {
    for (const [tool, name] of [
      [makeZoteroStatusTool(runtime()), 'zotero_status'],
      [makeZoteroSearchTool(runtime()), 'zotero_search'],
      [makeZoteroItemTool(runtime()), 'zotero_item'],
      [makeZoteroToRepTool(runtime()), 'zotero_to_rep'],
    ] as const) {
      expect(tool.name).toBe(name)
      expect(tool.output.schema).toBeDefined()
      expect(typeof tool.output.render).toBe('function')
    }
  })

  it('reports local-api mode and searches', async () => {
    const status = (await makeZoteroStatusTool(runtime()).execute({}, EXEC)) as { ok: true; mode: string; readOnly: boolean }
    expect(status.ok).toBe(true)
    expect(status.mode).toBe('local-api')
    expect(status.readOnly).toBe(true)

    const search = (await makeZoteroSearchTool(runtime()).execute({ query: 'things', limit: 5 }, EXEC)) as {
      ok: true
      mode: string
      count: number
      items: Array<{ key: string; title: string }>
    }
    expect(search.ok).toBe(true)
    expect(search.count).toBe(1)
    expect(search.items[0]?.key).toBe('ABCD1234')
  })

  it('reads one item with attachments', async () => {
    const value = (await makeZoteroItemTool(runtime()).execute({ key: 'ABCD1234' }, EXEC)) as {
      ok: true
      item: { attachments: unknown[] }
    }
    expect(value.ok).toBe(true)
    expect(value.item.attachments).toHaveLength(1)
  })

  it('writes the item file when no REP service is mounted', async () => {
    const value = (await makeZoteroToRepTool(runtime()).execute({ key: 'ABCD1234' }, EXEC)) as {
      ok: true
      persistence: { mode: string; path?: string }
    }
    expect(value.ok).toBe(true)
    expect(value.persistence.mode).toBe('file')
    const file = value.persistence.path!
    const written = JSON.parse(await readFile(file, 'utf8')) as { item: { key: string } }
    expect(written.item.key).toBe('ABCD1234')
  })

  it('registers REP evidence when the service is mounted', async () => {
    const captured: unknown[] = []
    const service: EvidencePort = {
      async capture(input) {
        captured.push(input)
        return { snapshot: { snapshotId: 'snap-1' } as never }
      },
      async addEvidence(input) {
        expect(input.snapshotIds).toEqual(['snap-1'])
        return { evidence: { evidenceId: 'ev-1' } as never }
      },
    }
    const value = (await makeZoteroToRepTool(runtime({ service })).execute({ key: 'ABCD1234' }, EXEC)) as {
      ok: true
      persistence: { mode: string; evidenceId?: string }
    }
    expect(value.ok).toBe(true)
    expect(value.persistence.mode).toBe('rep')
    expect(value.persistence.evidenceId).toBe('ev-1')
    expect(captured).toHaveLength(1)
  })

  it('reports unavailable when the API is down and no database is configured', async () => {
    const value = (await makeZoteroStatusTool(runtime({ fail: true })).execute({}, EXEC)) as { ok: true; mode: string; hints: string[] }
    expect(value.ok).toBe(true)
    expect(value.mode).toBe('unavailable')
    expect(value.hints.join(' ')).toContain('read-only')
  })
})
