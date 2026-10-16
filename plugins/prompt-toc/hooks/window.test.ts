import { expect, test } from 'claude-code/testing'
import { cells, clamp, fit, isEdge, lastFirst, step, wrappedRows } from './window'

// five one-row entries, a two-row prompt (its gap), a three-row wrapped label, and the footer's two rows
const H = [1, 2, 1, 3, 1, 2]

test('the window holds the items that fit the budget, and all of them when they fit', () => {
  expect(fit(H, 0, 100)).toBe(H.length)
  expect(fit(H, 0, 4)).toBe(3)
  expect(fit(H, 2, 4)).toBe(4)
  expect(fit(H, 2, 5)).toBe(5)
})

test('a budget smaller than one item still shows that one item', () => {
  expect(fit(H, 3, 1)).toBe(4)
  expect(fit(H, 0, 0)).toBe(1)
})

test('the last window ends on the last item, so scrolling never runs past the end', () => {
  expect(lastFirst(H, 3)).toBe(4)
  expect(lastFirst(H, 6)).toBe(3)
  expect(lastFirst(H, 100)).toBe(0)
  expect(lastFirst(H, 1)).toBe(5)
  expect(fit(H, lastFirst(H, 6), 6)).toBe(H.length)
})

test('clamp keeps the first item between the start and the last window', () => {
  expect(clamp(-3, H, 6)).toBe(0)
  expect(clamp(99, H, 6)).toBe(3)
  expect(clamp(Infinity, H, 6)).toBe(3)
  expect(clamp(2, H, 6)).toBe(2)
})

test('a step moves by the whole items that fit the rows asked, at least one', () => {
  // a wheel tick: one item either way, even a wrapped one
  expect(step(H, 0, 1, 4)).toBe(1)
  expect(step(H, 2, -1, 4)).toBe(1)
  expect(step(H, 3, 1, 4)).toBe(4)
  // three rows down from the top: items 0 and 1 (1 + 2 rows)
  expect(step(H, 0, 3, 6)).toBe(2)
  // three rows up from item 3: items 2 and 1 (1 + 2 rows)
  expect(step(H, 3, -3, 6)).toBe(1)
  // past the last window's start the step clamps back to it
  expect(step(H, 3, 1, 6)).toBe(3)
})

test('a page moves at most one window, so nothing between two pages is skipped', () => {
  // budget 4 shows items 0-2 (4 rows); a page key asks for the whole body (say 10 rows)
  expect(step(H, 0, 10, 4)).toBe(fit(H, 0, 4))
})

test('a step stops at both ends', () => {
  expect(step(H, 0, -1, 4)).toBe(0)
  expect(step(H, lastFirst(H, 4), 1, 4)).toBe(lastFirst(H, 4))
  expect(step(H, 3, -100, 4)).toBe(0)
})

test('Home and End are the whole tree, a page key the whole body', () => {
  // the pane's tree is kept a row short of the window: End asks 9 rows of a 10-row body
  expect(isEdge(9, 10, 9)).toBe(true)
  expect(isEdge(-9, 10, 9)).toBe(true)
  expect(isEdge(10, 10, 9)).toBe(false)
  expect(isEdge(1, 10, 9)).toBe(false)
  expect(isEdge(0, 10, 0)).toBe(false)
  // a tree that fills the body: a page key cannot be told from End, so it pages
  expect(isEdge(10, 10, 10)).toBe(false)
})

test('an empty list has one window, at 0', () => {
  expect(fit([], 0, 5)).toBe(0)
  expect(lastFirst([], 5)).toBe(0)
  expect(clamp(4, [], 5)).toBe(0)
  expect(step([], 0, 3, 5)).toBe(0)
  expect(step([], 0, -3, 5)).toBe(0)
})

test('a label wraps at word ends, so it can take more rows than its cells divided by the width', () => {
  const text = 'refactor authentication middleware configuration thoroughly please'
  // 66 cells over 20 would be 4 rows; words that do not fit move down whole
  expect(Math.ceil(cells(text) / 20)).toBe(4)
  expect(wrappedRows(text, 20)).toBe(5)
  expect(wrappedRows('short', 20)).toBe(1)
  expect(wrappedRows('', 20)).toBe(1)
  // a word wider than the row breaks by character
  expect(wrappedRows('x'.repeat(45), 20)).toBe(3)
})

test('a wide character never straddles a row end', () => {
  // five 2-cell characters in 5 columns: two per row, a cell left over each time
  expect(cells('一二三四五')).toBe(10)
  expect(wrappedRows('一二三四五', 5)).toBe(3)
})
