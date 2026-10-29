// generated from mods/_shared/fmt.test.ts by mods/_shared/sync.py: edit the source there, then run it
import { expect, test } from 'claude-code/testing'

import { fmt } from './fmt'

// local-time clock, so expectations are built from local Date fields, never a fixed literal
test('formats ms as zero-padded local HH:MM:SS', () => {
  const at = new Date(2026, 0, 2, 3, 4, 5).getTime()
  expect(fmt(at)).toBe('03:04:05')
  expect(fmt(new Date(2026, 0, 2, 23, 59, 59).getTime())).toBe('23:59:59')
})

test('hour12 formats as zero-padded local hh:MM:SS AM/PM, midnight and noon as 12', () => {
  const at = (h: number) => new Date(2026, 0, 2, h, 4, 5).getTime()
  expect(fmt(at(0), true)).toBe('12:04:05 AM')
  expect(fmt(at(3), true)).toBe('03:04:05 AM')
  expect(fmt(at(12), true)).toBe('12:04:05 PM')
  expect(fmt(at(23), true)).toBe('11:04:05 PM')
})
