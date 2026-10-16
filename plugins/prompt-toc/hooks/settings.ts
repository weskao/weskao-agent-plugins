import type { Settings } from '../types'
export type { Settings }

export const DEFAULTS: Settings = { showTime: true, openByDefault: false }

// userConfig field name of each setting
export const KEYS: Record<keyof Settings, string> = { showTime: 'showTime', openByDefault: 'openByDefault' }

export const loadSettings = (get: (key: string) => unknown): Settings => {
  const read = (k: keyof Settings) => {
    const v = get(KEYS[k])
    return typeof v === 'boolean' ? v : DEFAULTS[k]
  }
  return { showTime: read('showTime'), openByDefault: read('openByDefault') }
}

export const toggleSetting = (s: Settings, key: keyof Settings): Settings => ({ ...s, [key]: !s[key] })
