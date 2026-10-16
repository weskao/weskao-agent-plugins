// The pane draws its own window over its rows, so the toolbar above them never moves: `heights` are the rows each item
// takes (the entries, then the footer), `first` the index of the topmost item shown, `budget` the rows under the
// fixed header. Whole items only.
// shortcut: the window moves in whole entries, so a wheel tick over a long wrapped label skips all its rows; scroll by
// row inside an entry if that reads badly

// terminal cells a label takes: East Asian wide characters count two
// shortcut: emoji and combining marks count one, so a wrap estimate can run a row short; use a real width table if that shows
export const cellsOf = (ch: string) => (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1)
export const cells = (text: string) => [...text].reduce((w, ch) => w + cellsOf(ch), 0)

// rows a label takes wrapped at `width` cells, as the terminal's word wrap lays it: a word that does not fit the row
// starts the next one, a word wider than a row breaks by character, a wide character never straddles a row end. Errs
// a row high, never low: a row too few would clip the window's last entry out of reach
export const wrappedRows = (text: string, width: number) => {
  let rows = 1
  let used = 0
  for (const word of text.split(' ')) {
    const w = cells(word)
    const gap = used > 0 ? 1 : 0
    if (used + gap + w <= width) {
      used += gap + w
      continue
    }
    if (used > 0) rows++
    used = 0
    if (w <= width) {
      used = w
      continue
    }
    for (const ch of word) {
      if (used + cellsOf(ch) > width) {
        rows++
        used = 0
      }
      used += cellsOf(ch)
    }
  }
  return rows
}

// one past the last item shown from `first`: as many as fit the budget, at least one
export const fit = (heights: readonly number[], first: number, budget: number) => {
  let end = first
  let used = 0
  while (end < heights.length && (end === first || used + (heights[end] ?? 0) <= budget)) used += heights[end++] ?? 0
  return end
}

// the first item of the window that ends on the last item: scrolling stops there, never past the end into blank rows
export const lastFirst = (heights: readonly number[], budget: number) => {
  let first = heights.length
  let used = 0
  while (first > 0 && (first === heights.length || used + (heights[first - 1] ?? 0) <= budget)) used += heights[--first] ?? 0
  return first
}

export const clamp = (first: number, heights: readonly number[], budget: number) => Math.max(0, Math.min(first, lastFirst(heights, budget)))

// the window moved `by` rows (signed, negative toward the top): by the whole items that fit in |by| rows, at least
// one, and at most a window's worth, so a page key shows the next page with nothing skipped
export const step = (heights: readonly number[], first: number, by: number, budget: number) => {
  let at = clamp(first, heights, budget)
  if (!by) return at
  const target = Math.min(Math.abs(by), budget)
  let covered = 0
  let moved = 0
  if (by > 0) {
    while (at < heights.length && (moved === 0 || covered + (heights[at] ?? 0) <= target)) {
      covered += heights[at++] ?? 0
      moved++
    }
  } else {
    while (at > 0 && (moved === 0 || covered + (heights[at - 1] ?? 0) <= target)) {
      covered += heights[--at] ?? 0
      moved++
    }
  }
  return clamp(at, heights, budget)
}

// shortcut: a crowded wheel sum that equals contentRows reads as Home / End, and a tree that fills the body makes
// End page instead; tell them apart by the key if the engine ever says which
// Home / End: the engine asks for the tree's whole height (`contentRows`); a page key asks for `bodyRows`, which the
// pane's own tree (kept a row short of the window) never reaches, so the two tell apart
export const isEdge = (by: number, bodyRows: number, contentRows: number) => by !== 0 && Math.abs(by) === contentRows && contentRows !== bodyRows
