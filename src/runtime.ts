/**
 * Bridge runtime: Local API first, copied sqlite second, REP/file persistence.
 * @module dsh-zotero-bridge/runtime
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AddEvidenceInput,
  CaptureInput,
  CheckResult,
  Evidence,
  Snapshot,
  SourceRef,
} from '@perrylink/dsh-research-core'
import type { ResolvedConfig } from './config.ts'
import { LocalApiClient, ZoteroError, type ZoteroItem } from './local-api.ts'
import { findDatabase, readSqliteItems } from './sqlite.ts'
import { VERSION } from './version.ts'

/** The subset of the REP service this plugin needs. */
export interface EvidencePort {
  capture(input: CaptureInput): Promise<{ snapshot: Snapshot }>
  addEvidence(input: AddEvidenceInput): Promise<{ evidence: Evidence }>
}

/** Where the item landed. */
export type Persistence =
  | { readonly mode: 'rep'; readonly evidenceId: string; readonly snapshotId: string }
  | { readonly mode: 'file'; readonly path: string }
  | { readonly mode: 'none'; readonly reason: string }

/** Runtime options. */
export interface BridgeRuntimeOptions {
  readonly config: ResolvedConfig
  readonly client?: LocalApiClient
  readonly service?: EvidencePort
  readonly now?: () => Date
}

/** Status of the bridge. */
export interface BridgeStatus {
  readonly mode: 'local-api' | 'sqlite' | 'unavailable'
  readonly baseUrl: string
  readonly database?: string
  readonly readOnly: true
  readonly hints: readonly string[]
}

/** Search result. */
export interface BridgeSearchResult {
  readonly mode: 'local-api' | 'sqlite'
  readonly items: readonly ZoteroItem[]
}

/** The bridge runtime. */
export class ZoteroBridgeRuntime {
  /** Resolved config. */
  readonly config: ResolvedConfig
  private readonly client: LocalApiClient
  private readonly service: EvidencePort | undefined
  private readonly now: () => Date

  constructor(options: BridgeRuntimeOptions) {
    this.config = options.config
    this.client = options.client ?? new LocalApiClient({ baseUrl: options.config.localApiUrl, timeoutMs: options.config.timeoutMs })
    this.service = options.service
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Probe Local API, then the database copy.
   * @returns the active mode and hints.
   */
  async status(): Promise<BridgeStatus> {
    try {
      await this.client.status()
      return {
        mode: 'local-api',
        baseUrl: this.config.localApiUrl,
        readOnly: true,
        hints: [],
      }
    } catch (error) {
      const database = findDatabase(this.config.dataDir)
      if (database !== undefined) {
        return {
          mode: 'sqlite',
          baseUrl: this.config.localApiUrl,
          database,
          readOnly: true,
          hints: [
            `Local API unavailable (${error instanceof Error ? error.message : String(error)}); reads use a temporary copy of zotero.sqlite. Start Zotero and enable Settings → Advanced → "Allow other applications on this computer to communicate with Zotero" for live search.`,
          ],
        }
      }
      return {
        mode: 'unavailable',
        baseUrl: this.config.localApiUrl,
        readOnly: true,
        hints: [
          'Zotero Local API is unreachable and no zotero.sqlite was found.',
          'Start Zotero and enable Settings → Advanced → "Allow other applications on this computer to communicate with Zotero", or set config.dataDir to the Zotero data directory.',
          'The bridge is read-only: it never writes, syncs or deletes library data.',
        ],
      }
    }
  }

  /**
   * Search the library, preferring the Local API.
   * @param query - free text.
   * @param options - limit and optional item type.
   * @returns the mode and normalized items.
   */
  async search(query: string, options: { limit?: number; itemType?: string } = {}): Promise<BridgeSearchResult> {
    const limit = Math.min(options.limit ?? this.config.maxResults, this.config.maxResults)
    try {
      const items = await this.client.search(query, { limit, ...(options.itemType === undefined ? {} : { itemType: options.itemType }) })
      return { mode: 'local-api', items }
    } catch (error) {
      const database = findDatabase(this.config.dataDir)
      if (database === undefined) throw error
      const items = await readSqliteItems(database, { query, limit })
      return { mode: 'sqlite', items }
    }
  }

  /**
   * Read one item, preferring the Local API.
   * @param key - Zotero item key.
   * @returns the mode and item.
   */
  async item(key: string): Promise<{ mode: 'local-api' | 'sqlite'; item: ZoteroItem }> {
    try {
      const item = await this.client.item(key)
      return { mode: 'local-api', item }
    } catch (error) {
      if (error instanceof ZoteroError && error.code === 'not-found') throw error
      const database = findDatabase(this.config.dataDir)
      if (database === undefined) throw error
      const items = await readSqliteItems(database, { key, limit: 1 })
      const item = items[0]
      if (item === undefined) throw new ZoteroError('not-found', `no Zotero item with key ${key}`)
      return { mode: 'sqlite', item }
    }
  }

  /**
   * Register one item as REP evidence (or write it under `<root>/items/`).
   * @param key - Zotero item key.
   * @returns the item, where it landed and warnings.
   */
  async toRep(key: string): Promise<{ item: ZoteroItem; persistence: Persistence; warnings: readonly string[] }> {
    const { item } = await this.item(key)
    const generatedAt = this.now().toISOString()
    const bytes = JSON.stringify({ plugin: 'dsh-zotero-bridge', version: VERSION, generatedAt, item }, null, 2)
    const warnings: string[] = []
    if (item.attachments.length > 0) {
      warnings.push('attachment bytes are not downloaded by this plugin; run doc_anchor on the attachment path to anchor full text')
    }
    if (this.service === undefined) {
      const directory = path.join(this.config.root, 'items')
      await mkdir(directory, { recursive: true })
      const file = path.join(directory, `${key}.json`)
      await writeFile(file, bytes, 'utf8')
      return { item, persistence: { mode: 'file', path: file }, warnings }
    }
    const sourceRef: SourceRef = {
      kind: 'other',
      id: `zotero:${item.key}`,
      retrievedAt: generatedAt,
      metadata: {
        ...(item.title === undefined ? {} : { title: item.title }),
        ...(item.year === undefined ? {} : { year: item.year }),
        ...(item.creators.length === 0 ? {} : { authors: [...item.creators] }),
        type: 'zotero-item',
      },
    }
    const capture = await this.service.capture({
      bytes,
      mediaType: 'application/json',
      sourceRef,
      capturedAt: generatedAt,
      encoding: 'utf-8',
    })
    const check: CheckResult = {
      checkId: `zotero-${item.key}`.slice(0, 64),
      check: 'source-status',
      status: 'pass',
      detail: 'read from the local Zotero library (read-only bridge)',
    }
    const evidence = await this.service.addEvidence({
      ...(item.title === undefined ? {} : { title: item.title }),
      sourceRef,
      snapshotIds: [capture.snapshot.snapshotId],
      anchors: [],
      provenance: {
        plugin: 'dsh-zotero-bridge',
        version: VERSION,
        method: 'read-only Zotero item export (Local API or sqlite copy)',
        retrievedAt: generatedAt,
        toolRun: `zotero:${item.key}`,
      },
      checks: [check],
      labels: ['zotero'],
    })
    return {
      item,
      persistence: { mode: 'rep', evidenceId: evidence.evidence.evidenceId, snapshotId: capture.snapshot.snapshotId },
      warnings,
    }
  }
}
