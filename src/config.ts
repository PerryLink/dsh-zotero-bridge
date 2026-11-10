/**
 * Config schema and resolution for `dsh-zotero-bridge`.
 *
 * The bridge is read-only by construction: there is no write path, no sync and
 * no cloud call. The Local API URL must be loopback; the sqlite fallback reads
 * a copy, never the live database.
 * @module dsh-zotero-bridge/config
 */

import path from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Raw plugin config — every field optional. */
export interface Config {
  /** Master switch. `false` mounts nothing. */
  enabled?: boolean
  /** Item-record fallback root, resolved against the harness working directory. */
  root?: string
  /** Zotero Local API base URL (loopback only). */
  localApiUrl?: string
  /** Zotero data directory (holds `zotero.sqlite`), or the database file itself. */
  dataDir?: string
  /** Per-request deadline in milliseconds. */
  timeoutMs?: number
  /** Search result cap. */
  maxResults?: number
}

/** Fully resolved config. */
export interface ResolvedConfig {
  readonly enabled: boolean
  readonly root: string
  readonly localApiUrl: string
  readonly dataDir?: string
  readonly timeoutMs: number
  readonly maxResults: number
}

/** Schemastery schema: the loader validates and fills defaults before `apply`. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  root: z.string().default('.zotero-bridge'),
  localApiUrl: z.string().default('http://127.0.0.1:23119'),
  dataDir: z.string(),
  timeoutMs: z.number().default(10_000),
  maxResults: z.number().default(25),
})

/**
 * Validate raw values and fill explicit defaults.
 * @param config - raw (possibly partial) plugin config.
 * @returns the fully resolved config.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const root = config.root ?? '.zotero-bridge'
  if (typeof root !== 'string' || root.trim() === '') throw new TypeError('root must be a non-empty path')
  const localApiUrl = (config.localApiUrl ?? 'http://127.0.0.1:23119').replace(/\/+$/u, '')
  let parsed: URL
  try {
    parsed = new URL(localApiUrl)
  } catch {
    throw new TypeError(`localApiUrl must be a valid URL, got ${JSON.stringify(localApiUrl)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError('localApiUrl must be http(s)')
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
    throw new TypeError(`localApiUrl must be loopback (127.0.0.1/localhost), got ${parsed.hostname}`)
  }
  const timeoutMs = config.timeoutMs ?? 10_000
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive integer')
  const maxResults = config.maxResults ?? 25
  if (!Number.isInteger(maxResults) || maxResults <= 0 || maxResults > 100) throw new TypeError('maxResults must be an integer within 1..100')
  const dataDir = config.dataDir?.trim()
  return {
    enabled: config.enabled ?? true,
    root: path.resolve(root),
    localApiUrl,
    ...(dataDir === undefined || dataDir === '' ? {} : { dataDir: path.resolve(dataDir) }),
    timeoutMs,
    maxResults,
  }
}
