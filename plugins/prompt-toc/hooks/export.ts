import type { TocEntry, Tokens } from '../types'
import { fmt } from './shared/fmt'

// 1234 → 1.2k, 12345 → 12k, millions as M
export const short = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`)
const breakdown = (t: Tokens) => ` \`in ${short(t.input)} · cache read ${short(t.cacheRead)} · cache write ${short(t.cacheWrite)} · out ${short(t.output)}\``

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
    const time = (e.ts === undefined ? '' : ` \`${fmt(e.ts)}\``) + (e.tokens ? breakdown(e.tokens) : '')
    const text = e.text.replace(/\s*\n\s*/g, ' ')
    out.push(e.level === 0 ? `${++n}. ${text}${time}` : `${' '.repeat(String(n).length + 2 * e.level)}- ${text}${time}`)
  }
  return out.join('\n') + '\n'
}
