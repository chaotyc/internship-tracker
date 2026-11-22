import { describe, expect, it } from 'vitest'
import { htmlToText } from './html'
import { requirementsExcerpt } from './requirements'

const ABOUT = 'At Acme, we build photonic interconnects for AI datacenters. Our mission is to make compute faster. '.repeat(8)

describe('requirementsExcerpt', () => {
  it('starts at the Qualifications heading and stops at benefits', () => {
    const text = htmlToText(
      `<p>${ABOUT}</p><h3>What you'll do</h3><ul><li>Test lasers</li></ul>` +
        `<h3>Minimum Qualifications</h3><ul><li>Pursuing a BS/MS in EE or Physics</li><li>Lab experience with fiber optics</li></ul>` +
        `<h3>Preferred Qualifications</h3><ul><li>Python for instrument control</li></ul>` +
        `<h3>Benefits</h3><p>Free lunch and great insurance for everyone who joins.</p>`,
    )
    const out = requirementsExcerpt(text)
    expect(out.startsWith('Minimum Qualifications')).toBe(true)
    expect(out).toContain('fiber optics')
    expect(out).toContain('Python for instrument control')
    expect(out).not.toContain('Free lunch')
    expect(out).not.toContain('Our mission')
  })

  it("knows other headings like What you'll bring and About you", () => {
    expect(requirementsExcerpt(`${ABOUT}\nWhat you’ll bring:\n• CUDA and C++ for GPU kernels in production or research\n• Comfort with PyTorch internals`)).toMatch(/^What you’ll bring:/)
    expect(requirementsExcerpt(`${ABOUT}\nAbout you\n• You have shipped Verilog designs to silicon in a class or a job.`)).toMatch(/^About you/)
  })

  it('without a requirements heading, skips the company blurb and starts at the role', () => {
    const text = `${ABOUT}\nAbout the role\nYou will characterize silicon photonics modulators and write test automation in Python.`
    expect(requirementsExcerpt(text)).toMatch(/^About the role\nYou will characterize/)
    const plain = `At Acme, we build things.\nWe're on a mission to help.\nYou will design analog front ends and validate them on the bench.`
    expect(requirementsExcerpt(plain)).toMatch(/^You will design analog/)
  })

  it('is about 1500 characters and ends on a word', () => {
    const long = `Requirements\n${'• Strong background in digital design and verification. '.repeat(80)}`
    const out = requirementsExcerpt(long)
    expect(out.length).toBeLessThanOrEqual(1501)
    expect(out.length).toBeGreaterThan(1400)
    expect(out.endsWith('…')).toBe(true)
    expect(requirementsExcerpt('')).toBe('')
    expect(requirementsExcerpt('Short posting.')).toBe('Short posting.')
  })
})
