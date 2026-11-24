/** Sample watchlist and suggestions, only with TRACKER_DEMO=1 (a throwaway in-memory database). */
import { randomUUID } from 'node:crypto'
import { boardKey, type SkipReason, type WatchCompany } from '@shared/search'
import type { Settings } from '../../settings'
import { recordReads, saveLastScan, saveReport } from './status'
import type { SuggestionStore } from './suggestions'
import { saveWatchlist } from './watchlist'

// Track ids the profile demo seeds.
const ML = { trackId: 'demo-ml', trackName: 'ML inference' }
const PHOTONICS = { trackId: 'demo-photonics', trackName: 'Photonics hardware' }

const DEMO_LINK = 'https://example.com/demo-postings/'

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

export function seedSearchDemo(settings: Settings, suggestions: SuggestionStore): void {
  // Made-up companies; demo Find roles replays these results instead of reading any board.
  const watch: Omit<WatchCompany, 'id'>[] = [
    { name: 'Northwind AI', board: 'greenhouse', slug: 'northwind-ai' },
    { name: 'Vectorline Silicon', board: 'ashby', slug: 'vectorline' },
    { name: 'Lumora Photonics', board: 'greenhouse', slug: 'lumora' },
    { name: 'Halcyon Systems', board: 'ashby', slug: 'halcyon' },
    { name: 'Quanta Optics Lab', board: 'greenhouse', slug: 'quanta-optics' },
    { name: 'Quanta Computing', board: 'lever', slug: 'quanta-computing' },
    { name: 'Kestrel Compute', board: 'workday', slug: 'kestrel.wd5/KestrelCareers' },
    { name: 'Prismatic Optics', board: 'workday', slug: 'prismatic.wd1/Careers' },
  ]
  saveWatchlist(
    settings,
    watch.map((c) => ({ ...c, id: randomUUID() })),
  )
  const pick = watch.map((c) => c.name)
  const board = (name: string) => watch.find((c) => c.name === name)!
  // Made-up companies with placeholder links, so the demo never shows a real search.
  suggestions.replaceNew([
    { company: 'Lumora Photonics', title: 'Electrical Engineering Intern – Summer 2027', location: 'Mountain View, CA', postedAt: iso(-3), score: 91, reason: 'Board-level work on photonic computing systems lines up with your optics lab experience, and it is for Summer 2027 in the Bay Area.', pay: '', board: 'greenhouse', rankedBy: 'ai', link: 'https://example.com/demo-postings/1', source: 'boards', ...PHOTONICS },
    { company: 'Vectorline Silicon', title: 'Chip Simulation Software Intern', location: 'San Jose, CA', postedAt: iso(-6), score: 86, reason: 'Simulation software for an inference chip matches your C++ and performance work; on-site in San Jose.', pay: '$50–60/hr', board: 'ashby', rankedBy: 'ai', link: 'https://example.com/demo-postings/2', source: 'boards', ...ML },
    { company: 'Kestrel Compute', title: 'Digital Design Intern – Summer 2027', location: 'Santa Clara, CA', postedAt: iso(-2), score: 84, reason: 'Digital design for accelerator hardware fits your hardware track; Summer 2027 in Santa Clara.', pay: '', board: 'workday', rankedBy: 'ai', link: 'https://example.com/demo-postings/3', source: 'workday', ...PHOTONICS },
    { company: 'Halcyon Systems', title: 'Compiler Engineering Intern', location: 'Sunnyvale, CA or remote', postedAt: iso(-11), score: 78, reason: 'Compiler work overlaps your MLIR coursework; the posting asks for C++ depth you may want to show.', pay: '', board: 'ashby', rankedBy: 'ai', link: 'https://example.com/demo-postings/4', source: 'boards', ...ML },
    { company: 'Prismatic Optics', title: 'Optical Test Engineering Intern', location: 'San Jose, CA', postedAt: iso(-8), score: 76, reason: 'Laser and fiber test work fits your photonics lab bench experience.', pay: '', board: 'workday', rankedBy: 'ai', link: 'https://example.com/demo-postings/5', source: 'simplify', ...PHOTONICS },
    { company: 'Northwind AI', title: 'Research Fellow, ML Systems', location: 'San Francisco, CA; remote (US)', postedAt: iso(-20), score: 72, reason: 'Strong ML systems fit, though fellows are typically further along than an undergraduate intern.', pay: '', board: 'greenhouse', rankedBy: 'ai', link: 'https://example.com/demo-postings/6', source: 'boards', ...ML },
    { company: 'Quanta Optics Lab', title: 'Photonic Device Test Intern', location: 'Palo Alto, CA', postedAt: iso(-29), score: 64, reason: 'Hands-on photonics testing; less software than your other targets.', pay: '$40–48/hr', board: 'greenhouse', rankedBy: 'ai', link: 'https://example.com/demo-postings/7', source: 'boards', ...PHOTONICS },
    { company: 'Quanta Optics Lab', title: 'Quantum Architecture Intern', location: 'Remote', postedAt: iso(-41), score: 55, reason: 'Adjacent architecture work; worth a look if you want to widen beyond AI accelerators.', pay: '', board: 'lever', rankedBy: 'ai', link: 'https://example.com/demo-postings/8', source: 'boards', ...PHOTONICS },
  ])
  // Last checks for Settings > Job boards: most boards fine, one failing.
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)
  recordReads(settings, pick.map((name) => ({ key: boardKey(board(name)), ok: true, error: '' })), hoursAgo(28))
  recordReads(
    settings,
    pick.map((name) => ({ key: boardKey(board(name)), ok: name !== 'Quanta Computing', error: name === 'Quanta Computing' ? 'api.lever.co took too long to answer.' : '' })),
    hoursAgo(3),
  )
  saveLastScan(settings, {
    at: hoursAgo(3).toISOString(),
    ok: true,
    summary: 'Found 8 roles across 7 companies. Checked 412 postings; skipped 3 you may not qualify for, 2 in other places, 6 without your keywords, 4 below the top 40, 389 other role types.',
    scheduled: false,
  })
  // What that run left out, for "View skipped". Made-up companies, placeholder links.
  const skip = (company: string, title: string, location: string, reason: SkipReason, detail: string, n: number) => ({ company, title, location, link: `${DEMO_LINK}skipped-${n}`, reason, detail })
  saveReport(settings, {
    at: hoursAgo(3).toISOString(),
    total: 412,
    matched: 8,
    alreadySeen: 0,
    counts: { type: 389, term: 0, place: 2, excluded: 0, eligibility: 3, keywords: 6, shortlist: 4 },
    skipped: [
      skip('Lumora Photonics', 'Photonic Circuit Design Intern – Summer 2027', 'Mountain View, CA', 'eligibility', 'Asks for at least a PhD: “Currently enrolled in a PhD program in Electrical Engineering, Physics or a related field.”', 1),
      skip('Halcyon Systems', 'Research Intern, Compilers', 'Sunnyvale, CA', 'eligibility', 'Asks for at least a master’s: “Currently pursuing an MS or PhD in Computer Science.”', 2),
      skip('Kestrel Compute', 'Packaging Analysis Intern', 'Santa Clara, CA', 'eligibility', 'The AI ruled it out: Limited to graduate students in mechanical engineering.', 3),
      skip('Vectorline Silicon', 'Inference Intern', 'London, UK', 'place', 'Not in San Francisco Bay Area or remote', 4),
      skip('Northwind AI', 'Software Engineering Intern', 'Toronto, ON', 'place', 'Not in San Francisco Bay Area or remote', 5),
      skip('Brightline Data', 'Product Design Intern', 'San Francisco, CA', 'keywords', 'Mentions none of: CUDA, PyTorch, compilers, ML, inference, GPU', 6),
      skip('Orbitwise', 'Marketing Intern', 'Seattle, WA', 'keywords', 'Mentions none of: CUDA, PyTorch, compilers, ML, inference, GPU', 7),
      skip('Kestrel Compute', 'Senior Compiler Engineer', 'Santa Clara, CA', 'type', 'Not one of the internships you look for', 8),
      skip('Northwind AI', 'Staff ML Engineer, Inference', 'San Francisco, CA', 'type', 'Not one of the internships you look for', 9),
      skip('Tessellate Chips', 'Verification Intern', 'Mountain View, CA', 'shortlist', 'Fit your preferences, but 40 others ranked higher', 10),
      skip('Prismatic Optics', 'Test Automation Intern', 'San Jose, CA', 'shortlist', 'Fit your preferences, but 40 others ranked higher', 11),
    ],
  })
}
