import { useEffect, useId, useState } from 'react'
import { profileTracks, resumeForTrack, trackById, type Profile } from '@shared/profile'
import { api } from '@renderer/lib/api'
import './tracks.css'

/**
 * Picks the application track (resume + answers) for a role. Hidden while the
 * user has a single track. Shows which resume file the role will use, and an
 * optional note under it (the role dialog's "save first" hint).
 */
export function TrackSelect({ value, onChange, note }: { value: string; onChange: (id: string) => void; note?: string }) {
  const id = useId()
  const [profile, setProfile] = useState<Profile | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      api
        .invoke('profile:get')
        .then((p) => live && setProfile(p))
        .catch(() => {})
    void load()
    const off = api.on('profile:changed', () => void load())
    return () => {
      live = false
      off()
    }
  }, [])
  if (!profile) return null
  const tracks = profileTracks(profile)
  if (tracks.length < 2) return null

  // '' or a deleted track means the default (first) track.
  const current = trackById(profile, value)
  const resume = resumeForTrack(profile, current.id)
  const borrowed = !current.resume && resume
  const description = resume
    ? `Resume: ${resume.fileName}${borrowed ? ' (from the default track)' : ''}`
    : 'No resume on this track yet. Add one in Settings › Application tracks.'
  // The resume sits under the select as helper text; the role dialog gives this field its own row.
  return (
    <div className="field">
      <label htmlFor={id}>Application track</label>
      <select id={id} value={current.id} onChange={(e) => onChange(e.target.value)} aria-describedby={note ? `${id}-d ${id}-n` : `${id}-d`}>
        {/* "(default)" marks the first track in the list only; the closed select shows just the name. */}
        {tracks.map((t, i) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {i === 0 && t.id !== current.id ? ' (default)' : ''}
          </option>
        ))}
      </select>
      {resume ? (
        <span id={`${id}-d`} className="hint trk-select-resume" title={description}>
          <span className="visually-hidden">{description}</span>
          <span aria-hidden="true">Resume:</span>
          <MiddleTruncate text={resume.fileName} />
          {borrowed && <span aria-hidden="true">(from the default track)</span>}
        </span>
      ) : (
        <span id={`${id}-d`} className="hint trk-select-resume is-empty">
          {description}
        </span>
      )}
      {note && (
        <span id={`${id}-n`} className="hint trk-select-note">
          {note}
        </span>
      )}
    </div>
  )
}

/** One line that keeps the start and the extension; truncates ("Alex_Rivera_Re…sume.pdf") only when it doesn't fit. */
function MiddleTruncate({ text }: { text: string }) {
  const dot = text.lastIndexOf('.')
  const keep = Math.max(dot > 0 ? text.length - dot + 2 : 6, 6)
  const cut = Math.max(text.length - keep, 0)
  return (
    <span className="trk-mid" aria-hidden="true">
      <span className="trk-mid-start">{text.slice(0, cut)}</span>
      <span className="trk-mid-end">{text.slice(cut)}</span>
    </span>
  )
}
