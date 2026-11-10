/**
 * Scripted fetch for the Local API tests.
 * @module test/helpers
 */

/** One route. */
export interface Route {
  readonly match: string
  readonly body: unknown
  readonly status?: number
}

/**
 * Build a fetch that answers from a route table.
 * @param routes - routes in match order.
 * @returns the fetch seam and its call log.
 */
export function scriptedFetch(routes: readonly Route[]): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input)
    calls.push(url)
    const route = routes.find(candidate => url.includes(candidate.match))
    if (route === undefined) return new Response('', { status: 404 })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
  return { fetchImpl: impl as typeof fetch, calls }
}

/** One Zotero item payload. */
export const ITEM = {
  key: 'ABCD1234',
  version: 7,
  data: {
    key: 'ABCD1234',
    version: 7,
    itemType: 'journalArticle',
    title: 'A study of things',
    creators: [{ firstName: 'Jane', lastName: 'Doe' }, { name: 'Consortium' }],
    date: '2020-03-01',
    DOI: '10.1000/xyz',
    url: 'https://example.org/a',
    abstractNote: 'Damage in a synthetic material.',
    publicationTitle: 'Journal of Tests',
    tags: [{ tag: 'peridynamics' }],
    collections: ['COLL0001'],
  },
}

/** One attachment child payload. */
export const CHILD = {
  key: 'PDF00001',
  data: {
    key: 'PDF00001',
    itemType: 'attachment',
    title: 'Full Text PDF',
    path: 'storage:paper.pdf',
    contentType: 'application/pdf',
  },
}
