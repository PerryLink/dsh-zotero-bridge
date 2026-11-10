/**
 * Zotero Local API client (read-only).
 *
 * Zotero 7+ exposes a local HTTP API on `127.0.0.1:23119` when "Allow other
 * applications on this computer to communicate with Zotero" is enabled. This
 * client only performs GETs; it never writes, syncs or calls the Web API.
 *
 * @module dsh-zotero-bridge/local-api
 */

/** One attachment/child record. */
export interface ZoteroAttachment {
  readonly key: string
  readonly title?: string
  /** `storage:name.pdf` for stored files, or an absolute path. */
  readonly path?: string
  readonly contentType?: string
  readonly url?: string
}

/** One normalized Zotero item. */
export interface ZoteroItem {
  readonly key: string
  readonly version?: number
  readonly itemType?: string
  readonly title?: string
  readonly creators: readonly string[]
  readonly date?: string
  readonly year?: number
  readonly doi?: string
  readonly url?: string
  readonly abstract?: string
  readonly publicationTitle?: string
  readonly tags: readonly string[]
  readonly collections: readonly string[]
  readonly attachments: readonly ZoteroAttachment[]
}

/** Stable failure codes. */
export type ZoteroErrorCode = 'unreachable' | 'http' | 'invalid-response' | 'not-found'

/** A typed bridge failure. */
export class ZoteroError extends Error {
  /** Stable code. */
  readonly code: ZoteroErrorCode
  /** HTTP status when applicable. */
  readonly status?: number

  constructor(code: ZoteroErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'ZoteroError'
    this.code = code
    if (status !== undefined) this.status = status
  }
}

/** Client options. */
export interface LocalApiOptions {
  readonly baseUrl: string
  readonly timeoutMs: number
  readonly fetchImpl?: typeof fetch
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function yearOf(date: string | undefined): number | undefined {
  if (date === undefined) return undefined
  const match = /(1[5-9]\d{2}|20\d{2}|21\d{2})/u.exec(date)
  return match === null ? undefined : Number.parseInt(match[1]!, 10)
}

function creatorName(creator: Record<string, unknown>): string | undefined {
  const literal = stringOf(creator.name)
  if (literal !== undefined) return literal
  const family = stringOf(creator.lastName) ?? stringOf(creator.family)
  const given = stringOf(creator.firstName) ?? stringOf(creator.given)
  if (family === undefined && given === undefined) return undefined
  if (family === undefined) return given
  return given === undefined ? family : `${family}, ${given}`
}

function mapItem(raw: unknown): ZoteroItem {
  if (typeof raw !== 'object' || raw === null) throw new ZoteroError('invalid-response', 'item is not an object')
  const record = raw as Record<string, unknown>
  const data = typeof record.data === 'object' && record.data !== null ? record.data as Record<string, unknown> : record
  const key = stringOf(record.key) ?? stringOf(data.key)
  if (key === undefined) throw new ZoteroError('invalid-response', 'item has no key')
  const creatorsRaw = Array.isArray(data.creators) ? data.creators : []
  const creators = creatorsRaw
    .map(creator => (typeof creator === 'object' && creator !== null ? creatorName(creator as Record<string, unknown>) : undefined))
    .filter((name): name is string => name !== undefined)
  const tagsRaw = Array.isArray(data.tags) ? data.tags : []
  const tags = tagsRaw
    .map(tag => (typeof tag === 'string' ? tag : typeof tag === 'object' && tag !== null ? stringOf((tag as { tag?: unknown }).tag) : undefined))
    .filter((tag): tag is string => tag !== undefined)
  const collections = (Array.isArray(data.collections) ? data.collections : []).filter((value): value is string => typeof value === 'string')
  const date = stringOf(data.date)
  const year = yearOf(date)
  const itemType = stringOf(data.itemType)
  const title = stringOf(data.title)
  const doi = stringOf(data.DOI)
  const url = stringOf(data.url)
  const abstract = stringOf(data.abstractNote)
  const publicationTitle = stringOf(data.publicationTitle)
  const version = typeof record.version === 'number' ? record.version : typeof data.version === 'number' ? data.version : undefined
  return {
    key,
    ...(version === undefined ? {} : { version }),
    ...(itemType === undefined ? {} : { itemType }),
    ...(title === undefined ? {} : { title }),
    creators,
    ...(date === undefined ? {} : { date }),
    ...(year === undefined ? {} : { year }),
    ...(doi === undefined ? {} : { doi }),
    ...(url === undefined ? {} : { url }),
    ...(abstract === undefined ? {} : { abstract }),
    ...(publicationTitle === undefined ? {} : { publicationTitle }),
    tags,
    collections,
    attachments: [],
  }
}

function mapAttachment(raw: unknown): ZoteroAttachment | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const data = typeof record.data === 'object' && record.data !== null ? record.data as Record<string, unknown> : record
  if (stringOf(data.itemType) !== 'attachment') return undefined
  const key = stringOf(record.key) ?? stringOf(data.key)
  if (key === undefined) return undefined
  const title = stringOf(data.title) ?? stringOf(data.filename)
  const attachmentPath = stringOf(data.path)
  const contentType = stringOf(data.contentType)
  const url = stringOf(data.url)
  return {
    key,
    ...(title === undefined ? {} : { title }),
    ...(attachmentPath === undefined ? {} : { path: attachmentPath }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(url === undefined ? {} : { url }),
  }
}

/** The read-only Local API client. */
export class LocalApiClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: LocalApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '')
    this.timeoutMs = options.timeoutMs
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private async get(path: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) throw new ZoteroError('unreachable', `Zotero Local API timed out after ${this.timeoutMs}ms`)
      throw new ZoteroError('unreachable', `Zotero Local API is not reachable at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timer)
    }
    if (response.status === 404) throw new ZoteroError('not-found', `not found: ${path}`, 404)
    if (!response.ok) throw new ZoteroError('http', `HTTP ${response.status} from ${path}`, response.status)
    try {
      return await response.json()
    } catch (error) {
      throw new ZoteroError('invalid-response', `invalid JSON from ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Probe the API.
   * @returns true when the item endpoint answers.
   */
  async status(): Promise<{ ok: boolean; baseUrl: string }> {
    await this.get('/api/users/0/items?limit=1')
    return { ok: true, baseUrl: this.baseUrl }
  }

  /**
   * Search the library.
   * @param query - free text (Zotero `q`).
   * @param options - result cap and optional item type.
   * @returns normalized items.
   */
  async search(query: string, options: { limit: number; itemType?: string }): Promise<ZoteroItem[]> {
    const params = new URLSearchParams({ limit: String(options.limit), q: query, qmode: 'everything' })
    if (options.itemType !== undefined) params.set('itemType', options.itemType)
    const payload = await this.get(`/api/users/0/items?${params.toString()}`)
    if (!Array.isArray(payload)) throw new ZoteroError('invalid-response', 'search response is not an array')
    return payload.map(mapItem)
  }

  /**
   * Read one item and its attachments.
   * @param key - Zotero item key.
   * @returns the item with attachments.
   */
  async item(key: string): Promise<ZoteroItem> {
    const payload = await this.get(`/api/users/0/items/${encodeURIComponent(key)}`)
    const item = mapItem(payload)
    const children = await this.get(`/api/users/0/items/${encodeURIComponent(key)}/children`)
    const attachments = Array.isArray(children)
      ? children.map(mapAttachment).filter((attachment): attachment is ZoteroAttachment => attachment !== undefined)
      : []
    return { ...item, attachments }
  }
}
