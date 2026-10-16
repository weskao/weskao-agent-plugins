import { expect, test } from 'claude-code/testing'

import type { TocEntry } from '../types'
import { toMarkdown } from './export'
import { fmt } from './shared/fmt'

const t0 = new Date(2026, 0, 2, 3, 4, 5).getTime()
const list: TocEntry[] = [
  { id: 'a', level: 0, text: 'First prompt', ts: t0 },
  { id: 'b', level: 1, text: 'Heading one' },
  { id: 'c', level: 2, text: 'Sub heading' },
  { id: 'd', level: 0, text: 'multi\nline prompt' },
  { id: 'e', level: 0, text: '', divider: true },
  { id: 'f', level: 0, text: 'After compact' },
]

test('renders a numbered, indented outline with a rule for the divider', () => {
  expect(toMarkdown(list)).toBe(
    ['1. First prompt `' + fmt(t0) + '`', '   - Heading one', '     - Sub heading', '2. multi line prompt', '', '---', '', '3. After compact', ''].join('\n'),
  )
})

test('title becomes a top heading and time is omitted when ts is absent', () => {
  const md = toMarkdown([{ id: 'a', level: 0, text: 'Hi' }], { title: 'Session' })
  expect(md).toBe('# Session\n\n1. Hi\n')
})

test('empty list gives just a newline', () => {
  expect(toMarkdown([])).toBe('\n')
})
