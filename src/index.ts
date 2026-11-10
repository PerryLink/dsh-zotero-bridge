/**
 * `dsh-zotero-bridge` — read-only access to a local Zotero library.
 *
 * Local API first, a copied `zotero.sqlite` second, REP/file registration for
 * selected items. There is no write path in this package.
 *
 * @module dsh-zotero-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config, resolveConfig, type Config as ConfigShape } from './config.ts'
import { ZoteroBridgeRuntime, type EvidencePort } from './runtime.ts'
import {
  makeZoteroItemTool,
  makeZoteroSearchTool,
  makeZoteroStatusTool,
  makeZoteroToRepTool,
} from './tools.ts'
import { VERSION } from './version.ts'

/** Cordis plugin name. */
export const name = 'zotero-bridge'

/** The tool registry is required; the REP service is optional. */
export const inject = ['tools']

export { Config, resolveConfig, VERSION }
export type { ConfigShape }
export type { ResolvedConfig } from './config.ts'
export { LocalApiClient, ZoteroError } from './local-api.ts'
export type { LocalApiOptions, ZoteroAttachment, ZoteroErrorCode, ZoteroItem } from './local-api.ts'
export { defaultDataDirs, findDatabase, readSqliteItems } from './sqlite.ts'
export { ZoteroBridgeRuntime } from './runtime.ts'
export type { BridgeRuntimeOptions, BridgeSearchResult, BridgeStatus, EvidencePort, Persistence } from './runtime.ts'
export { makeZoteroItemTool, makeZoteroSearchTool, makeZoteroStatusTool, makeZoteroToRepTool } from './tools.ts'

/**
 * Mount the four read-only tools.
 * @param ctx - the plugin context (host).
 * @param config - raw plugin config.
 */
export function apply(ctx: Context, config: ConfigShape): void {
  const resolved = resolveConfig(config)
  const logger = ctx.logger('zotero-bridge')
  if (!resolved.enabled) {
    logger.info('disabled: enabled is false — no tools are mounted')
    return
  }
  const service = ctx.get('researchEvidence') as EvidencePort | undefined
  const runtime = new ZoteroBridgeRuntime({ config: resolved, ...(service === undefined ? {} : { service }) })
  if (service === undefined) {
    logger.info(`ctx.researchEvidence is not mounted; zotero_to_rep falls back to files under ${resolved.root}`)
  }
  ctx.effect(() => ctx.tools.register(makeZoteroStatusTool(runtime)), 'zotero-bridge: zotero_status tool')
  ctx.effect(() => ctx.tools.register(makeZoteroSearchTool(runtime)), 'zotero-bridge: zotero_search tool')
  ctx.effect(() => ctx.tools.register(makeZoteroItemTool(runtime)), 'zotero-bridge: zotero_item tool')
  ctx.effect(() => ctx.tools.register(makeZoteroToRepTool(runtime)), 'zotero-bridge: zotero_to_rep tool')
}
