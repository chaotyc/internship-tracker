import type { RolesService } from './features/roles/service'
import type { RoleInput } from '@shared/roles'

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

/**
 * Sample board for screenshots and first looks. Only loaded with TRACKER_DEMO=1, into a throwaway database.
 * Every company here is made up, so there are no posting links. Installed copies start with an empty board.
 */
export function seedDemo(roles: RolesService): void {
  const rows: RoleInput[] = [
    { company: 'Northwind AI', title: 'ML Inference Intern', stage: 'saved', fit: 'Strong', location: 'San Francisco, CA', pay: '$55–65/hr', deadline: iso(4), source: 'autosearch' },
    { company: 'Kestrel Compute', title: 'GPU Compiler Intern', stage: 'saved', fit: 'Strong', location: 'Austin, TX or remote', pay: '$45–60/hr', deadline: iso(19) },
    { company: 'Lumora Photonics', title: 'Photonics Engineering Intern', stage: 'saved', fit: 'Good', location: 'Mountain View, CA', pay: '$50–58/hr' },
    { company: 'Brightline Data', title: 'Software Engineering Intern', stage: 'saved', fit: 'Moderate', location: 'San Francisco, CA', pay: '$40–55/hr', liveness: { status: 'closed', checkedAt: new Date().toISOString(), detail: 'The job board no longer lists this posting.' } },
    { company: 'Halcyon Systems', title: 'Inference Software Intern', stage: 'saved', fit: 'Good', location: 'Sunnyvale, CA', source: 'autosearch' },
    { company: 'Prismatic Optics', title: 'Optical I/O Intern', stage: 'saved', fit: 'Strong', location: 'San Jose, CA', pay: '$44–52/hr', liveness: { status: 'expiring', checkedAt: new Date().toISOString(), detail: 'Posted 7 weeks ago; similar roles closed at 8.' } },
    { company: 'Vectorline Silicon', title: 'Inference Intern', stage: 'applied', fit: 'Strong', location: 'San Jose, CA (on-site)', appliedOn: iso(-3) },
    { company: 'Orbitwise', title: 'Software Engineering Intern', stage: 'applied', fit: 'Moderate', location: 'Seattle, WA', pay: '$8–10k/mo', appliedOn: iso(-12) },
    { company: 'Tessellate Chips', title: 'Kernels Intern', stage: 'applied', fit: 'Strong', location: 'Mountain View, CA', pay: '$11k/mo', appliedOn: iso(-1) },
    { company: 'Cobaltine AI', title: 'Research Intern, Inference', stage: 'interviewing', fit: 'Strong', location: 'San Francisco, CA', pay: '$55–68/hr', appliedOn: iso(-21), notes: 'Serving team; ask about their batching work' },
    { company: 'Granite Machines', title: 'ML Engineer Intern', stage: 'interviewing', fit: 'Good', location: 'Santa Clara, CA', appliedOn: iso(-30), notes: 'Recruiter call went well' },
    { company: 'Meridian Compute', title: 'Engineering Intern', stage: 'offer', fit: 'Strong', location: 'Remote (US)', pay: '$52/hr', appliedOn: iso(-40), deadline: iso(9), notes: 'Ask whether they can wait for Cobaltine AI' },
    { company: 'Summit Semiconductor', title: 'ML Engineering Intern', stage: 'rejected', fit: 'Moderate', location: 'San Diego, CA', appliedOn: iso(-35) },
    { company: 'Quanta Optics Lab', title: 'Residency Program 2027', stage: 'closed', fit: 'Good', location: 'Toronto, ON', postingStatus: 'Applications closed Nov 15' },
  ]
  roles.createMany(rows)
}
