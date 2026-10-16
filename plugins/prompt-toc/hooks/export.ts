import type { TocEntry } from '../types'
import { fmt } from './shared/fmt'

// The TOC as a Markdown outline: a prompt is a numbered item, a heading a bullet nested under its prompt (indent = the prompt marker's width + 2 per extra level), a
// /compact divider a rule. Prompt numbers run on across a divider.
export const toMarkdown = (entries: readonly TocEntry[], opts: { title?: string } = {}) => {
  const out: string[] = opts.title ? [`# ${opts.title}`, ''] : []
  let n = 0
  for (const e of entries) {
    if (e.divider) {
      out.push('', '---', '')
      continue
    }
    const time = e.ts === undefined ? '' : ` \`${fmt(e.ts)}\``
    const text = e.text.replace(/\s*\n\s*/g, ' ')
    out.push(e.level === 0 ? `${++n}. ${text}${time}` : `${' '.repeat(String(n).length + 2 * e.level)}- ${text}${time}`)
  }
  return out.join('\n') + '\n'
}
