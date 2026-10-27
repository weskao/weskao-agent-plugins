import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import RULES from './fixtures/rules'

const MERGE = '$HOME/.claude/skills/merge-into-main/scripts/merge_into_main.py'
const RULES_FILE = '/home/u/.claude/skill-step-progress/rules.json'

type State = { status: string; note?: string; step_order: string[]; steps: Record<string, { status: string; title: string }>; commits?: { hash: string; subject: string }[] }

// One write of a run's state, told as the change it made: `init`, each step whose status moved, a new commit list, or
// the archive. `prev` is the file's text before the write ('' once archived).
function trail(path: string, text: string, prev: string | undefined): string[] {
  const m = path.match(/\/skill-step-progress\/[^/]+\/([^/]+)\/[^/]+\/(.+)$/)
  if (!m || !text) return []
  const skill = m[1]
  const st = JSON.parse(text) as State
  if (m[2] !== 'current.json') return [`${skill} archive --status ${st.status}${st.note ? ` --note ${st.note}` : ''}`]
  const old = prev ? (JSON.parse(prev) as State) : null
  if (!old) return [`${skill} init --steps ${st.step_order.map(k => st.steps[k]!.title).join('|')}`]
  const out = st.step_order.filter(k => st.steps[k]!.status !== old.steps[k]!.status).map(k => `${skill} step ${k} ${st.steps[k]!.status}`)
  const list = (s: State) => (s.commits ?? []).map(c => `${c.hash} ${c.subject}`).join(' ')
  if (list(st) !== list(old)) out.push(`${skill} commits ${list(st)}`)
  return out
}

// An in-memory disk (`files`, seeded with the rules fixture) whose state writes are told as `calls` (see `trail`), the
// session folders they landed in, any non-git process run, and pane opens; Bash fails when `fail` says so.
// `git` answers git's argv (stdout, or null for a failing exit); by default git fails, as outside a repo.
function fakeHost(
  on: On,
  fail: (cmd: string) => boolean = () => false,
  git: (args: string[], cwd?: string) => string | null = () => null,
  env: Record<string, string> = { HOME: '/home/u', TMPDIR: '/var/t/' },
  files: Record<string, string> = { [RULES_FILE]: JSON.stringify(RULES) },
) {
  const calls: string[] = []
  const dirs = new Set<string>()
  const procs: string[] = []
  const opens: string[] = []
  const toasts: string[] = []
  // /clear hands the next session a new id
  let sid = 'sess-1'
  on('env.get', async ($, e) => ({ value: env[e.name] }))
  on('process.run', async ($, e) => {
    const { argv, init } = e as { argv: string[]; init?: { cwd?: string } }
    if (argv[0] !== 'git') procs.push(argv.join(' '))
    const out = argv[0] === 'git' ? git(argv.slice(1), init?.cwd) : ''
    return { value: { exitCode: out === null ? 128 : 0, stdout: out ?? '', stderr: '' } } as never
  })
  on('ui.toast', async ($, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.open', async ($, e) => {
    opens.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  // a test run on POSIX resolves a Windows path (`C:\\…`) against the cwd; on Windows it is absolute
  const at = (p: string) => p.replace(/^.*(?=[A-Z]:\\)/, '')
  on('fs.list', async () => ({ value: [] }) as never)
  on('fs.read', async ($, e) => (files[at(e.path)] === undefined ? { deny: 'ENOENT' } : { value: files[at(e.path)]! }) as never)
  on('fs.exists', async ($, e) => ({ value: files[at(e.path)] !== undefined }) as never)
  on('fs.write', async ($, e) => {
    const path = at(e.path)
    calls.push(...trail(path, e.text, files[path]))
    const dir = path.match(/^(.*\/skill-step-progress\/[^/]+)\//)?.[1]
    if (dir) dirs.add(dir)
    files[path] = e.text
    return { value: undefined } as never
  })
  on('session.root', async () => ({ value: '/repo' }))
  on('session.id', async () => ({ value: sid }))
  on('store.get', async () => ({ value: undefined }) as never)
  on('store.set', async () => ({ value: undefined }) as never)
  on('skill.prompt', async ($, e) => ({ text: e.text }) as never)
  on('prompt.submit', async ($, e) => e as never)
  on('tool.call', async ($, e) => ({ result: 'ok', isError: fail((e as { command?: string }).command ?? '') }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('session.end', async ($, e) => {
    sid = 'sess-2'
    return { sessionId: e.sessionId } as never
  })
  return { calls, dirs, procs, opens, files, toasts }
}

const turn = (reason = 'answer') => ({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: 't', reason }) as never
const bash = (command: string) => ({ tool: 'Bash', command }) as never
const slash = (name: string) => ({ text: `/${name}`, command: { name, args: '' } }) as never

// Seen live: /commit typed while the previous turn ran its Stop hooks is queued, its prompt.submit lands first, and the
// previous turn's turn.complete then ended the new run at Survey, 15 ms after it started.
test('a typed /commit is not ended by the turn it was typed over completing after it was queued', async ($, on) => {
  const { calls } = fakeHost(on)
  const clock = mock.clock(on)

  await $.prompt.submit({ ...(slash('commit') as object), turnId: 'earlier' } as never)
  await clock.settle()
  await $.turn.complete({ ...(turn() as object), turnId: 'earlier' } as never)
  await clock.settle()
  await $.tool.call(bash('git add a.md && git commit -q -m "docs: a"'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls.filter(c => c.includes('archive'))).toEqual(['commit archive --status completed'])
})

// The same with no settle between: the run must be registered with its turn before anything is awaited
test('the earlier turn completing while the queued /commit is still starting does not end it either', async ($, on) => {
  const { calls } = fakeHost(on)
  const clock = mock.clock(on)

  const queued = $.prompt.submit({ ...(slash('commit') as object), turnId: 'earlier' } as never)
  await $.turn.complete({ ...(turn() as object), turnId: 'earlier' } as never)
  await queued
  await clock.settle()
  await $.tool.call(bash('git add a.md && git commit -q -m "docs: a"'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls.filter(c => c.includes('archive'))).toEqual(['commit archive --status completed'])
})

// The repo key (origin URL, else the top level) cannot change within a session: looked up once, not per run
test('the repo key is looked up once per session, not at every run start', async ($, on) => {
  const seen: string[] = []
  fakeHost(on, undefined, args => {
    seen.push(args.join(' '))
    return null
  })
  const clock = mock.clock(on)

  for (let i = 0; i < 2; i++) {
    await $.prompt.submit(slash('commit'))
    await clock.settle()
    await $.tool.call(bash('git commit -m x'))
    await $.turn.complete(turn())
    await clock.settle()
  }

  expect(seen.filter(a => a.startsWith('remote get-url')).length).toBe(1)
  expect(seen.filter(a => a.startsWith('rev-parse --show-toplevel')).length).toBe(1)
})

// A sub-agent's run (an orch task committing its work) gets its own box: its own folder, its own git steps, and its end
// at the sub-agent's own turn end. The main loop's turn ending leaves it running.
test('a sub-agent\'s /commit runs in its own box, follows its own git, and ends with the sub-agent\'s turn', async ($, on) => {
  const { calls, dirs, files } = fakeHost(on)
  const clock = mock.clock(on)
  const agent = { agentId: 'agent_test_001' }

  await $.tool.call({ tool: 'Skill', skill: 'commit', ...agent } as never)
  // the same invocation's skill.prompt carries no agent id: it must not start a main-loop run
  await $.skill.prompt({ skill: 'commit', text: 'go' })
  await clock.settle()
  await $.tool.call({ ...(bash('git add a.md && git commit -q -m "docs: a"') as object), ...agent } as never)
  await $.turn.complete(turn())
  await clock.settle()
  expect(calls.filter(c => c.includes('archive'))).toEqual([])

  await $.turn.complete({ ...(turn() as object), ...agent } as never)
  await clock.settle()
  expect(calls).toEqual([
    'commit init --steps Survey|Group batches|Commit batches|Verify|Summary',
    'commit step 2 done',
    'commit step 1 done',
    'commit step 3 in_progress',
    'commit archive --status completed',
  ])
  const box = Object.keys(files).find(p => p.includes('/commit/repo~agent_te/history/'))
  expect(box).toBeDefined()
  expect(JSON.parse(files[box!]!).id).toBe('sub-agent agent_te')
  expect([...dirs]).toEqual(['/var/t/skill-step-progress/sess-1'])
})

test('a main /commit and a sub-agent\'s run side by side: each takes only its own git commands', async ($, on) => {
  const { calls } = fakeHost(on)
  const clock = mock.clock(on)
  const agent = { agentId: 'b7' }

  await $.prompt.submit(slash('commit'))
  await $.tool.call({ tool: 'Skill', skill: 'commit', ...agent } as never)
  await clock.settle()
  await $.tool.call({ ...(bash('git commit -m sub') as object), ...agent } as never)
  await $.turn.complete({ ...(turn() as object), ...agent } as never)
  await clock.settle()
  // the main run saw no git commit: ended by its own turn, it stops at Survey
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls.filter(c => c.includes('archive'))).toEqual(['commit archive --status completed', 'commit archive --status abandoned --note stopped at Survey'])
})

// A failure or an abandoned run shows a toast, so it is noticed with the pane closed; a completed one does not
test('a failed or abandoned run shows a toast naming the flow and why; a completed one shows none', async ($, on) => {
  const { toasts } = fakeHost(on, cmd => cmd.includes('safe_push'))
  const clock = mock.clock(on)

  await $.prompt.submit(slash('push'))
  await clock.settle()
  await $.tool.call(bash('python3 scripts/safe_push.py'))
  await $.turn.complete(turn())
  await clock.settle()
  await $.prompt.submit(slash('commit'))
  await clock.settle()
  await $.turn.complete(turn())
  await clock.settle()
  await $.prompt.submit(slash('commit'))
  await clock.settle()
  await $.tool.call(bash('git commit -m x'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(toasts).toEqual(['/push failed: failed at Safe push', '/commit abandoned: stopped at Survey'])
})

// Commits made in another work tree (`git -C <dir>`, `cd <dir> && git …`) are listed from that tree's own HEAD, read
// before its first step there ran
for (const [form, command, tree] of [
  ['git -C', 'git -C /wt add a.md && git -C /wt commit -q -m "feat: in worktree"', '/wt'],
  ['cd $HOME/… &&', 'cd "$HOME/wt" && git add a.md && git commit -q -m "feat: in worktree"', '/home/u/wt'],
] as const) {
  test(`/commit lists commits made in another work tree (${form})`, async ($, on) => {
    let committed = false
    const { calls } = fakeHost(
      on,
      cmd => {
        committed ||= cmd.includes('commit')
        return false
      },
      (args, cwd) => {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return cwd === tree ? (committed ? 'w1' : 'w0') : 'm0'
        if (args[0] === 'log') return cwd === tree && args.at(-1) === 'w0..HEAD' && committed ? 'w1 feat: in worktree' : ''
        return null
      },
    )
    const clock = mock.clock(on)

    await $.prompt.submit(slash('commit'))
    await clock.settle()
    await $.tool.call(bash(command))
    await $.turn.complete(turn())
    await clock.settle()

    expect(calls).toContain('commit commits w1 feat: in worktree')
  })
}

test('/commit: opens the pane, follows git add and git log, completes at turn end', async ($, on) => {
  const { calls, dirs, procs, opens } = fakeHost(on)
  const clock = mock.clock(on)

  await $.prompt.submit(slash('commit'))
  // the Skill-side entry for the same invocation must not start a second run
  await $.skill.prompt({ skill: 'commit', text: 'go' })
  await clock.settle()
  await $.tool.call(bash('git status --short'))
  await $.tool.call(bash('git add a.md && git commit -q -m "docs: a"'))
  await $.tool.call(bash('git log -1 --stat'))
  await $.turn.complete(turn())
  await clock.settle()

  // starting a later step finishes the one still running
  expect(calls).toEqual([
    'commit init --steps Survey|Group batches|Commit batches|Verify|Summary',
    'commit step 2 done',
    'commit step 1 done',
    'commit step 3 in_progress',
    'commit step 3 done',
    'commit step 4 in_progress',
    'commit archive --status completed',
  ])
  expect(opens).toContain('skill-step-progress')
  // state goes to this session's temp folder, never usage-data
  expect([...dirs]).toEqual(['/var/t/skill-step-progress/sess-1'])
  // written through the engine's file API: no python, no `env`, nothing that is missing on Windows
  expect(procs).toEqual([])
})

test('a finished run leaves its state in history/ and an empty current.json the pane skips', async ($, on) => {
  const { files } = fakeHost(on)
  const clock = mock.clock(on)

  await $.prompt.submit(slash('commit'))
  await clock.settle()
  await $.tool.call(bash('git commit -m x'))
  await $.turn.complete(turn())
  await clock.settle()

  const dir = '/var/t/skill-step-progress/sess-1/commit/repo'
  expect(files[`${dir}/current.json`]).toBe('')
  const archived = Object.keys(files).filter(p => p.startsWith(`${dir}/history/`))
  expect(archived.length).toBe(1)
  const st = JSON.parse(files[archived[0]!]!) as State
  expect(st.status).toBe('completed')
  // a completed run shows no step still pending or spinning
  expect(Object.values(st.steps).map(s => s.status)).toEqual(['done', 'done', 'done', 'done', 'done'])
})

test('a run an earlier process left in progress is archived as abandoned when the flow starts again', async ($, on) => {
  const dir = '/var/t/skill-step-progress/sess-1/commit/repo'
  const stale = { status: 'in_progress', current_step: '1', total_steps: 1, step_order: ['1'], steps: { '1': { status: 'in_progress', title: 'Old' } } }
  const { calls } = fakeHost(on, undefined, undefined, undefined, { [RULES_FILE]: '{}', [`${dir}/current.json`]: JSON.stringify(stale) })
  const clock = mock.clock(on)

  await $.prompt.submit(slash('commit'))
  await clock.settle()

  expect(calls).toEqual(['commit archive --status abandoned', 'commit init --steps Survey|Group batches|Commit batches|Verify|Summary'])
})

test('with no rules file only /commit is tracked: /push and merge-into-main are left alone', async ($, on) => {
  const { calls, opens } = fakeHost(on, undefined, undefined, undefined, {})
  const clock = mock.clock(on)

  await $.prompt.submit(slash('push'))
  await $.tool.call({ tool: 'Skill', skill: 'merge-into-main' } as never)
  await clock.settle()
  await $.tool.call(bash('python3 safe_push.py'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls).toEqual([])
  expect(opens).toEqual([])
})

test('the rules file adds and overrides flows; an entry that does not check out is dropped, the rest still load', async ($, on) => {
  const rules = {
    deploy: { steps: ['Build', 'Ship'], marks: [{ cmd: String.raw`\bmake deploy\b`, step: 2 }], doneAt: 2, oneTurn: true },
    commit: { steps: ['Stage', 'Commit'], marks: [{ cmd: String.raw`\bgit commit\b`, step: 2 }], doneAt: 2, oneTurn: true },
    // a regex that does not compile, a step past the list, a name that would leave the state folder, a bad commits kind
    broken: { steps: ['A'], marks: [{ cmd: '(', step: 1 }], doneAt: 1 },
    far: { steps: ['A'], marks: [{ cmd: 'x', step: 2 }], doneAt: 1 },
    '..': { steps: ['A'], marks: [], doneAt: 1 },
    odd: { steps: ['A'], marks: [], doneAt: 1, commits: 'all' },
  }
  const { calls } = fakeHost(on, undefined, undefined, undefined, { [RULES_FILE]: JSON.stringify(rules) })
  const clock = mock.clock(on)

  for (const name of ['deploy', 'broken', 'far', '..', 'odd']) await $.prompt.submit(slash(name))
  await clock.settle()
  await $.tool.call(bash('make deploy'))
  await $.turn.complete(turn())
  await $.prompt.submit(slash('commit'))
  await clock.settle()
  await $.tool.call(bash('git commit -m x'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls).toEqual([
    'deploy init --steps Build|Ship',
    'deploy step 1 done',
    'deploy step 2 in_progress',
    'deploy archive --status completed',
    'commit init --steps Stage|Commit',
    'commit step 1 done',
    'commit step 2 in_progress',
    'commit archive --status completed',
  ])
})

test('a rules file that is not JSON leaves the built-in /commit working', async ($, on) => {
  const { calls } = fakeHost(on, undefined, undefined, undefined, { [RULES_FILE]: '{ nope' })
  const clock = mock.clock(on)

  await $.prompt.submit(slash('commit'))
  await clock.settle()

  expect(calls).toEqual(['commit init --steps Survey|Group batches|Commit batches|Verify|Summary'])
})

test('without HOME (Windows) the rules file is read from USERPROFILE', async ($, on) => {
  const env = { USERPROFILE: 'C:\\Users\\u', TEMP: 'C:\\Users\\u\\Temp' }
  const { calls } = fakeHost(on, undefined, undefined, env, { 'C:\\Users\\u/.claude/skill-step-progress/rules.json': JSON.stringify(RULES) })
  const clock = mock.clock(on)

  await $.prompt.submit(slash('push'))
  await clock.settle()

  expect(calls).toEqual(['push init --steps Safe push|Summary'])
})

test('CLAUDE_CONFIG_DIR moves the rules file with the rest of Claude Code config; ~/.claude is then ignored', async ($, on) => {
  const env = { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u', TMPDIR: '/var/t/' }
  const { calls } = fakeHost(on, undefined, undefined, env, { '/cfg/skill-step-progress/rules.json': JSON.stringify({ deploy: { steps: ['Ship'], marks: [], doneAt: 1 } }), [RULES_FILE]: JSON.stringify(RULES) })
  const clock = mock.clock(on)

  await $.prompt.submit(slash('deploy'))
  await $.prompt.submit(slash('push'))
  await clock.settle()

  expect(calls).toEqual(['deploy init --steps Ship'])
})

test('/commit lists the commits made since HEAD at start under Summary, rewriting only when they change', async ($, on) => {
  let log = ''
  const { calls } = fakeHost(on, () => false, args => (args[0] === 'rev-parse' ? 'abc0000\n' : args.includes('abc0000..HEAD') ? log : null))
  const clock = mock.clock(on)

  await $.prompt.submit(slash('commit'))
  await clock.settle()
  log = 'aaa1111 feat: one\n'
  await $.tool.call(bash('git add a && git commit -m "feat: one"'))
  log = 'aaa1111 feat: one\nbbb2222 docs: two\n'
  await $.tool.call(bash('git add b && git commit -m "docs: two"'))
  await $.tool.call(bash('git log -2'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls.filter(c => c.includes('commits') || c.includes('archive'))).toEqual([
    'commit commits aaa1111 feat: one',
    'commit commits aaa1111 feat: one bbb2222 docs: two',
    'commit archive --status completed',
  ])
})

test('/commit: git -C <path> / --no-pager forms count; a sub-agent\'s git is not the main run\'s step', async ($, on) => {
  const { calls } = fakeHost(on)
  const clock = mock.clock(on)

  await $.prompt.submit(slash('commit'))
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'git add a && git commit -m x', agentId: 'explore-1' } as never)
  await $.tool.call(bash('git -C /repo add a.md && git -c commit.gpgsign=false -C /repo commit -q -m "docs: a"'))
  await $.tool.call(bash('git --no-pager log -1 --stat'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls.slice(1)).toEqual([
    'commit step 2 done',
    'commit step 1 done',
    'commit step 3 in_progress',
    'commit step 3 done',
    'commit step 4 in_progress',
    'commit archive --status completed',
  ])
})

test('/release and /commit run side by side: each follows its own marks and ends on its own', async ($, on) => {
  const { calls } = fakeHost(on)
  const clock = mock.clock(on)

  await $.prompt.submit(slash('release'))
  await clock.settle()
  await $.tool.call(bash('pytest -q'))
  // the release waits for the intro approval; a /commit in between is its own run
  await $.turn.complete(turn())
  await $.prompt.submit(slash('commit'))
  await clock.settle()
  await $.tool.call(bash('git add a && git commit -m "docs: a"'))
  await $.turn.complete(turn())
  await $.tool.call(bash('scripts/release.sh 1.0.0'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls).toEqual([
    'release init --steps Survey|Test gate|Draft intro|Release script|Publish & verify|Summary',
    'release step 1 done',
    'release step 2 in_progress',
    'commit init --steps Survey|Group batches|Commit batches|Verify|Summary',
    'commit step 2 done',
    'commit step 1 done',
    'commit step 3 in_progress',
    'commit archive --status completed',
    'release step 3 done',
    'release step 2 done',
    'release step 4 in_progress',
    'release archive --status completed',
  ])
})

test('/commit: a rejected git commit stays failed through a later git log; retrying it clears', async ($, on) => {
  const { calls } = fakeHost(on, cmd => cmd.includes('bad'))
  const clock = mock.clock(on)

  await $.prompt.submit(slash('commit'))
  await clock.settle()
  await $.tool.call(bash('git add a && git commit -m "bad"'))
  await $.tool.call(bash('git log -1'))
  await $.turn.complete(turn())
  await $.prompt.submit(slash('commit'))
  await clock.settle()
  await $.tool.call(bash('git add a && git commit -m "bad"'))
  await $.tool.call(bash('git commit -m "ok"'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls.filter(c => c.includes('archive'))).toEqual([
    'commit archive --status failed --note failed at Commit batches',
    'commit archive --status completed',
  ])
})

test('/clear drops a run mid-flight: the next session\'s /commit starts fresh instead of being skipped', async ($, on) => {
  const { calls } = fakeHost(on)
  const clock = mock.clock(on)

  await $.prompt.submit(slash('release'))
  await clock.settle()
  await $.session.end({ reason: 'clear', sessionId: 'sess-1' } as never)
  await $.prompt.submit(slash('release'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls.filter(c => c.includes('init')).length).toBe(2)
  expect(calls.filter(c => c.includes('archive'))).toEqual([])
})

test('/commit with nothing to commit ends as abandoned; git log while surveying is not Verify', async ($, on) => {
  const { calls } = fakeHost(on)
  const clock = mock.clock(on)

  await $.prompt.submit(slash('commit'))
  await clock.settle()
  await $.tool.call(bash('git log --oneline -3'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls.slice(1)).toEqual(['commit archive --status abandoned --note stopped at Survey'])
})

test('/push: a failing safe push archives as failed', async ($, on) => {
  const { calls } = fakeHost(on, cmd => cmd.includes('safe_push.py'))
  const clock = mock.clock(on)

  await $.prompt.submit(slash('push'))
  await clock.settle()
  await $.tool.call(bash('python3 "$HOME/.claude/skills/safe-git-push/scripts/safe_push.py"'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls).toEqual(['push init --steps Safe push|Summary', 'push archive --status failed --note failed at Safe push'])
})

test('/push lists the commits it sent, counted before the push and read back from HEAD after it', async ($, on) => {
  let pushed = false
  // the Bash call itself flips `pushed`: what git answers changes once the push ran
  const ran = () => ((pushed = true), false)
  const { calls } = fakeHost(on, ran, args => {
    if (args[0] === 'rev-list') return pushed ? '0\n' : '2\n'
    // after a rebase onto the remote the two sent commits carry new hashes
    return args[0] === 'log' && args.includes('2') ? 'ccc3333 fix: a\nddd4444 feat: b\n' : null
  })
  const clock = mock.clock(on)

  await $.prompt.submit(slash('push'))
  await clock.settle()
  await $.tool.call(bash('python3 "$HOME/.claude/skills/safe-git-push/scripts/safe_push.py"'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls).toEqual(['push init --steps Safe push|Summary', 'push commits ccc3333 fix: a ddd4444 feat: b', 'push archive --status completed'])
})

test('merge-into-main: conflicts on start move to Resolve; the run waits across turns until Finish', async ($, on) => {
  const { calls } = fakeHost(on, cmd => / start\b/.test(cmd))
  const clock = mock.clock(on)

  await $.tool.call({ tool: 'Skill', skill: 'merge-into-main' } as never)
  await clock.settle()
  await $.tool.call(bash(`python3 "${MERGE}" start feat/x`))
  // the user reviews the conflict summary in between: the run stays open
  await $.turn.complete(turn())
  await $.tool.call(bash('npx vitest run'))
  await $.tool.call(bash(`python3 "${MERGE}" finish --repo "$REPO"`))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls.slice(1)).toEqual([
    'merge-into-main step 1 done',
    'merge-into-main step 2 in_progress',
    'merge-into-main step 2 done',
    'merge-into-main step 3 in_progress',
    'merge-into-main step 3 done',
    'merge-into-main step 4 in_progress',
    'merge-into-main archive --status completed',
  ])
})

test('commands outside the rules are left alone', async ($, on) => {
  const { calls, opens } = fakeHost(on)
  const clock = mock.clock(on)

  await $.prompt.submit(slash('sop-a'))
  await $.tool.call(bash('git add a && git commit -m x'))
  await $.turn.complete(turn())
  await clock.settle()

  expect(calls).toEqual([])
  expect(opens).toEqual([])
})

// no TMPDIR: another per-user temp dir, else ~/.cache; never a shared /tmp
for (const [env, dir] of [
  [{ HOME: '/home/u', XDG_RUNTIME_DIR: '/run/user/1000' }, '/run/user/1000'],
  [{ HOME: '/home/u', TEMP: 'C:\\Users\\u\\Temp\\' }, 'C:\\Users\\u\\Temp'],
  [{ HOME: '/home/u' }, '/home/u/.cache'],
  [{ USERPROFILE: 'C:\\Users\\u' }, 'C:\\Users\\u/.cache'],
] as const) {
  test(`the session folder falls back to ${dir}`, async ($, on) => {
    const { dirs } = fakeHost(on, () => false, () => null, env)
    const clock = mock.clock(on)
    await $.prompt.submit(slash('commit'))
    await clock.settle()
    expect([...dirs]).toEqual([`${dir}/skill-step-progress/sess-1`])
  })
}
