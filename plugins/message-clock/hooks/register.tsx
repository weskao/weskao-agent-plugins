import type { EngineInterface, Register } from 'claude-code'
import { fmt } from './shared/fmt'
import { classify, commandEcho } from './shared/rows'
import type { AppendedRow, Row } from './shared/rows'

export { fmt }

// rows drawn without a stable message id: a command's echo ('placeholder'), a queued prompt (a fresh id per redraw)
const KEYED_BY_TEXT = new Set(['command', 'local-command', 'queued', 'mid-turn'])

// a command echo stored in its collapsed form (`<command-name>` with no `<command-contents>`) is drawn by the engine
// outside any render site (seen on 2.1.299–2.1.301), so no mod can draw on it. Stored with an empty `<command-contents>`,
// the engine draws it through the UserMessage site instead, where ui.render below puts the typed form back and adds the time.
// shortcut: the empty tag reaches the transcript the model reads; drop this once the engine sites that row
const EMPTY_CONTENTS = '\n<command-contents></command-contents>'
const withEmptyContents = <T extends { message: { content: AppendedRow['message']['content'] } }>(e: T): T | undefined => {
  const i = e.message.content.findIndex(b => b.type === 'text' && b.text?.includes('<command-name>') && !b.text.includes('<command-contents>'))
  if (i < 0) return undefined
  const content = e.message.content.map((b, j) => (j === i ? { ...b, text: `${b.text}${EMPTY_CONTENTS}` } : b))
  return { ...e, message: { ...e.message, content } }
}

// rows stored before this process (resume, reload, a --resume launch) were never appended here: their time is the
// transcript's own; a row already stamped live keeps its stamp (prompt-toc's rescan keeps the same rule, so both agree)
async function restore($: EngineInterface, transcript?: string) {
  try {
    // shortcut: needs python3 on PATH; rows appended live are stamped without it
    const argv = ['python3', `${$.plugin.root}/scripts/scan.py`, await $.session.id(), ...(transcript ? [transcript] : [])]
    const ran = await $.process.run(argv, { timeoutMs: 20000 })
    if (ran.exitCode !== 0) return
    for (const [uuid, iso, echo] of JSON.parse(ran.stdout) as [string, string, string][]) {
      const at = Date.parse(iso)
      if (Number.isNaN(at)) continue
      const keys = [uuid, ...(echo ? [`text:${commandEcho(echo) ?? echo}`] : [])]
      for (const id of keys) if ((await $.state.get({ plugin: 'message-clock', key: 'at', id })).value === undefined) await $.state.set({ plugin: 'message-clock', key: 'at', id }, at)
    }
  } catch {}
}

export const register: Register = on => {
  // a launch, a reload or a --resume launch; unawaited so a big transcript never holds the first prompt
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    void restore($)
    return started
  })

  // an in-process /resume raises no session.start, only the settings hooks' SessionStart
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'resume') void restore($, e.transcript_path)
    return result
  })

  on('session.append', async ($, e, next) => {
    // every input and every reply text row: the time it was stored. A clock failure must never fail the append
    let row: Row | undefined
    let sited: typeof e | undefined
    try {
      row = classify(e)
      if (row?.source === 'command' || row?.source === 'local-command') sited = withEmptyContents(e)
    } catch {}
    const result = await next(sited ?? e)

    try {
      if (row) {
        const now = await $.clock.now()
        await $.state.set({ plugin: 'message-clock', key: 'at', id: e.uuid }, now)
        // shortcut: the same text typed twice shows the latest time on both rows, until those rows carry their message id
        if (KEYED_BY_TEXT.has(row.source)) await $.state.set({ plugin: 'message-clock', key: 'at', id: `text:${row.text}` }, now)
      }
    } catch {}
    return result
  })

  // wraps the engine's own row (composes via next) with a dim time on the right
  on('ui.render', { component: ['UserMessage', 'AssistantMessage', 'CommandOutput'] }, async ($, e, next) => {
    // a stored command echo (see withEmptyContents) is drawn as typed, `/name args`, not by its stored form;
    // a shell escape (`<bash-input>`) keeps the engine's own drawing
    const typed = e.component === 'UserMessage' && e.props.text.includes('<command-name>') ? commandEcho(e.props.text) : undefined
    const drawn = await next(typed === undefined ? e : { ...e, props: { ...e.props, text: typed } })
    const isOutput = e.component === 'CommandOutput'
    // a command's output row (`⎿ Reloaded …`) also shows the command's time, found by the echo's typed form
    let { value: at } = await $.state.get({ plugin: 'message-clock', key: 'at', id: isOutput ? `text:/${e.props.command}${e.props.args ? ` ${e.props.args}` : ''}` : e.requestId })
    if (at === undefined && e.component === 'UserMessage') {
      // the echo may carry the stored form (`<command-name>` tags) rather than `/name args`
      ;({ value: at } = await $.state.get({ plugin: 'message-clock', key: 'at', id: `text:${commandEcho(e.props.text) ?? e.props.text}` }))
    }
    if (at === undefined) return drawn

    const { Box, Text } = $.ui.resolve(e)
    // the prompt row's gray band (theme key); padding, not margin, so the gap is gray too
    const bg = e.component === 'UserMessage' ? 'userMessageBackground' : undefined
    const row = (
      <Box flexDirection="row">
        {/* column so the engine's row stretches to full width and its gray band fills the gap */}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>{drawn}</Box>
        {/* a message row opens with a blank margin line; skip it so the time sits beside the text (an output row has none) */}
        <Box flexShrink={0} marginTop={isOutput ? 0 : 1} paddingLeft={1} paddingRight={1} backgroundColor={bg}>
          <Text dimColor backgroundColor={bg}>{fmt(at)}</Text>
        </Box>
      </Box>
    )
    if (!bg) return row
    // one gray row above and below the prompt: the engine's opening margin line turns gray inside this band, marginTop keeps the gap above
    return (
      <Box flexDirection="column" marginTop={1} paddingBottom={1} backgroundColor={bg}>
        {row}
      </Box>
    )
  })
}
