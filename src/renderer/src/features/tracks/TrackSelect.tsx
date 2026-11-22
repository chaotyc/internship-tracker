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
  return (
    <div className="field">
      <label htmlFor={id}>Application track</label>
      <select id={id} value={current.id} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-d`}>
        {tracks.map((t, i) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {i === 0 ? ' (default)' : ''}
          </option>
        ))}
      </select>
      <small id={`${id}-d`} className="hint trk-select-hint" title={resume?.fileName}>
        {resume ? (
          <>
            Resume: <b>{resume.fileName}</b>
            {borrowed ? ' (from the default track)' : ''}
          </>
        ) : (
          'No resume on this track yet. Add one in Settings › Application tracks.'
        )}
      </small>
    </div>
  )
}
