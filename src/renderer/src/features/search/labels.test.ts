import { describe, expect, it } from 'vitest'
import { boardFailure, fitFromScore } from './labels'

describe('fitFromScore', () => {
  it('uses the same thresholds as adding a suggestion', () => {
    expect([91, 85, 84, 70, 69, 50, 49, 0].map(fitFromScore)).toEqual(['Strong', 'Strong', 'Good', 'Good', 'Moderate', 'Moderate', 'Weak', 'Weak'])
  })
})

describe('boardFailure', () => {
  it('maps timeouts and network errors to a transient warning', () => {
    expect(boardFailure('Lever', 'api.lever.co took too long to answer.')).toEqual({ text: "Lever didn't respond", tone: 'warn' })
    expect(boardFailure('Ashby', "Couldn't reach api.ashbyhq.com.")).toEqual({ text: "Ashby didn't respond", tone: 'warn' })
  })
  it('keeps danger for a missing board', () => {
    expect(boardFailure('Greenhouse', 'boards-api.greenhouse.io answered 404.')).toEqual({ text: 'Greenhouse board not found', tone: 'danger' })
  })
  it('treats other errors as transient', () => {
    expect(boardFailure('Workday', 'acme.wd1.myworkdayjobs.com answered 503.').tone).toBe('warn')
  })
})
