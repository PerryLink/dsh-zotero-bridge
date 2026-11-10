/**
 * Local API: status, search mapping, item + attachments, unreachable errors.
 * @module test/local-api.spec
 */

import { describe, expect, it } from 'vitest'
import { LocalApiClient, ZoteroError } from '../src/local-api.ts'
import { CHILD, ITEM, scriptedFetch } from './helpers.ts'

function client(routes: Parameters<typeof scriptedFetch>[0], baseUrl = 'http://127.0.0.1:23119') {
  const { fetchImpl } = scriptedFetch(routes)
  return new LocalApiClient({ baseUrl, timeoutMs: 1000, fetchImpl })
}

describe('LocalApiClient', () => {
  it('probes the item endpoint', async () => {
    const status = await client([{ match: '/api/users/0/items?limit=1', body: [] }]).status()
    expect(status).toEqual({ ok: true, baseUrl: 'http://127.0.0.1:23119' })
  })

  it('maps search results', async () => {
    const items = await client([{ match: '/api/users/0/items?', body: [ITEM] }]).search('things', { limit: 5 })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      key: 'ABCD1234',
      title: 'A study of things',
      creators: ['Doe, Jane', 'Consortium'],
      year: 2020,
      doi: '10.1000/xyz',
      tags: ['peridynamics'],
      collections: ['COLL0001'],
    })
  })

  it('reads one item and its attachments', async () => {
    const items = await client([
      { match: '/api/users/0/items/ABCD1234/children', body: [CHILD] },
      { match: '/api/users/0/items/ABCD1234', body: ITEM },
    ]).item('ABCD1234')
    expect(items.attachments).toEqual([{ key: 'PDF00001', title: 'Full Text PDF', path: 'storage:paper.pdf', contentType: 'application/pdf' }])
  })

  it('maps transport failures to unreachable', async () => {
    const { fetchImpl } = scriptedFetch([])
    const failing = async (): Promise<Response> => {
      throw new Error('connect ECONNREFUSED')
    }
    const api = new LocalApiClient({ baseUrl: 'http://127.0.0.1:23119', timeoutMs: 1000, fetchImpl: failing as typeof fetch })
    await expect(api.status()).rejects.toMatchObject({ code: 'unreachable' })
    expect(fetchImpl).toBeDefined()
  })

  it('maps 404 to not-found', async () => {
    const api = client([{ match: '/api/users/0/items/NOPE', body: {}, status: 404 }])
    await expect(api.item('NOPE')).rejects.toBeInstanceOf(ZoteroError)
  })
})
