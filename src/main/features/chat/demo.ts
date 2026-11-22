import type { ChatStore } from './store'

/** A short sample conversation for screenshots. Only used with TRACKER_DEMO=1 (in-memory database). */
export function seedDemoChat(chat: ChatStore): void {
  if (chat.last()) return
  chat.add({ role: 'user', content: 'What should I apply to this week?', roleId: null })
  chat.add({
    role: 'assistant',
    roleId: null,
    content: [
      'Three things are time-sensitive, in this order:',
      '',
      '1. **Northwind AI · Software Engineer Intern, Inference** closes in 4 days. It’s your strongest fit on the board, so send it first.',
      '2. **Prism Labs · Optical I/O Intern** looks close to closing. Apply this week or move it to Closed.',
      '3. **Meridian Compute** wants an answer on your offer within 9 days. Worth asking whether they can wait until you hear back from Cobaltine AI.',
      '',
      'Also prep for the *Cobaltine AI* technical screen on Thursday: review KV-cache batching and be ready to talk through your `vLLM` project.',
    ].join('\n'),
  })
  chat.add({
    role: 'user',
    content: 'I mostly want ML inference or compiler internships for summer 2027. Bay Area or remote, at least $45/hr.',
    roleId: null,
  })
  chat.add({
    role: 'assistant',
    roleId: null,
    content:
      'Got it: **inference and ML compiler** internships for **Summer 2027**, in the Bay Area or remote, paying at least **$45/hr**. I’ll use this when judging fit and ranking autosearch results.\n\nI’ve suggested the update below.',
    actions: [
      {
        kind: 'update_preferences',
        preferences: {
          targetRoles: ['ML inference intern', 'ML compiler intern'],
          locations: ['San Francisco Bay Area'],
          remoteOk: true,
          term: 'Summer 2027',
          minPay: '$45/hr',
        },
      },
    ],
  })
}
