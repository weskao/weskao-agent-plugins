import type { TocEntry } from '../types'

// The one derived visible list: keyword (case-insensitive) keeps each match plus its parent prompt (the nearest
// level-0 row before it, within the same /compact span); promptsOnly then drops every reply heading, so a heading
// match shows as its parent prompt alone. A divider always survives.
export const view = (list: readonly TocEntry[], opts: { promptsOnly?: boolean; keyword?: string }) => {
  const kw = (opts.keyword ?? '').trim().toLowerCase()
  const hit = (e: TocEntry) => !kw || e.text.toLowerCase().includes(kw)
  const keep = new Set<TocEntry>()
  let parent: TocEntry | undefined
  for (const e of list) {
    if (e.divider) parent = undefined
    else if (e.level === 0) parent = e
    if (e.divider || !hit(e)) continue
    keep.add(e)
    if (parent) keep.add(parent)
  }
  return list.filter(e => e.divider || (keep.has(e) && !(opts.promptsOnly && e.level > 0)))
}
