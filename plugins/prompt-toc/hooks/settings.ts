import type { Settings } from '../types'
export type { Settings }

// the settings popover's items, top to bottom. Each key is also its userConfig field (the /config row) and every one
// starts on; a Record, so a setting added to the Settings type without an item here fails to compile
export const LABELS: Record<keyof Settings, string> = {
  openByDefault: 'Open pane on start',
  showTime: 'Show time',
}
export const KEYS = Object.keys(LABELS) as (keyof Settings)[]

const fill = (value: (k: keyof Settings) => boolean) => Object.fromEntries(KEYS.map(k => [k, value(k)])) as Settings

export const DEFAULTS: Settings = fill(() => true)

export const loadSettings = (get: (key: string) => unknown): Settings =>
  fill(k => {
    const v = get(k)
    return typeof v === 'boolean' ? v : DEFAULTS[k]
  })

export const toggleSetting = (s: Settings, key: keyof Settings): Settings => ({ ...s, [key]: !s[key] })
