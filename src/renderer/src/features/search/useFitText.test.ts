import { describe, expect, it } from 'vitest'
import { partCandidates, wordCandidates } from './useFitText'

describe('fit candidates', () => {
  it('drops trailing parts whole, pay first', () => {
    expect(partCandidates(['6d ago', 'San Jose, CA', null, '$50–60/hr'])).toEqual([
      '6d ago · San Jose, CA · $50–60/hr',
      '6d ago · San Jose, CA',
      '6d ago',
    ])
  })

  it('cuts after whole words and never leaves a dangling separator', () => {
    expect(wordCandidates('lab work, and it is for Summer 2027')).toEqual([
      'lab work, and it is for Summer 2027',
      'lab work, and it is for Summer…',
      'lab work, and it is for…',
      'lab work, and it is…',
      'lab work, and it…',
      'lab work, and…',
      'lab work…',
      'lab…',
    ])
  })
})
