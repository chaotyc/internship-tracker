/** Sample watchlist and suggestions, only with TRACKER_DEMO=1 (a throwaway in-memory database). */
import { randomUUID } from 'node:crypto'
import { SUGGESTED_COMPANIES, boardKey, boardUrl } from '@shared/search'
import type { Settings } from '../../settings'
import { recordReads, saveLastScan } from './status'
import type { SuggestionStore } from './suggestions'
import { saveWatchlist } from './watchlist'

// Track ids the profile demo seeds.
const ML = { trackId: 'demo-ml', trackName: 'ML inference' }
const PHOTONICS = { trackId: 'demo-photonics', trackName: 'Photonics hardware' }

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

export function seedSearchDemo(settings: Settings, suggestions: SuggestionStore): void {
  const pick = ['Northwind AI', 'Vectorline', 'Lumora Photonics', 'Halcyon', 'Quanta Optics Lab', 'Quanta Computing', 'Kestrel', 'Prismatic Optics']
  saveWatchlist(
    settings,
    SUGGESTED_COMPANIES.filter((c) => pick.includes(c.name)).map(({ group: _g, ...c }) => ({ ...c, id: randomUUID() })),
  )
  const board = (name: string) => SUGGESTED_COMPANIES.find((c) => c.name === name)!
  // Links point at each company's board page (tagged so they stay distinct), not at made-up postings.
  suggestions.replaceNew([
    { company: 'Lumora Photonics', title: 'Optical Packaging Integration Intern – Summer 2027', location: 'Mountain View, CA', postedAt: iso(-3), score: 91, reason: 'Photonics packaging work lines up with your optics lab experience, and it is for Summer 2027 in the Bay Area.', pay: '', board: 'greenhouse', rankedBy: 'ai', link: boardUrl(board('Lumora Photonics')) + '?demo=1', source: 'boards', ...PHOTONICS },
    { company: 'Vectorline', title: 'Inference Systems Intern', location: 'San Jose, CA', postedAt: iso(-6), score: 86, reason: 'Inference kernels and CUDA match your target roles; on-site in San Jose.', pay: '$50–60/hr', board: 'ashby', rankedBy: 'ai', link: boardUrl(board('Vectorline')) + '?demo=2', source: 'boards', ...ML },
    { company: 'Kestrel', title: 'Deep Learning Inference Intern – Summer 2027', location: 'Santa Clara, CA', postedAt: iso(-2), score: 84, reason: 'TensorRT and kernel work match your CUDA projects; asks for C++ you already list.', pay: '', board: 'workday', rankedBy: 'ai', link: boardUrl(board('Kestrel')) + '?demo=7', source: 'workday', ...ML },
    { company: 'Halcyon', title: 'Compiler Engineering Intern', location: 'Sunnyvale, CA or remote', postedAt: iso(-11), score: 78, reason: 'Compiler work overlaps your MLIR coursework; the posting asks for C++ depth you may want to show.', pay: '', board: 'ashby', rankedBy: 'ai', link: boardUrl(board('Halcyon')) + '?demo=3', source: 'boards', ...ML },
    { company: 'Prismatic Optics', title: 'Optical Test Engineering Intern', location: 'San Jose, CA', postedAt: iso(-8), score: 76, reason: 'Laser and fiber test work fits your photonics lab bench experience.', pay: '', board: 'workday', rankedBy: 'ai', link: boardUrl(board('Prismatic Optics')) + '?demo=8', source: 'simplify', ...PHOTONICS },
    { company: 'Northwind AI', title: 'Northwind AI Fellows Program, ML Systems', location: 'San Francisco, CA; London, UK', postedAt: iso(-20), score: 72, reason: 'Strong ML systems fit, though fellows are typically further along than an undergraduate intern.', pay: '', board: 'greenhouse', rankedBy: 'ai', link: boardUrl(board('Northwind AI')) + '?demo=4', source: 'boards', ...ML },
    { company: 'Quanta Optics Lab', title: 'Photonic Device Test Intern', location: 'Palo Alto, CA', postedAt: iso(-29), score: 64, reason: 'Hands-on photonics testing; less software than your other targets.', pay: '$40–48/hr', board: 'greenhouse', rankedBy: 'ai', link: boardUrl(board('Quanta Optics Lab')) + '?demo=5', source: 'boards', ...PHOTONICS },
    { company: 'Quanta Computing', title: 'Quantum Hardware Intern', location: 'Berkeley, CA', postedAt: iso(-41), score: 55, reason: 'Adjacent hardware role; worth a look if you want to widen beyond AI accelerators.', pay: '', board: 'lever', rankedBy: 'ai', link: boardUrl(board('Quanta Computing')) + '?demo=6', source: 'boards', ...PHOTONICS },
  ])
  // Last checks for Settings > Job boards: most boards fine, one failing.
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)
  recordReads(settings, pick.map((name) => ({ key: boardKey(board(name)), ok: true, error: '' })), hoursAgo(28))
  recordReads(
    settings,
    pick.map((name) => ({ key: boardKey(board(name)), ok: name !== 'Quanta Computing', error: name === 'Quanta Computing' ? 'api.lever.co took too long to answer.' : '' })),
    hoursAgo(3),
  )
  saveLastScan(settings, { at: hoursAgo(3).toISOString(), ok: true, summary: 'Found 8 roles across 7 companies.', scheduled: false })
}
