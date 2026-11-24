import { describe, expect, it } from 'vitest'
import { degreeLevelOf } from '@shared/profile'
import { ineligibleReason, requiredDegree } from './eligibility'

const post = (description: string, title = 'Research Intern') => ({ title, description })
const level = (description: string, title?: string) => requiredDegree(post(description, title))?.level ?? null

describe('requiredDegree', () => {
  it('finds postings limited to PhD or graduate students', () => {
    expect(level('Minimum qualifications:\n- Currently enrolled in a PhD program in Computer Science or a related field.')).toBe('phd')
    expect(level('You are currently pursuing a Ph.D. in Electrical Engineering.')).toBe('phd')
    expect(level('Must be a current doctoral student.')).toBe('phd')
    expect(level('Currently pursuing a Master’s or PhD degree in EE.')).toBe('masters')
    expect(level('Open to MS/PhD students only.')).toBe('masters')
    expect(level('Graduate students in physics or optics.')).toBe('masters')
    expect(level('', 'PhD Research Intern, Machine Learning')).toBe('phd')
    expect(level('', 'Research Intern (MS/PhD)')).toBe('masters')
    expect(level('PhD in Physics, Electrical Engineering or a related field.')).toBe('phd')
  })

  it('keeps postings that take bachelor’s students', () => {
    expect(level('Currently pursuing a BS, MS or PhD in Computer Science.')).toBe('bachelors')
    expect(level('Pursuing a Bachelor’s, Master’s, or PhD degree.')).toBe('bachelors')
    expect(level('Undergraduate or graduate students in engineering.')).toBe('bachelors')
    expect(level('', 'Software Engineering Intern (BS/MS)')).toBe('bachelors')
    // One sentence that welcomes undergraduates is enough.
    expect(level('Currently pursuing a PhD in ML.\nWe also welcome exceptional undergraduate students.')).toBe('bachelors')
  })

  it('ignores preferred degrees, team descriptions and unrelated MS', () => {
    expect(level('PhD preferred.')).toBeNull()
    expect(level('Nice to have: a Master’s degree in EE.')).toBeNull()
    expect(level('You will work alongside world-class PhDs and engineers.')).toBeNull()
    expect(level('Experience with MS Office and Excel.')).toBeNull()
    expect(level('Strong C++ and CUDA skills.')).toBeNull()
  })

  it('treats "or equivalent experience" as no degree requirement', () => {
    expect(level("Master's degree in Computer Science or equivalent practical experience.")).toBeNull()
  })
})

describe('ineligibleReason', () => {
  const phdOnly = post('Requirements:\n- Currently pursuing a PhD in Computer Science.')
  it('rules out higher-degree postings, quoting the requirement', () => {
    expect(ineligibleReason(phdOnly, 'bachelors')).toBe('Asks for at least a PhD: “Currently pursuing a PhD in Computer Science.”')
    expect(ineligibleReason(phdOnly, 'masters')).toMatch(/at least a PhD/)
  })
  it('keeps postings the applicant qualifies for, and everything when the level is unknown', () => {
    expect(ineligibleReason(phdOnly, 'phd')).toBeNull()
    expect(ineligibleReason(phdOnly, null)).toBeNull()
    expect(ineligibleReason(post('Pursuing a BS, MS or PhD.'), 'bachelors')).toBeNull()
  })
})

describe('requiredDegree false positives', () => {
  it('does not read "mastery", "Scrum Master" or "master data" as a master’s degree', () => {
    expect(level('Demonstrated mastery of C++ is required.')).toBeNull()
    expect(level('Experience with master data management is required.')).toBeNull()
    expect(level('Must have worked as a Scrum Master on a student team.')).toBeNull()
    expect(level('Master of Science in EE required.')).toBe('masters')
  })
  it('does not read milliseconds as an MS', () => {
    expect(level('Required: keep p99 latency under 5 ms and memory flat.')).toBeNull()
  })
  it('keeps "Ph.D. or M.S." in one sentence', () => {
    expect(level('Currently pursuing a Ph.D. or M.S. in Electrical Engineering.')).toBe('masters')
  })
  it('ignores degrees that describe the team rather than the applicant', () => {
    expect(level('You will be mentored by PhD researchers in our residency program.')).toBeNull()
    expect(level('Collaborate with PhD scientists in physics and optics.')).toBeNull()
    // …unless the sentence also states a requirement outright.
    expect(level('Open only to PhD students; you will work with PhD researchers.')).toBe('phd')
  })
})

describe('requiredDegree hedges', () => {
  it('ignores degrees only some projects need', () => {
    expect(level('Some projects will require experience in managing research projects (Honours, Masters or PhD level).')).toBeNull()
  })
  it('treats "an equivalent track record" like equivalent experience', () => {
    expect(level('You are pursuing or have completed a PhD in CS (we also encourage researchers with an equivalent track record to apply!)')).toBeNull()
  })
  it('counts an honours degree as a bachelor’s', () => {
    expect(level('Currently enrolled in an Honours degree, Masters or PhD in Physics.')).toBe('bachelors')
  })
})

describe('degreeLevelOf (the applicant side)', () => {
  it('reads engineering and Canadian degree names', () => {
    for (const d of ['MSE', 'M.S.E.', 'MASc', 'MCS', 'S.M.']) expect(degreeLevelOf(d), d).toBe('masters')
    for (const d of ['BSE', 'B.S.E.', 'BASc', 'S.B.', 'B.S. in Mathematics']) expect(degreeLevelOf(d), d).toBe('bachelors')
    expect(degreeLevelOf('Mathematics')).toBeNull()
  })
})
