// generated from mods/_shared/update.ts by mods/_shared/sync.py: edit the source there, then run it
import type { EngineInterface } from 'claude-code'

// the public marketplace the mods are published to (skills/marketplace-publish). A copy loaded from anywhere else
// (the local dev marketplace, --plugin-dir) has no upstream to compare with: it is never checked or updated
export const MARKETPLACE = 'weskao-agent-plugins'
const CATALOG = `https://raw.githubusercontent.com/weskao/${MARKETPLACE}/main/.claude-plugin/marketplace.json`
const DAY = 24 * 60 * 60 * 1000
const CHECKED = 'updateCheckedAt'

// >0 when a is newer; dotted numbers only, a pre-release suffix (`-beta`) is ignored
export const cmpVersion = (a: string, b: string): number => {
  const pa = a.replace(/-.*/, '').split('.').map(Number)
  const pb = b.replace(/-.*/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

// an installed plugin lives under plugins/cache/<marketplace>/<name>/<version>
export const isPublished = (root: string) => root.includes(`/${MARKETPLACE}/`)

// the newer upstream version, at most one fetch a day; undefined when current, unpublished, offline or unparsable
export async function checkUpdate($: EngineInterface, now = Date.now(), root = $.plugin.root): Promise<string | undefined> {
  if (!isPublished(root)) return
  const last = (await $.store.get(CHECKED)) as number | undefined
  if (last !== undefined && now - last < DAY) return
  // stamped before the fetch: a failing network is not retried on every launch
  await $.store.set(CHECKED, now)
  try {
    const local = JSON.parse((await $.fs.read(`${root}/.claude-plugin/plugin.json`)) as string).version as string
    const res = await $.http.fetch(CATALOG)
    if (!res.ok) return
    const plugins = JSON.parse(res.text).plugins as { name: string; version?: string }[]
    const latest = plugins.find(p => p.name === $.plugin.name)?.version
    return latest && local && cmpVersion(latest, local) > 0 ? latest : undefined
  } catch {
    return
  }
}

// /<name>-update: refresh the marketplace, then update this plugin; the new code loads after a restart
export async function runUpdate($: EngineInterface, root = $.plugin.root): Promise<string> {
  const id = `${$.plugin.name}@${MARKETPLACE}`
  if (!isPublished(root)) return `${$.plugin.name} was not installed from ${MARKETPLACE}, so it has nothing to update from. To switch: claude plugin install ${id}`
  const out: string[] = []
  for (const argv of [['claude', 'plugin', 'marketplace', 'update', MARKETPLACE], ['claude', 'plugin', 'update', id]]) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 120_000 })
      if (r.exitCode !== 0) return `\`${argv.join(' ')}\` failed:\n${(r.stderr || r.stdout).trim()}`
      out.push(r.stdout.trim())
    } catch (err) {
      return `\`${argv.join(' ')}\` could not run (${String(err)}). Run it in a terminal instead.`
    }
  }
  await $.store.delete(CHECKED)
  return `${out.filter(Boolean).join('\n')}\nRestart Claude Code to load the new ${$.plugin.name}.`
}

// a module may hook session.start once, so each mod calls these from its own hook and answers
// `command.run` for `<name>-update` with runUpdate
export async function registerUpdate($: EngineInterface) {
  try {
    await $.command.register({ name: `${$.plugin.name}-update`, description: `Update ${$.plugin.name} to the latest version` })
  } catch {}
}

// call unawaited after next(e): the network never holds the first prompt
export function notifyUpdate($: EngineInterface) {
  void checkUpdate($)
    .then(v => v && $.ui.toast(`${$.plugin.name} ${v} is available: run /${$.plugin.name}-update`))
    .catch(() => {})
}
