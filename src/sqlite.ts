/**
 * Read-only `zotero.sqlite` fallback.
 *
 * The live database belongs to Zotero: this module copies it to a temp
 * directory, opens the copy read-only through `node:sqlite`, extracts items and
 * closes it. It never opens the original for writing and never deletes rows.
 *
 * @module dsh-zotero-bridge/sqlite
 */

import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ZoteroAttachment, ZoteroItem } from './local-api.ts'
import { ZoteroError } from './local-api.ts'

/** Where Zotero keeps its data by default. */
export function defaultDataDirs(): string[] {
  const dirs = [path.join(process.env.HOME ?? '', 'Zotero')]
  if (process.env.USERPROFILE !== undefined) dirs.push(path.join(process.env.USERPROFILE, 'Zotero'))
  return dirs.filter(dir => dir !== '' && existsSync(dir))
}

/**
 * Resolve the configured data directory (or file) to an existing `zotero.sqlite`.
 * @param configured - `dataDir` from config; may be a directory or the file.
 * @returns the database path, or undefined when it does not exist.
 */
export function findDatabase(configured?: string): string | undefined {
  if (configured !== undefined) {
    if (existsSync(configured)) {
      return configured.endsWith('.sqlite') ? configured : path.join(configured, 'zotero.sqlite')
    }
    return undefined
  }
  for (const dir of defaultDataDirs()) {
    const candidate = path.join(dir, 'zotero.sqlite')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

interface ItemRow {
  readonly itemID: number
  readonly key: string
  readonly typeName?: string
}

function stringsOf(rows: readonly Record<string, unknown>[], column: string): string[] {
  return rows
    .map(row => row[column])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map(value => value.trim())
}

function attachmentOf(row: Record<string, unknown>): ZoteroAttachment | undefined {
  const key = typeof row.key === 'string' ? row.key : undefined
  if (key === undefined) return undefined
  return {
    key,
    ...(typeof row.path === 'string' && row.path !== '' ? { path: row.path } : {}),
    ...(typeof row.contentType === 'string' && row.contentType !== '' ? { contentType: row.contentType } : {}),
  }
}

async function withCopy<T>(dbPath: string, run: (db: import('node:sqlite').DatabaseSync) => T): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'zotero-bridge-'))
  const copy = path.join(dir, 'zotero.sqlite')
  try {
    await copyFile(dbPath, copy)
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      return run(db)
    } finally {
      db.close()
    }
  } catch (error) {
    if (error instanceof ZoteroError) throw error
    throw new ZoteroError('invalid-response', `could not read a copy of zotero.sqlite: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function mapRows(db: import('node:sqlite').DatabaseSync, rows: readonly ItemRow[]): ZoteroItem[] {
  const fieldsStatement = db.prepare(
    'SELECT f.fieldName AS name, v.value AS value FROM itemData d JOIN fields f ON f.fieldID = d.fieldID JOIN itemDataValues v ON v.valueID = d.valueID WHERE d.itemID = ?',
  )
  const creatorsStatement = db.prepare(
    'SELECT c.firstName AS firstName, c.lastName AS lastName FROM itemCreators ic JOIN creators c ON c.creatorID = ic.creatorID WHERE ic.itemID = ? ORDER BY ic.orderIndex',
  )
  const attachmentsStatement = db.prepare(
    'SELECT i.key AS key, a.path AS path, a.contentType AS contentType FROM itemAttachments a JOIN items i ON i.itemID = a.itemID WHERE a.parentItemID = ?',
  )
  const items: ZoteroItem[] = []
  for (const row of rows) {
    const fields = fieldsStatement.all(row.itemID) as Array<Record<string, unknown>>
    const field = new Map<string, string>()
    for (const entry of fields) {
      if (typeof entry.name === 'string' && typeof entry.value === 'string') field.set(entry.name, entry.value)
    }
    const creators = (creatorsStatement.all(row.itemID) as Array<Record<string, unknown>>)
      .map(creator => {
        const family = typeof creator.lastName === 'string' ? creator.lastName.trim() : ''
        const given = typeof creator.firstName === 'string' ? creator.firstName.trim() : ''
        return given === '' ? family : `${family}, ${given}`
      })
      .filter(name => name !== '')
    const attachments = (attachmentsStatement.all(row.itemID) as Array<Record<string, unknown>>)
      .map(attachmentOf)
      .filter((attachment): attachment is ZoteroAttachment => attachment !== undefined)
    const date = field.get('date')
    const yearMatch = date === undefined ? null : /(1[5-9]\d{2}|20\d{2}|21\d{2})/u.exec(date)
    const year = yearMatch === null ? undefined : Number.parseInt(yearMatch[1]!, 10)
    const title = field.get('title')
    const doi = field.get('DOI')
    const url = field.get('url')
    const abstract = field.get('abstractNote')
    const publicationTitle = field.get('publicationTitle')
    const tags = stringsOf(db.prepare('SELECT t.name AS name FROM itemTags it JOIN tags t ON t.tagID = it.tagID WHERE it.itemID = ?').all(row.itemID) as Array<Record<string, unknown>>, 'name')
    const collections = stringsOf(db.prepare('SELECT c.key AS key FROM collectionItems ci JOIN collections c ON c.collectionID = ci.collectionID WHERE ci.itemID = ?').all(row.itemID) as Array<Record<string, unknown>>, 'key')
    items.push({
      key: row.key,
      ...(row.typeName === undefined ? {} : { itemType: row.typeName }),
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
      attachments,
    })
  }
  return items
}

/**
 * Read items from a copied database.
 * @param dbPath - path to `zotero.sqlite`.
 * @param options - free-text query, cap, optional exact key.
 * @returns normalized items (newest first; filtered in JS for the query).
 */
export async function readSqliteItems(
  dbPath: string,
  options: { query?: string; limit: number; key?: string },
): Promise<ZoteroItem[]> {
  return withCopy(dbPath, db => {
    const base = 'SELECT i.itemID AS itemID, i.key AS key, t.typeName AS typeName FROM items i LEFT JOIN itemTypes t ON t.itemTypeID = i.itemTypeID WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)'
    const rows = options.key === undefined
      ? db.prepare(`${base} ORDER BY i.itemID DESC LIMIT ?`).all(Math.max(options.limit * 5, 50)) as unknown as ItemRow[]
      : db.prepare(`${base} AND i.key = ? LIMIT 1`).all(options.key) as unknown as ItemRow[]
    let items = mapRows(db, rows)
    const query = options.query?.trim().toLowerCase()
    if (query !== undefined && query !== '') {
      items = items.filter(item => {
        const haystack = [item.title, item.abstract, item.publicationTitle, ...item.creators].join(' ').toLowerCase()
        return haystack.includes(query)
      })
    }
    return items.slice(0, options.limit)
  })
}
