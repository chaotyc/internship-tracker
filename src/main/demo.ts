import type { RolesService } from './features/roles/service'
import type { RoleInput } from '@shared/roles'

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

/** Sample board for screenshots and first looks. Only loaded with TRACKER_DEMO=1, into a throwaway database. */
export function seedDemo(roles: RolesService): void {
  const rows: RoleInput[] = [
    { company: 'Northwind AI', title: 'Software Engineer Intern, Inference', stage: 'saved', fit: 'Strong', location: 'San Francisco, CA', pay: '$60–70/hr', deadline: iso(4), source: 'autosearch' },
    { company: 'Kestrel', title: 'AI Compiler and Kernel Intern', stage: 'saved', fit: 'Strong', location: 'Austin, TX or remote', pay: '$20–94/hr', deadline: iso(19) },
    { company: 'Lumora Photonics', title: 'Photonics Engineer Intern', stage: 'saved', fit: 'Good', location: 'Mountain View, CA', pay: '$57–65/hr' },
    { company: 'Brightline Data', title: 'Software Engineering Intern', stage: 'saved', fit: 'Moderate', location: 'San Francisco, CA', pay: '$40–60/hr', liveness: { status: 'closed', checkedAt: new Date().toISOString(), detail: 'The job board no longer lists this posting.' } },
    { company: 'Halcyon', title: 'Inference Software Intern', stage: 'saved', fit: 'Good', location: 'Sunnyvale, CA', source: 'autosearch' },
    { company: 'Prism Labs', title: 'Optical I/O Intern', stage: 'saved', fit: 'Strong', location: 'San Jose, CA', pay: '$44–55/hr', liveness: { status: 'expiring', checkedAt: new Date().toISOString(), detail: 'Posted 7 weeks ago; similar roles closed at 8.' } },
    { company: 'Vectorline', title: 'Inference Intern', stage: 'applied', link: 'https://jobs.ashbyhq.com/vectorline/6f23713f-5409-45b7-aae8-adb8710cdbc3', fit: 'Strong', location: 'San Jose, CA (on-site)', appliedOn: iso(-3) },
    { company: 'Kite', title: 'Software Engineering Intern', stage: 'applied', fit: 'Moderate', location: 'Menlo Park, CA', pay: '$7.3–12.7k/mo', appliedOn: iso(-12) },
    { company: 'Tessellate', title: 'Kernels Intern', stage: 'applied', fit: 'Strong', location: 'Mountain View, CA', pay: '$13.3k/mo', appliedOn: iso(-1) },
    { company: 'Cobaltine AI', title: 'Research Intern, Inference', stage: 'interviewing', link: 'https://job-boards.greenhouse.io/cobaltineai/jobs/4188119007', fit: 'Strong', location: 'San Francisco, CA', pay: '$58–70/hr', appliedOn: iso(-21), notes: 'Inference team; ask about their serving stack' },
    { company: 'Granitecore', title: 'ML Engineer Intern', stage: 'interviewing', fit: 'Good', location: 'Santa Clara, CA', appliedOn: iso(-30), notes: 'Recruiter call went well' },
    { company: 'Meridian Compute', title: 'Engineering Intern', stage: 'offer', fit: 'Strong', location: 'Remote (US)', pay: '$55/hr', appliedOn: iso(-40), deadline: iso(9), notes: 'Ask whether they can wait for Cobaltine AI' },
    { company: 'Summit Semiconductor', title: 'ML & AI Engineering Intern', stage: 'rejected', fit: 'Moderate', location: 'San Diego, CA', appliedOn: iso(-35) },
    { company: 'Quanta Optics Lab', title: 'Residency Program 2027', stage: 'closed', fit: 'Good', location: 'Toronto, ON', postingStatus: 'Applications closed Nov 15' },
  ]
  roles.createMany(rows)
}
