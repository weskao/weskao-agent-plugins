import { expect, test } from 'claude-code/testing'

import { DEFAULTS, KEYS, LABELS, loadSettings, toggleSetting } from './settings'

test('absent store keys fall back to the defaults (every setting on)', () => {
  expect(loadSettings(() => undefined)).toEqual({ showTime: true, showTokens: true, openByDefault: true })
  expect(DEFAULTS).toEqual({ showTime: true, showTokens: true, openByDefault: true })
})

test('stored booleans override the defaults, one key per setting', () => {
  const store: Record<string, unknown> = { showTime: false, showTokens: false, openByDefault: false }
  expect(loadSettings(k => store[k])).toEqual({ showTime: false, showTokens: false, openByDefault: false })
  expect(loadSettings(k => (k === 'openByDefault' ? false : undefined))).toEqual({ showTime: true, showTokens: true, openByDefault: false })
})

test('a non-boolean stored value is ignored', () => {
  expect(loadSettings(() => 'false')).toEqual(DEFAULTS)
})

test('every popover item is labelled with a capital first letter, in drawing order', () => {
  expect(KEYS).toEqual(['openByDefault', 'showTime', 'showTokens'])
  for (const k of KEYS) expect(LABELS[k][0]).toBe(LABELS[k][0].toUpperCase())
})

test('toggleSetting flips one key and returns a new object', () => {
  const s = { showTime: true, showTokens: true, openByDefault: false }
  const t = toggleSetting(s, 'showTime')
  expect(t).toEqual({ showTime: false, showTokens: true, openByDefault: false })
  expect(s.showTime).toBe(true)
  expect(toggleSetting(t, 'showTime')).toEqual(s)
})
