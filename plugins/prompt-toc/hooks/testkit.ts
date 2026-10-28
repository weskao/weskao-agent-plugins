import { test as kitTest } from 'claude-code/testing'
import type { TestBody as Body, TestRest } from 'claude-code/testing'

// an engine test mounts the pane (~1-2 s); with every test file running at once on a busy machine those outran
// the kit's 5 s default and failed at random (seen at 5.1-6.4 s). 15 s still fails a real hang
const TIMEOUT_MS = 15_000

// a bare /prompt-toc asks which panes are open (it toggles): none, unless a test answers ui.panes itself. The kit
// refuses a second handler for one event, so the default passes to the test's own
const noPanes = (body: Body): Body =>
  ((...a: Parameters<Body>) => {
    const [$, on, ...more] = a
    let own: ((...h: unknown[]) => unknown) | undefined
    on('ui.panes', ((...h: unknown[]) => (own ? own(...h) : { value: [] })) as never)
    const wrapped = ((event: string, ...h: unknown[]) =>
      event === 'ui.panes' ? void (own = h.at(-1) as typeof own) : (on as (...x: unknown[]) => unknown)(event, ...h)) as typeof on
    return body(...([$, wrapped, ...more] as Parameters<Body>))
  }) as Body

// the kit's `test`, defaulting `timeoutMs`; a test's own options still win
export const test = (name: string, ...rest: TestRest) =>
  rest.length === 1
    ? kitTest(name, { timeoutMs: TIMEOUT_MS }, noPanes(rest[0]))
    : kitTest(name, { timeoutMs: TIMEOUT_MS, ...rest[0] }, noPanes(rest[1]))
