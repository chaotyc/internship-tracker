import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }))

import { openStore } from '../../db/store'
import { parseCsv, rolesFromCsv, stageFromStatus } from './csv'
import { orderAt } from '@shared/order'
import { RolesService, rolesMigrations, normalizeUrl } from './service'

async function service() {
  const store = await openStore(null)
  store.migrate(rolesMigrations)
  const changed: string[][] = []
  return { svc: new RolesService(store, (ids) => changed.push(ids)), changed }
}

describe('csv', () => {
  it('parses quotes, commas and newlines inside fields', () => {
    expect(parseCsv('a,"b, c","d ""e"""\n"x\ny",z')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['x\ny', 'z'],
    ])
  })

  it('finds a header row below title rows and maps statuses to stages', () => {
    const csv = [
      '"Targets (researched Nov 16)",,,',
      ',,,',
      'Priority,Company,Role,My status,Job fit,Link',
      '1,Vectorline,Inference Intern,Applied Nov 18,Strong,https://jobs.ashbyhq.com/vectorline/1',
      '1,Kite,Optical Intern,Applied Nov 18 · Initial prescreen,Strong,Link',
      '2,Acme,,Not started,Good,',
    ].join('\n')
    const roles = rolesFromCsv(csv)
    expect(roles).toHaveLength(2)
    expect(roles[0]).toMatchObject({ company: 'Vectorline', title: 'Inference Intern', stage: 'applied', fit: 'Strong' })
    expect(roles[0]!.link).toBe('https://jobs.ashbyhq.com/vectorline/1')
    expect(roles[1]).toMatchObject({ stage: 'interviewing', link: '' })
  })

  it('maps status words', () => {
    expect(stageFromStatus('Not started')).toBe('saved')
    expect(stageFromStatus('Closed')).toBe('closed')
    expect(stageFromStatus('Offer received')).toBe('offer')
    expect(stageFromStatus('Rejected after loop')).toBe('rejected')
  })
})

describe('orderAt', () => {
  it('places between, before, after and alone', () => {
    expect(orderAt([1, 3], 1)).toBe(2)
    expect(orderAt([10], 0)).toBe(10 - 1024)
    expect(orderAt([10], 5)).toBe(10 + 1024)
    expect(orderAt([], 0)).toBe(1024)
  })
})

describe('RolesService', () => {
  it('creates, moves into order, stamps applied date, and deletes', async () => {
    const { svc, changed } = await service()
    const a = svc.create({ company: 'A', title: 'Intern' })
    const b = svc.create({ company: 'B', title: 'Intern' })
    const c = svc.create({ company: 'C', title: 'Intern', stage: 'applied' })
    expect(c.appliedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    svc.move(a.id, 'applied', 0)
    const applied = svc.list().filter((r) => r.stage === 'applied').map((r) => r.company)
    expect(applied).toEqual(['A', 'C'])
    expect(svc.get(a.id)!.appliedOn).not.toBe('')

    svc.move(b.id, 'applied', 1)
    expect(svc.list().filter((r) => r.stage === 'applied').map((r) => r.company)).toEqual(['A', 'B', 'C'])

    svc.delete(c.id)
    expect(svc.get(c.id)).toBeNull()
    expect(changed.length).toBeGreaterThan(4)
  })

  it('skips duplicates on bulk import', async () => {
    const { svc } = await service()
    svc.create({ company: 'Vectorline', title: 'Inference Intern' })
    const res = svc.createMany([
      { company: 'vectorline ', title: 'inference intern' },
      { company: 'Tessellate', title: 'Internships 2027' },
    ])
    expect(res).toEqual({ added: 1, skipped: 1 })
  })

  it('rejects a role without a company or title', async () => {
    const { svc } = await service()
    expect(() => svc.create({ company: ' ', title: 'x' })).toThrow(/company and a title/)
  })

  it('normalizes tracking params out of links', () => {
    expect(normalizeUrl('https://Boards.greenhouse.io/x/jobs/1?gh_src=abc#app')).toBe(
      normalizeUrl('https://boards.greenhouse.io/x/jobs/1/'),
    )
  })
})
