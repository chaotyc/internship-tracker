import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { RESUME_EXTENSIONS, RESUME_MAX_BYTES, type ResumeImport, type StoredResume } from '@shared/profile'

export const NO_TEXT_WARNING =
  'No text found; it may be a scanned image. The file is saved and can still be attached to applications, but the assistant and autofill can’t read it. Exporting a text-based PDF or a Word file fixes this.'

/** Thrown for files we refuse outright. `message` is shown to the user. */
export class ResumeError extends Error {}

type Ext = (typeof RESUME_EXTENSIONS)[number]

function extOf(fileName: string): Ext {
  const ext = extname(fileName).slice(1).toLowerCase()
  if ((RESUME_EXTENSIONS as readonly string[]).includes(ext)) return ext as Ext
  if (ext === 'doc') throw new ResumeError('Older .doc files aren’t supported. Save it as .docx or PDF and try again.')
  throw new ResumeError('Choose a PDF, Word (.docx), text or Markdown file.')
}

/** Tidies extracted text: unified newlines, no trailing spaces, at most one blank line in a row. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function pdfText(data: Uint8Array): Promise<string> {
  // unpdf is ESM-only; a dynamic import keeps the CommonJS main bundle happy.
  const { extractText, getDocumentProxy } = await import('unpdf')
  let doc
  try {
    // pdf.js may transfer (detach) the buffer it's given, so hand it a copy.
    doc = await getDocumentProxy(new Uint8Array(data))
  } catch (err) {
    const name = (err as { name?: string }).name ?? ''
    if (name === 'PasswordException' || /password/i.test(String(err)))
      throw new ResumeError('This PDF is password-protected. Remove the password (or print it to a new PDF) and import it again.')
    throw new ResumeError('This PDF couldn’t be opened. It may be damaged; try exporting it again.')
  }
  try {
    const { text } = await extractText(doc, { mergePages: true })
    return text
  } finally {
    // destroy() exists at runtime but is missing from the bundled types.
    void (doc as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => {})
  }
}

async function docxText(data: Uint8Array): Promise<string> {
  const mod = await import('mammoth')
  // CommonJS package: depending on the loader, its API is on the namespace or on `default`.
  const mammoth = mod.default ?? mod
  try {
    const res = await mammoth.extractRawText({ buffer: Buffer.from(data) })
    return res.value
  } catch {
    throw new ResumeError('This Word file couldn’t be read. Open it in Word or Pages and save it again as .docx.')
  }
}

/** Plain text from a resume file. `warning` is set when the file is fine but has no readable text. */
export async function extractResumeText(data: Uint8Array, fileName: string): Promise<{ text: string; warning: string | null }> {
  const ext = extOf(fileName)
  let raw: string
  if (ext === 'pdf') raw = await pdfText(data)
  else if (ext === 'docx') raw = await docxText(data)
  else raw = new TextDecoder('utf-8').decode(data).replace(/^﻿/, '')
  const text = tidyText(raw)
  if (text) return { text, warning: null }
  return { text: '', warning: ext === 'pdf' ? NO_TEXT_WARNING : 'This file is empty, so there’s no text for the assistant or autofill to use.' }
}

/** Safe file name for our copy: keeps the user's name (applications show it) minus path tricks. */
export function safeFileName(fileName: string): string {
  const base = basename(fileName.replace(/\\/g, '/'))
  const clean = base.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/^\.+/, '').trim()
  return clean || `resume.${extOf(fileName)}`
}

/** Writes our copy, replacing whatever was in the folder before. Returns its path. */
export function storeResumeCopy(dir: string, fileName: string, data: Uint8Array): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true, recursive: true })
  const path = join(dir, safeFileName(fileName))
  writeFileSync(path, data, { mode: 0o600 })
  return path
}

export function clearResumeFolder(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/** Validates, extracts, copies and records a resume. Nothing is changed if extraction throws. */
export async function importResume(
  target: { setResume(r: StoredResume | null): ResumeImport['profile'] },
  dir: string,
  fileName: string,
  data: Uint8Array,
): Promise<ResumeImport> {
  if (!data.byteLength) throw new ResumeError('That file is empty.')
  if (data.byteLength > RESUME_MAX_BYTES) throw new ResumeError('That file is over 15 MB. Resumes are usually well under 1 MB; try exporting it again.')
  const { text, warning } = await extractResumeText(data, fileName)
  const storedPath = storeResumeCopy(dir, fileName, data)
  const profile = target.setResume({ fileName: safeFileName(fileName), storedPath, text, updatedAt: new Date().toISOString() })
  return { profile, warning }
}
