import { describe, expect, it } from 'vitest'
import { boardFromHtml, boardGuesses, isGreenhouseApplication, parseGreenhouseLink } from './url'

describe('parseGreenhouseLink', () => {
  it('accepts hosted postings on job-boards and the legacy boards host', () => {
    expect(parseGreenhouseLink('https://job-boards.greenhouse.io/cobaltineai/jobs/5270409007')).toEqual({
      kind: 'hosted',
      board: 'cobaltineai',
      jobId: '5270409007',
      formUrl: 'https://job-boards.greenhouse.io/cobaltineai/jobs/5270409007',
    })
    expect(parseGreenhouseLink('https://boards.greenhouse.io/figma/jobs/6233043004?gh_jid=6233043004')).toMatchObject({
      kind: 'hosted',
      board: 'figma',
      formUrl: 'https://job-boards.greenhouse.io/figma/jobs/6233043004',
    })
    expect(parseGreenhouseLink('https://job-boards.eu.greenhouse.io/acme/jobs/4400123')).toMatchObject({ kind: 'hosted', board: 'acme' })
  })

  it('accepts the embedded form and normalizes it to job-boards', () => {
    expect(parseGreenhouseLink('https://boards.greenhouse.io/embed/job_app?for=brightline&token=6866538002')).toEqual({
      kind: 'embed',
      board: 'brightline',
      jobId: '6866538002',
      formUrl: 'https://job-boards.greenhouse.io/embed/job_app?for=brightline&token=6866538002',
    })
  })

  it('accepts company pages that embed Greenhouse with gh_jid', () => {
    expect(parseGreenhouseLink('https://brightline.com/company/careers/open-positions/job?gh_jid=6866538002')).toEqual({
      kind: 'company',
      board: null,
      jobId: '6866538002',
      pageUrl: 'https://brightline.com/company/careers/open-positions/job?gh_jid=6866538002',
      boardGuesses: ['brightline'],
    })
    expect(parseGreenhouseLink('https://stripe.com/jobs/search?gh_jid=8353516')).toMatchObject({ kind: 'company', jobId: '8353516' })
  })

  it('rejects other boards, board listings and junk', () => {
    for (const url of [
      'https://jobs.ashbyhq.com/vectorline/1',
      'https://jobs.lever.co/acme/123',
      'https://job-boards.greenhouse.io/cobaltineai',
      'https://boards.greenhouse.io/embed/job_board?for=acme',
      'https://example.com/careers?gh_jid=abc',
      'javascript:alert(1)?gh_jid=1234',
      'not a url',
      '',
    ])
      expect(isGreenhouseApplication(url), url).toBe(false)
  })
})

describe('board resolution helpers', () => {
  it('guesses board tokens from a company host', () => {
    expect(boardGuesses('www.brightline.com')).toEqual(['brightline'])
    expect(boardGuesses('careers.acme-robotics.co.uk')).toEqual(['acme-robotics', 'acmerobotics'])
  })

  it('reads the board from the embed iframe or script', () => {
    expect(boardFromHtml('<iframe id="grnhse_iframe" src="https://job-boards.greenhouse.io/embed/job_app?for=stripe&amp;token=8353516"></iframe>')).toBe('stripe')
    expect(boardFromHtml('<script src="https://boards.greenhouse.io/embed/job_board/js?for=asana"></script>')).toBe('asana')
    expect(boardFromHtml('<a href="https://job-boards.greenhouse.io/discord/jobs/8945798002">Apply</a>')).toBe('discord')
    expect(boardFromHtml('<p>No embed here</p>')).toBeNull()
  })
})
