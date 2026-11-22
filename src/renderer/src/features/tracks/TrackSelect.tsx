import { useEffect, useId, useState } from 'react'
import { profileTracks, resumeForTrack, trackById, type Profile } from '@shared/profile'
import { api } from '@renderer/lib/api'
import './tracks.css'

/**
 * Picks the application track (resume + answers) for a role. Hidden while the
 * user has a single track. Shows which resume file the role will use.
 */
export function TrackSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
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
  // The resume rides on the label line, so this cell is exactly as tall as its neighbors.
  return (
    <div className="field">
      <div className="trk-select-head">
        <label htmlFor={id}>Application track</label>
        <span id={`${id}-d`} className={`trk-select-resume${resume ? '' : ' is-empty'}`} title={description}>
          <span className="visually-hidden">{description}</span>
          {resume ? <MiddleTruncate text={resume.fileName} /> : <span aria-hidden="true">No resume</span>}
        </span>
      </div>
      <select id={id} value={current.id} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-d`}>
        {tracks.map((t, i) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {i === 0 ? ' (default)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

/** One line that keeps the start and the extension: "Alex_Rivera_Re…sume.pdf". */
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
