import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openStore } from './store'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'store-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('Store', () => {
  it('saves to disk and reopens with the same rows', async () => {
    const file = join(dir, 'tracker.sqlite')
    const store = await openStore(file)
    store.migrate([{ id: 't-001', sql: 'CREATE TABLE notes (body TEXT)' }])
    store.run('INSERT INTO notes VALUES (?)', ['hello'])
    store.flush()
    const again = await openStore(file)
    expect(again.all('SELECT body FROM notes')).toEqual([{ body: 'hello' }])
  })

  it('leaves nothing readable in the file after erasing everything', async () => {
    const file = join(dir, 'tracker.sqlite')
    const store = await openStore(file)
    store.migrate([{ id: 't-001', sql: 'CREATE TABLE notes (body TEXT)' }])
    for (let i = 0; i < 200; i++) store.run('INSERT INTO notes VALUES (?)', [`PRIVATE-NOTE-${i}-${'x'.repeat(100)}`])
    store.flush()
    expect(readFileSync(file).includes('PRIVATE-NOTE')).toBe(true)
    store.wipe()
    expect(readFileSync(file).includes('PRIVATE-NOTE')).toBe(false)
    expect(store.all('SELECT * FROM notes')).toEqual([])
  })

  it('overwrites a deleted row instead of leaving it in a free page', async () => {
    const file = join(dir, 'tracker.sqlite')
    const store = await openStore(file)
    store.migrate([{ id: 't-001', sql: 'CREATE TABLE notes (body TEXT)' }])
    store.run('INSERT INTO notes VALUES (?)', ['keep'])
    store.run('INSERT INTO notes VALUES (?)', ['REMOVED-SECRET'])
    store.run('DELETE FROM notes WHERE body = ?', ['REMOVED-SECRET'])
    store.flush()
    expect(readFileSync(file).includes('REMOVED-SECRET')).toBe(false)
  })
})
