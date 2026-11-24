/**
 * Recall check on real postings (recorded Nov 2026 from public Greenhouse, Ashby and Lever boards, trimmed to
 * their intro and requirements, with company and product names replaced by made-up ones). Each posting has the decision a careful person would make for two applicants.
 * If a filter change drops a role that fits, or keeps one that plainly doesn't, this fails and names it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE, type DegreeLevel, type SearchPreferences } from '@shared/profile'
import type { SkipReason } from '@shared/search'
import type { JobPosting } from './boards'
import { filterPostings } from './filter'

const postings: JobPosting[] = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'recall-postings.json'), 'utf8'))
const byTitle = (company: string, title: string) => `${company} · ${title}`

type Expect = 'keep' | Exclude<SkipReason, 'shortlist'>

function decisions(prefs: SearchPreferences, degree: DegreeLevel): Map<string, Expect> {
  const { kept, skipped } = filterPostings(postings, prefs, degree)
  const out = new Map<string, Expect>()
  for (const p of kept) out.set(byTitle(p.company, p.title), 'keep')
  for (const s of skipped) out.set(byTitle(s.posting.company, s.posting.title), s.reason as Expect)
  return out
}

function check(got: Map<string, Expect>, want: Record<string, Expect>): void {
  const wrong = Object.entries(want)
    .filter(([k, v]) => got.get(k) !== v)
    .map(([k, v]) => `${k}: expected ${v}, got ${got.get(k) ?? 'missing from the fixture'}`)
  expect(wrong).toEqual([])
}

describe('recall on real postings', () => {
  it('an undergraduate looking for Bay Area or remote internships', () => {
    const prefs: SearchPreferences = {
      ...EMPTY_PROFILE.preferences,
      roleTypes: ['internship'],
      targetRoles: ['ML intern', 'Software engineering intern', 'Hardware engineering intern'],
      locations: ['San Francisco Bay Area'],
      remoteOk: true,
      term: 'Summer 2027',
      keywords: ['CUDA', 'compiler', 'photonics', 'inference'],
    }
    check(decisions(prefs, 'bachelors'), {
      // Fits: these must never be dropped.
      'Vectorline Silicon · Inference Intern': 'keep',
      'Vectorline Silicon · Chip Simulation Software Intern': 'keep',
      'Vectorline Silicon · Firmware Intern': 'keep',
      'Vectorline Silicon · DV Intern': 'keep',
      'Lumora Photonics · Electrical Engineering Intern – Summer 2027': 'keep',
      'Lumora Photonics · Analog Engineering Intern - Summer 2027': 'keep',
      'Lumora Photonics · Silicon Validation & Test Automation, Intern Summer 2027': 'keep',
      'Quanta Optics Lab · Intern, Quantum Algorithms and Compilation': 'keep',
      'Quanta Optics Lab · Intern, Optical Packaging and Characterization Engineer': 'keep',
      'Northwind AI · Northwind Fellows Program, ML Systems & Reinforcement Learning': 'keep',
      'Tessellate Chips · Tessellate Chips Internships 2027': 'keep',
      'Brightline Data · Software Engineering Intern (2027)': 'keep',
      // Limited to master's or PhD students.
      'Lumora Photonics · Chip Architecture Intern – Summer 2027': 'eligibility',
      'Lumora Photonics · Photonics Circuit Simulation Intern – Summer 2027': 'eligibility',
      'Lumora Photonics · Packaging Thermal and Mechanical Analysis Internship - Summer 2027': 'eligibility',
      'Lumora Photonics · Optical Packaging Integration Internship – Summer 2027': 'eligibility',
      'Lumora Photonics · Supply Chain Internship - Summer 2027': 'eligibility',
      'Brightline Data · PhD GenAI Research Scientist Intern': 'eligibility',
      'Brightline Data · Data Science Intern (2027 Start)': 'eligibility',
      // Other term, place, field or kind of role.
      'Lumora Photonics · Photonics Characterization Intern- Winter 2026': 'term',
      'Lumora Photonics · Photonics Engineer Intern - Summer 2027': 'place',
      'Brightline Data · Software Engineering Intern (2027 Start) - London': 'place',
      'Brightline Data · Product Design Intern (2027 Start)': 'keywords',
      'Northwind AI · Northwind Fellows Program, The Northwind AI Institute (Economics & Policy)': 'keywords',
      'Halcyon Systems · Kernel Engineer - New Grad': 'type',
      'Northwind AI · Performance Engineer, Inference Systems': 'type',
    })
  })

  it('a master’s student looking for internships and new grad roles', () => {
    const prefs: SearchPreferences = {
      ...EMPTY_PROFILE.preferences,
      roleTypes: ['internship', 'newgrad'],
      targetRoles: ['ML engineer', 'Kernel engineer'],
      locations: ['San Francisco Bay Area'],
      remoteOk: true,
      keywords: ['CUDA', 'inference', 'machine learning'],
    }
    check(decisions(prefs, 'masters'), {
      'Halcyon Systems · Kernel Engineer - New Grad': 'keep',
      // "Toronto, CAN or remote" with remote allowed.
      'Halcyon Systems · Software Engineer - New Grad 2026': 'keep',
      'Brightline Data · Data Science Intern (2027 Start)': 'keep',
      'Lumora Photonics · Optical Packaging Integration Internship – Summer 2027': 'keywords',
      'Lumora Photonics · Chip Architecture Intern – Summer 2027': 'eligibility',
      'Brightline Data · PhD GenAI Research Scientist Intern': 'eligibility',
      'Brightline Data · Software Engineer - New Grad (2027 Start) - London': 'place',
      // Not entry level.
      'Northwind AI · Performance Engineer, Inference Systems': 'type',
    })
  })
})
