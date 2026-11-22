import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ backend: 'gnome_libsecret' as string }))

vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => m.backend,
    encryptStringAsync: async (s: string) => Buffer.from('E' + s),
    decryptStringAsync: async (b: Buffer) => ({ result: b.toString().slice(1), shouldReEncrypt: false }),
  },
}))

import { openStore } from './db/store'
import { insecureLinuxBackend, Secrets, secretsMigration } from './secrets'

async function loaded(): Promise<Secrets> {
  const store = await openStore(null)
  store.migrate([secretsMigration])
  const secrets = new Secrets(store)
  await secrets.load()
  return secrets
}

describe('secrets keychain detection', () => {
  beforeEach(() => {
    m.backend = 'gnome_libsecret'
  })

  it('treats the Linux basic_text fallback as no keychain', () => {
    m.backend = 'basic_text'
    expect(insecureLinuxBackend('linux')).toBe(true)
    m.backend = 'unknown'
    expect(insecureLinuxBackend('linux')).toBe(true)
  })

  it('accepts a real Linux keyring and ignores the backend on other systems', () => {
    expect(insecureLinuxBackend('linux')).toBe(false)
    m.backend = 'basic_text'
    expect(insecureLinuxBackend('darwin')).toBe(false)
    expect(insecureLinuxBackend('win32')).toBe(false)
  })

  it.runIf(process.platform === 'linux')('refuses to store secrets on Linux without a keyring', async () => {
    m.backend = 'basic_text'
    const secrets = await loaded()
    expect(secrets.available).toBe(false)
    expect(() => secrets.set('k', 'v')).toThrow()
  })

  it('stores secrets when the keychain is available', async () => {
    const secrets = await loaded()
    expect(secrets.available).toBe(true)
    secrets.set('k', 'v')
    await secrets.flush()
    expect(secrets.get('k')).toBe('v')
  })
})
