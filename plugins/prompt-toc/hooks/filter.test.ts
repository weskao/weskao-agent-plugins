import { expect, test } from 'claude-code/testing'

import type { TocEntry } from '../types'
import { view } from './filter'

const p = (id: string, text: string): TocEntry => ({ id, level: 0, text })
const h = (id: string, text: string, level = 1): TocEntry => ({ id, level, text })
const div: TocEntry = { id: 'd', level: 0, text: '', divider: true }
const ids = (l: TocEntry[]) => l.map(e => e.id)

const list = [p('p1', 'Plan the trip'), h('h1', 'Flights'), h('h2', 'Hotels', 2), div, p('p2', 'Write tests'), h('h3', 'Flights again')]

test('no filters returns everything', () => {
  expect(ids(view(list, {}))).toEqual(ids(list))
})

test('keyword is case-insensitive and keeps the match with its parent prompt', () => {
  expect(ids(view(list, { keyword: 'HOTELS' }))).toEqual(['p1', 'h2', 'd'])
  expect(ids(view(list, { keyword: 'flights' }))).toEqual(['p1', 'h1', 'd', 'p2', 'h3'])
})

test('a prompt match does not pull in its headings', () => {
  expect(ids(view(list, { keyword: 'write' }))).toEqual(['d', 'p2'])
})

test('promptsOnly keeps level-0 rows; a heading match still keeps its parent prompt', () => {
  expect(ids(view(list, { promptsOnly: true }))).toEqual(['p1', 'd', 'p2'])
  expect(ids(view(list, { promptsOnly: true, keyword: 'hotels' }))).toEqual(['p1', 'd'])
})

test('a heading after a divider does not attach to a prompt before it', () => {
  const l = [p('p1', 'One'), div, h('h1', 'Orphan')]
  expect(ids(view(l, { keyword: 'orphan' }))).toEqual(['d', 'h1'])
})

test('dividers survive even when nothing matches', () => {
  expect(ids(view(list, { keyword: 'zzz' }))).toEqual(['d'])
})
