import { expect, test } from 'claude-code/testing'

import { DEFAULTS, loadSettings, toggleSetting } from './settings'

test('absent store keys fall back to the defaults (show-time on, open-on-start off)', () => {
  expect(loadSettings(() => undefined)).toEqual({ showTime: true, openByDefault: false })
  expect(DEFAULTS).toEqual({ showTime: true, openByDefault: false })
})

test('stored booleans override the defaults, one key per setting', () => {
  const store: Record<string, unknown> = { showTime: false, openByDefault: true }
  expect(loadSettings(k => store[k])).toEqual({ showTime: false, openByDefault: true })
  expect(loadSettings(k => (k === 'openByDefault' ? true : undefined))).toEqual({ showTime: true, openByDefault: true })
})

test('a non-boolean stored value is ignored', () => {
  expect(loadSettings(() => 'false')).toEqual(DEFAULTS)
})

test('toggleSetting flips one key and returns a new object', () => {
  const s = { showTime: true, openByDefault: false }
  const t = toggleSetting(s, 'showTime')
  expect(t).toEqual({ showTime: false, openByDefault: false })
  expect(s.showTime).toBe(true)
  expect(toggleSetting(t, 'showTime')).toEqual(s)
})
