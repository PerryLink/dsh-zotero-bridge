/**
 * sqlite fallback: builds a minimal Zotero-shaped database and reads a copy.
 * @module test/sqlite.spec
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findDatabase, readSqliteItems } from '../src/sqlite.ts'

let dir: string
let dbPath: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'zotero-bridge-db-'))
  dbPath = path.join(dir, 'zotero.sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE items (itemID INTEGER PRIMARY KEY, key TEXT, itemTypeID INTEGER);
    CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
    CREATE TABLE deletedItems (itemID INTEGER);
    CREATE TABLE itemData (itemID INTEGER, fieldID INTEGER, valueID INTEGER);
    CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
    CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT);
    CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE itemCreators (itemID INTEGER, creatorID INTEGER, orderIndex INTEGER);
    CREATE TABLE itemAttachments (itemID INTEGER, parentItemID INTEGER, path TEXT, contentType TEXT);
    CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE itemTags (itemID INTEGER, tagID INTEGER);
    CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, key TEXT);
    CREATE TABLE collectionItems (itemID INTEGER, collectionID INTEGER);
  `)
  db.exec(`
    INSERT INTO itemTypes VALUES (1, 'journalArticle'), (2, 'attachment');
    INSERT INTO items VALUES (1, 'ABCD1234', 1), (2, 'PDF00001', 2);
    INSERT INTO fields VALUES (1, 'title'), (2, 'date'), (3, 'DOI'), (4, 'abstractNote');
    INSERT INTO itemDataValues VALUES (1, 'A study of things'), (2, '2020-03-01'), (3, '10.1000/xyz'), (4, 'Damage in a synthetic material.');
    INSERT INTO itemData VALUES (1, 1, 1), (1, 2, 2), (1, 3, 3), (1, 4, 4);
    INSERT INTO creators VALUES (1, 'Jane', 'Doe');
    INSERT INTO itemCreators VALUES (1, 1, 0);
    INSERT INTO itemAttachments VALUES (2, 1, 'storage:paper.pdf', 'application/pdf');
    INSERT INTO tags VALUES (1, 'peridynamics');
    INSERT INTO itemTags VALUES (1, 1);
    INSERT INTO collections VALUES (1, 'COLL0001');
    INSERT INTO collectionItems VALUES (1, 1);
  `)
  db.close()
})

afterEach(async () => {
  if (dir.startsWith(tmpdir())) await rm(dir, { recursive: true, force: true })
})

describe('sqlite fallback', () => {
  it('finds zotero.sqlite in a configured data directory', () => {
    expect(findDatabase(dir)).toBe(dbPath)
    expect(findDatabase(dbPath)).toBe(dbPath)
  })

  it('reads items with creators, fields, tags, collections and attachments', async () => {
    const items = await readSqliteItems(dbPath, { query: 'study', limit: 5 })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      key: 'ABCD1234',
      itemType: 'journalArticle',
      title: 'A study of things',
      creators: ['Doe, Jane'],
      year: 2020,
      doi: '10.1000/xyz',
      tags: ['peridynamics'],
      collections: ['COLL0001'],
      attachments: [{ key: 'PDF00001', path: 'storage:paper.pdf', contentType: 'application/pdf' }],
    })
  })

  it('reads one item by key and returns empty for an unknown query', async () => {
    const byKey = await readSqliteItems(dbPath, { key: 'ABCD1234', limit: 1 })
    expect(byKey).toHaveLength(1)
    expect(await readSqliteItems(dbPath, { query: 'nothing-matches', limit: 5 })).toEqual([])
  })
})
