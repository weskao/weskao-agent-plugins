// generated from mods/_shared/rows.ts by mods/_shared/sync.py: edit the source there, then run it
// Which transcript rows are the person's input or a reply, and how each reads: one rule per way a row arrives.
// Pure (no `$`), so any mod can classify a `session.append` row and agree with the others on it.

// the parts of `session.append`'s input the rules read
export type AppendedRow = {
  door: string
  origin: { kind: string }
  message: { type: string; name?: string; isMeta?: true; content: readonly { type: string; text?: string }[] }
}

// prompt: typed and sent · command: a typed slash command (`/commit`, `/compact`) · local-command: a plugin or
// local command, echoed as a system row · mid-turn: sent while a turn ran · queued: waiting in the queue (no row
// of the conversation) · reply: an assistant text row
export type RowSource = 'prompt' | 'command' | 'local-command' | 'mid-turn' | 'queued' | 'reply'

// text: an input as the transcript shows it (`/name args` for a command), or a reply's whole text
export type Row = { kind: 'input' | 'reply'; source: RowSource; text: string }

type Rule = { source: RowSource; read: (row: AppendedRow, text: string) => string | undefined }

const textOf = (row: AppendedRow) => row.message.content.flatMap(b => (b.type === 'text' && b.text ? [b.text] : [])).join('\n')

const isPersonUser = (row: AppendedRow) => row.message.type === 'user' && !row.message.isMeta

// `/name args` from a slash command's stored form (`<command-name>` / `<command-args>` tags), `! cmd` from a
// shell escape's (`<bash-input>`)
export const commandEcho = (text: string) => {
  const bash = /^\s*<bash-input>([\s\S]*?)<\/bash-input>/.exec(text)?.[1]?.trim()
  if (bash) return `! ${bash}`
  const name = /<command-name>(.*?)<\/command-name>/.exec(text)?.[1]
  if (!name) return undefined
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim()
  return args ? `${name} ${args}` : name
}

// text the engine wrote in the person's place (`<local-command-stdout>`, `<bash-stdout>`, `<task-notification>`, ...):
// it opens with a kebab-case tag, so one rule keeps out tags not seen yet. A command echo is typed input.
// shortcut: a prompt that itself opens with a custom-element tag (`<my-card>`) is dropped too; check the tag name if that shows
const ENGINE_TAG = /^\s*<[a-z]+(?:-[a-z]+)+>/
export const isEngineText = (text: string) => ENGINE_TAG.test(text) && commandEcho(text) === undefined

// shortcut: a mid-turn message is only readable from the engine's reminder wording; update if that wording changes
const MID_TURN = /while you were working:\n([\s\S]*?)\n\nThis is how/

// first match wins
const RULES: readonly Rule[] = [
  // a command's echo by its stored form, whatever door the engine stores it by (`/clear` and `/model` use others)
  { source: 'command', read: (row, text) => (isPersonUser(row) && (row.door === 'command' || commandEcho(text) !== undefined) ? (commandEcho(text) ?? text) : undefined) },
  { source: 'prompt', read: (row, text) => (isPersonUser(row) && (row.door === 'prompt' || (row.door === 'delivery' && row.origin.kind === 'composer')) ? text : undefined) },
  { source: 'queued', read: (row, text) => (isPersonUser(row) && row.door === 'queue' ? (commandEcho(text) ?? text) : undefined) },
  { source: 'local-command', read: (row, text) => (row.message.type === 'system' && row.message.name === 'local_command' ? commandEcho(text) : undefined) },
  { source: 'mid-turn', read: (row, text) => (row.message.name === 'queued_command' ? MID_TURN.exec(text)?.[1] : undefined) },
  { source: 'reply', read: (row, text) => (row.door === 'response' ? text : undefined) },
]

export const classify = (row: AppendedRow): Row | undefined => {
  const text = textOf(row)
  for (const rule of RULES) {
    const read = rule.read(row, text)
    if (read === undefined) continue
    if (!read.trim() || read.startsWith('[Request interrupted') || (rule.source !== 'reply' && isEngineText(read))) return undefined
    return { kind: rule.source === 'reply' ? 'reply' : 'input', source: rule.source, text: read }
  }
  return undefined
}

// the first line, cut to `max` characters; a pasted block's `<pasted_content id>` tags are not text
export const oneLine = (text: string, max: number) => {
  const line = (text.replace(/<\/?pasted_content[^>]*>/g, '').trim().split('\n')[0] ?? '').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// markdown # / ## / ### lines outside ``` fences
export const headings = (text: string, max = 72) => {
  const found: { level: number; text: string }[] = []
  let isFenced = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) isFenced = !isFenced
    const m = !isFenced && /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) found.push({ level: (m[1] ?? '').length, text: oneLine(m[2] ?? '', max) })
  }
  return found
}
