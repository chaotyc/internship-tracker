import { useEffect, useState } from 'react'
import { defaultTrack, type ApplicationTrack } from '@shared/profile'
import { api } from '@renderer/lib/api'

// TODO(tracks feature): refine. Lists the profile's tracks; hidden while there is only the default one.
export function TrackSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [tracks, setTracks] = useState<ApplicationTrack[]>([])
  useEffect(() => {
    const load = () => api.invoke('profile:get').then((p) => setTracks(p.tracks.length ? p.tracks : [defaultTrack(p)]))
    void load()
    return api.on('profile:changed', () => void load())
  }, [])
  if (tracks.length < 2) return null
  return (
    <label className="field">
      <span>Application track</span>
      <select value={value || tracks[0]!.id} onChange={(e) => onChange(e.target.value)}>
        {tracks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  )
}
