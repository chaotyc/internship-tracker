import { useCallback, useEffect, useState } from 'react'
import type { Role } from '@shared/roles'

export const api = window.api

/** Live list of roles; reloads whenever any feature changes one. */
export function useRoles() {
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    api
      .invoke('roles:list')
      .then((r) => {
        setRoles(r)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(() => {
    reload()
    return api.on('roles:changed', reload)
  }, [reload])
  return { roles, setRoles, error, reload }
}
