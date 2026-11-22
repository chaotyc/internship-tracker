import { describe, expect, it } from 'vitest'
import { ADAPTERS } from './boards'
import { installAgent } from './page'

describe('page agent', () => {
  it('serializes to self-contained code for every board', () => {
    for (const a of Object.values(ADAPTERS)) {
      const code = installAgent(a.dialect)
      // Parses as a script; it would throw a SyntaxError if a function didn't survive toString().
      expect(() => new Function(code), a.board).not.toThrow()
      expect(code).toContain('__trackerAutofill')
    }
  })

  it('never contains a submit call', () => {
    for (const a of Object.values(ADAPTERS)) expect(installAgent(a.dialect)).not.toMatch(/\.submit\(|requestSubmit/)
  })
})
