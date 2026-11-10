/**
 * Package contract: version, bundle patch, zero runtime dependencies.
 * @module test/package.spec
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/version.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('package contract', () => {
  it('single-sources the version and declares the bundle', async () => {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      version: string
      dsh?: { bundle?: { patch?: string } }
      files?: string[]
      dependencies?: Record<string, string>
    }
    expect(VERSION).toBe(pkg.version)
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(pkg.files).toContain('lib')
    expect(pkg.files).toContain('cordis.patch.yml')
    expect(Object.keys(pkg.dependencies ?? {})).toHaveLength(0)
  })
})
