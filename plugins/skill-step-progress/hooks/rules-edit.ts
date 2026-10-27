import type { EngineInterface } from 'claude-code'

import { BUILTIN, flowJson, isState, loadRules, rulesPath, toFlow } from './step-listener'
import type { RuleRow } from '../types'
import type { Flow } from './step-listener'

// The one home for editing the rules file. The model's `rules` tool and `/progress rules` both go through runAction, and
// the pane's Rules view calls the same operations, so a flow is checked by the toFlow the listener loads with and the
// file is never left invalid or half-written. The pane module (progress-pane.tsx) only wires these to its hooks and UI.

export type RuleInput = { action?: string; name?: string; rule?: unknown; command?: string }

type File = Record<string, unknown>

const isBuiltin = (name: string) => Object.hasOwn(BUILTIN, name)
const ACTIONS = ['list', 'get', 'set', 'remove', 'pause', 'resume', 'test']

// The file as an object ({} when missing or empty), or why it cannot be edited: a file that is not a JSON object is
// someone's hand edit in progress, and writing over it would lose that. Read fresh, parsed by the listener's loadRules
// (once per changed text), so the pane's poll and the hooks share one parse.
async function readFile($: EngineInterface): Promise<File | string> {
  return loadRules($)
}

// Every operation starts here: `use` gets the file, or the reply is why it could not be read (after `fail`)
async function withFile($: EngineInterface, fail: string, use: (file: File) => Promise<string> | string) {
  const file = await readFile($)
  return typeof file === 'string' ? `${fail}${file}.` : use(file)
}

// Entries other than `name` are written back as they were, hand edits that do not check out included
async function writeFile($: EngineInterface, file: File) {
  await $.fs.write(await rulesPath($), `${JSON.stringify(file, null, 2)}\n`)
  await loadRules($)
}

const without = (file: File, name: string) => Object.fromEntries(Object.entries(file).filter(([k]) => k !== name))

// The flow `name` resolves to: the file's entry, else the built-in one
function lookup(file: File, name: string): Flow | string | null {
  if (Object.hasOwn(file, name)) return toFlow(name, file[name])
  return isBuiltin(name) ? BUILTIN[name]! : null
}

export async function listRules($: EngineInterface): Promise<RuleRow[] | string> {
  const file = await readFile($)
  if (typeof file === 'string') return file
  return [...new Set([...Object.keys(BUILTIN), ...Object.keys(file)])].map(name => {
    const r = lookup(file, name)!
    return {
      name,
      source: !Object.hasOwn(file, name) ? 'built-in' : isBuiltin(name) ? 'replaces built-in' : 'rules file',
      off: typeof r !== 'string' && r.off === true,
      ...(typeof r === 'string' ? { steps: 0, state: null } : summary(r)),
      error: typeof r === 'string' ? r : null,
    }
  })
}

const summary = (f: Flow) => (isState(f) ? { steps: 0, state: f.state } : { steps: f.steps.length, state: null })
// what a flow tracks: its steps, or the usage-data folder its skill writes
const tracks = (f: { state: string | null; steps: number }) => (f.state ? `state in usage-data/${f.state}` : `${f.steps} steps`)

export const rowText = (r: RuleRow) => `${r.name} · ${r.source} · ${r.error ? `✖ ${r.error}` : `${tracks(r)}${r.off ? ' · paused' : ''}`}`

async function listText($: EngineInterface) {
  const rows = await listRules($)
  if (typeof rows === 'string') return rows
  return [`Flows (${await rulesPath($)}):`, ...rows.map(r => `- ${rowText(r)}`)].join('\n')
}

async function getRule($: EngineInterface, name: string) {
  return withFile($, '', file => {
    if (Object.hasOwn(file, name)) return JSON.stringify(file[name], null, 2)
    return isBuiltin(name) ? JSON.stringify(flowJson(BUILTIN[name]!), null, 2) : `No flow named ${name}.`
  })
}

// Saved only when the name and every field check out. A paused flow stays paused unless `off` is given.
async function setRule($: EngineInterface, name: string, value: unknown) {
  const r = toFlow(name, value)
  if (typeof r === 'string') return `Not saved: ${r}.`
  return withFile($, 'Not saved: ', async file => {
    const prev = lookup(file, name)
    const off = r.off ?? (prev && typeof prev !== 'string' ? prev.off : undefined)
    // the value as given (its regex sources as typed), known keys only
    await writeFile($, { ...file, [name]: flowJson({ ...(value as Flow), off } as never) })
    return `Saved ${name} (${tracks(summary(r))}) to ${await rulesPath($)}. It applies from the next /${name} run.`
  })
}

export async function removeRule($: EngineInterface, name: string) {
  return withFile($, 'Not removed: ', async file => {
    if (!Object.hasOwn(file, name)) return isBuiltin(name) ? `${name} is built in; pause it instead.` : `No flow named ${name}.`
    await writeFile($, without(file, name))
    return `Removed ${name}${isBuiltin(name) ? `; the built-in /${name} applies again` : ''}.`
  })
}

// Pausing a built-in copies it into the file with `off`; resuming drops that copy again once it matches the built-in.
export async function pauseRule($: EngineInterface, name: string, off: boolean) {
  const verb = off ? 'Paused' : 'Resumed'
  return withFile($, `Not ${verb.toLowerCase()}: `, async file => {
    const r = lookup(file, name)
    if (r === null) return `No flow named ${name}.`
    if (typeof r === 'string') return `${name} does not check out (${r}); fix or remove it.`
    // a file entry keeps its regex sources as typed
    const entry = flowJson({ ...((Object.hasOwn(file, name) ? file[name] : r) as Flow), off: off || undefined } as never)
    const isBuiltinCopy = isBuiltin(name) && JSON.stringify(entry) === JSON.stringify(flowJson(BUILTIN[name]!))
    await writeFile($, isBuiltinCopy ? without(file, name) : { ...file, [name]: entry })
    return `${verb} ${name}.`
  })
}

// Which step `command` would start in the flow `name` (or whether it marks a state flow as run), or in `draft` when one
// is given (to check before saving).
async function testRule($: EngineInterface, name: string, command: string, draft?: unknown) {
  const explain = (r: Flow | string | null) => {
    if (r === null) return `No flow named ${name}.`
    if (typeof r === 'string') return `${name} does not check out: ${r}.`
    if (isState(r)) {
      if (!r.writer) return `${name} has no writer: it is marked as run only when /${name} is invoked.`
      return r.writer.test(command)
        ? `\`${command}\` marks ${name} as run (its state is read from usage-data/${r.state}).`
        : `\`${command}\` matches no writer: it would not mark ${name} as run.`
    }
    const hits = r.marks.filter(m => m.cmd.test(command))
    if (hits.length === 0) return `\`${command}\` matches no mark: it would not move ${name}.`
    return hits
      .map(m => {
        const when = [m.after !== undefined && `once step ${m.after} is reached`, m.onError && 'only when it fails'].filter(Boolean).join(', ')
        return `\`${command}\` starts step ${m.step} "${r.steps[m.step - 1]}"${when ? ` (${when})` : ''}.`
      })
      .join('\n')
  }
  return draft === undefined ? withFile($, '', file => explain(lookup(file, name))) : explain(toFlow(name, draft))
}

// The model's tool and `/progress rules <verb> <name>` alike; every action but list needs a name, test a command too
export async function runAction($: EngineInterface, input: RuleInput): Promise<string> {
  const { action, name = '', command = '' } = input
  if (action === 'list') return listText($)
  if (!ACTIONS.includes(action ?? '')) return `action must be one of ${ACTIONS.join(', ')}.`
  if (!name) return `${action} needs a name.`
  if (action === 'get') return getRule($, name)
  if (action === 'set') return setRule($, name, input.rule)
  if (action === 'remove') return removeRule($, name)
  if (action === 'test') return command ? testRule($, name, command, input.rule) : 'test needs a command.'
  return pauseRule($, name, action === 'pause')
}

// Registered by the pane module as mcp__skill-step-progress__rules
export const RULES_TOOL = {
  name: 'rules',
  description:
    "Read and edit the flows skill-step-progress tracks: a watched flow (the Progress pane's steps for a skill, moved by the Bash commands it runs) " +
    'or a state flow (a skill that writes its own progress state). ' +
    'Actions: list; get <name>; set <name> + rule (checked first, never saved when invalid: the reply says why); remove <name>; ' +
    'pause/resume <name>; test <name> + command (which step that command starts; pass rule to test a draft before saving). ' +
    'A rule: { steps: string[] (titles; the run starts on step 1), marks: [{ cmd: regex source matching a Bash command, step: 1-based, ' +
    'after?: only once this step is reached, onError?: only when the command fails }], doneAt: a turn ending at or past this step completes the run, ' +
    'oneTurn?: the flow never spans turns, commits?: "made" (list commits since the start) | "pushed" (what a matched push sent) }. ' +
    'A state flow: { state: the usage-data folder its skill writes current.json to, writer?: regex source of the Bash call that writes it }; ' +
    'its name may keep a plugin prefix (orch:task). ' +
    "To add one, read the skill's SKILL.md, give each step the commands that start it, test a few real commands, then set.",
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ACTIONS },
      name: { type: 'string', description: 'skill or command name, without the slash' },
      rule: { type: 'object', description: 'the flow, for set (or a draft for test)' },
      command: { type: 'string', description: 'a Bash command, for test' },
    },
    required: ['action'],
  },
  // only needed when someone edits flows: kept out of every turn's tool list
  isDeferred: true,
} as const
