// generated from mods/_shared/fmt.test.ts by mods/_shared/sync.py: edit the source there, then run it
import { expect, test } from 'claude-code/testing'

import { fmt } from './fmt'

// local-time clock, so expectations are built from local Date fields, never a fixed literal
test('formats ms as zero-padded local HH:MM:SS', () => {
  const at = new Date(2026, 0, 2, 3, 4, 5).getTime()
  expect(fmt(at)).toBe('03:04:05')
  expect(fmt(new Date(2026, 0, 2, 23, 59, 59).getTime())).toBe('23:59:59')
})
