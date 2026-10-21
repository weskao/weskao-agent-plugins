import { test as kitTest } from 'claude-code/testing'
import type { TestRest } from 'claude-code/testing'

// an engine test mounts the pane (~1-2 s); with every test file running at once on a busy machine those outran
// the kit's 5 s default and failed at random (seen at 5.1-6.4 s). 15 s still fails a real hang
const TIMEOUT_MS = 15_000

// the kit's `test`, defaulting `timeoutMs`; a test's own options still win
export const test = (name: string, ...rest: TestRest) =>
  rest.length === 1 ? kitTest(name, { timeoutMs: TIMEOUT_MS }, rest[0]) : kitTest(name, { timeoutMs: TIMEOUT_MS, ...rest[0] }, rest[1])
