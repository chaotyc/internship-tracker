import { describe, expect, it } from 'vitest'
import { JSON_INSTRUCTION, LineSplitter, extractJson, systemFor, transcript } from './text'

describe('extractJson', () => {
  it('parses a bare reply', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('  [1, 2]\n')).toEqual([1, 2])
    expect(extractJson('"just a string"')).toBe('just a string')
  })

  it('reads a ```json fence', () => {
    expect(extractJson('Here you go:\n```json\n{"roles": ["a", "b"]}\n```\nAnything else?')).toEqual({ roles: ['a', 'b'] })
    expect(extractJson('```\n[{"x": true}]\n```')).toEqual([{ x: true }])
  })

  it('falls back to the first { or [ through the last } or ]', () => {
    expect(extractJson('Sure! {"fit": "Strong", "tags": [1]} Hope that helps.')).toEqual({ fit: 'Strong', tags: [1] })
    expect(extractJson('Result: [{"a": {"b": 2}}] done')).toEqual([{ a: { b: 2 } }])
  })

  it('prefers the outer value when an array sits inside an object', () => {
    expect(extractJson('ok {"list": [1, 2, 3]} ok')).toEqual({ list: [1, 2, 3] })
  })

  it('throws a readable error otherwise', () => {
    expect(() => extractJson('I could not find any roles.')).toThrow(/wasn't valid JSON.*I could not find/)
    expect(() => extractJson('{"a": ')).toThrow(/wasn't valid JSON/)
    expect(() => extractJson('   ')).toThrow(/empty reply/)
  })
})

describe('prompts', () => {
  it('adds the JSON instruction to the system prompt only when asked', () => {
    expect(systemFor({ messages: [], system: 'Be kind.' })).toBe('Be kind.')
    expect(systemFor({ messages: [], system: 'Be kind.', json: true })).toBe(`Be kind.\n\n${JSON_INSTRUCTION}`)
    expect(systemFor({ messages: [], json: true })).toBe(JSON_INSTRUCTION)
  })

  it('passes a single user message through and labels longer conversations', () => {
    expect(transcript([{ role: 'user', content: 'Hi' }])).toBe('Hi')
    const t = transcript([
      { role: 'user', content: 'My name is Sam.' },
      { role: 'assistant', content: 'Hi Sam!' },
      { role: 'user', content: 'What is my name?' },
    ])
    expect(t).toContain('<user>\nMy name is Sam.\n</user>')
    expect(t).toContain('<assistant>\nHi Sam!\n</assistant>')
    expect(t.trim().endsWith('</user>')).toBe(true)
  })
})

describe('LineSplitter', () => {
  it('keeps partial lines until they complete', () => {
    const s = new LineSplitter()
    expect(s.push('{"a":')).toEqual([])
    expect(s.push('1}\r\n{"b"')).toEqual(['{"a":1}'])
    expect(s.push(':2}\n')).toEqual(['{"b":2}'])
    expect(s.push('tail')).toEqual([])
    expect(s.flush()).toEqual(['tail'])
  })
})
