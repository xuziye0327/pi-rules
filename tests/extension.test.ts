import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { registerRules, toolTargets } from '../src/index.ts'
import { homeDir, overlayFileSystem, projectRoot, projectRule } from './helpers/fixtures.ts'

type Handler = (event: unknown, context: ExtensionContext) => unknown
type Command = Parameters<ExtensionAPI['registerCommand']>[1]

function extensionHarness() {
  const handlers = new Map<string, Handler>()
  const commands = new Map<string, Command>()
  const flags = new Map<string, unknown>()
  const output: string[] = []
  const contents = new Map<string, string | Error>()
  const boundary = {
    registerFlag(name: string, options: { default: unknown }) {
      flags.set(name, options.default)
    },
    getFlag(name: string) {
      return flags.get(name)
    },
    on(name: string, handler: Handler) {
      handlers.set(name, handler)
    },
    registerCommand(name: string, command: Command) {
      commands.set(name, command)
    },
  }
  const engine = registerRules(boundary as unknown as ExtensionAPI, {
    homeDir,
    env: {},
    allowlist: ['.pi/rules'],
    fs: overlayFileSystem(contents),
    stderr: (text) => output.push(text),
  })
  const context = {
    cwd: projectRoot,
    mode: 'print',
    hasUI: false,
    ui: {
      notify() {
        throw new Error('Noninteractive contexts must not notify')
      },
      setStatus() {
        throw new Error('Noninteractive contexts must not install status')
      },
      setWidget() {
        throw new Error('Noninteractive contexts must not install widgets')
      },
    },
    waitForIdle: async () => {},
  }
  const emit = (name: string, event: unknown = {}) => {
    const handler = handlers.get(name)
    assert.ok(handler, `Missing extension handler: ${name}`)
    return handler(event, context as unknown as ExtensionContext)
  }
  const command = async (name: string, args = '') => {
    const registered = commands.get(name)
    assert.ok(registered, `Missing extension command: ${name}`)
    await registered.handler(args, context as unknown as Parameters<Command['handler']>[1])
  }
  return { engine, flags, output, contents, context, emit, command }
}

for (const { name, event, expected } of [
  {
    name: 'top-level edit path',
    event: { toolName: 'edit', input: { path: 'src/main.ts' } },
    expected: ['src/main.ts'],
  },
  {
    name: 'write filePath and path aliases',
    event: { toolName: 'write', input: { filePath: 'one.ts', path: 'two.ts' } },
    expected: ['one.ts', 'two.ts'],
  },
  { name: 'read tools', event: { toolName: 'read', input: { path: 'secret.ts' } }, expected: [] },
  {
    name: 'nested edits',
    event: { toolName: 'edit', input: { path: 'nested.ts' }, parentToolCallId: 'parent' },
    expected: [],
  },
  {
    name: 'empty parent IDs still identify nested calls',
    event: { toolName: 'write', input: { path: 'nested.ts' }, parentToolCallId: '' },
    expected: [],
  },
  {
    name: 'edit does not accept the write-only filePath alias',
    event: { toolName: 'edit', input: { filePath: 'ignored.ts' } },
    expected: [],
  },
  {
    name: 'blank and non-string fields',
    event: { toolName: 'write', input: { filePath: '  ', path: 42 } },
    expected: [],
  },
  {
    name: 'paths retain meaningful leading and trailing spaces',
    event: { toolName: 'edit', input: { path: ' file.ts ' } },
    expected: [' file.ts '],
  },
]) {
  test(`tool targets filter ${name}`, () => {
    assert.deepEqual(toolTargets(event), expected)
  })
}

for (const input of [undefined, null, 'main.ts', 42, ['main.ts']]) {
  test(`tool targets reject non-record input ${JSON.stringify(input)}`, () => {
    assert.deepEqual(toolTargets({ toolName: 'edit', input }), [])
  })
}

test('extension events activate real rules and replace request-local sections without mutating the transcript', () => {
  const harness = extensionHarness()
  harness.emit('session_start')
  harness.emit('before_agent_start', { systemPromptOptions: { contextFiles: [] } })
  harness.emit('tool_call', { toolName: 'edit', input: { path: 'src/main.ts' } })
  const messages = [
    {
      role: 'system',
      content: 'Base instructions',
      sections: { project: 'Keep this', pi_rules: 'Stale rules' },
      timestamp: 1,
    },
    { role: 'user', content: 'Edit the file', timestamp: 2 },
  ]
  const result = harness.emit('context_with_system', { messages }) as { messages: typeof messages }
  const sections = result.messages[0].sections
  assert.ok(sections)
  const section = sections.pi_rules
  assert.match(section, /Project instructions\./)
  assert.match(section, /TypeScript instructions\./)
  assert.doesNotMatch(section, /Stale rules/)
  assert.equal(sections.project, 'Keep this')
  assert.equal(result.messages[1], messages[1])
  assert.equal(messages[0].sections?.pi_rules, 'Stale rules')
  assert.equal(harness.engine.snapshot.injected.size, 2)
  assert.deepEqual(harness.engine.snapshot.warnings, [])
})

test('native context files are not duplicated in the next request', () => {
  const harness = extensionHarness()
  harness.emit('before_agent_start', {
    systemPromptOptions: { contextFiles: [{ path: projectRule('10-general.mdc') }] },
  })
  const result = harness.emit('context_with_system', {
    messages: [{ role: 'system', content: 'Native instructions', sections: { pi_rules: 'Old' } }],
  }) as { messages: { sections: Record<string, string> }[] }
  assert.deepEqual(result.messages[0].sections, {})
  assert.equal(harness.engine.snapshot.injected.size, 0)
})

test('flag changes remove stale request sections and pause tool activation until re-enabled', () => {
  const harness = extensionHarness()
  harness.emit('session_start')
  harness.emit('tool_call', { toolName: 'edit', input: { path: 'src/main.ts' } })
  harness.flags.set('pi-rules-disabled', true)
  harness.emit('tool_call', { toolName: 'write', input: { path: 'README.md' } })
  const result = harness.emit('context_with_system', {
    messages: [{ role: 'system', content: 'Base', sections: { pi_rules: 'Stale' } }],
  }) as { messages: { sections: Record<string, string> }[] }
  assert.deepEqual(result.messages[0].sections, {})
  assert.equal(harness.engine.snapshot.injected.size, 0)
  assert.equal(harness.engine.snapshot.activated.length, 2)
  harness.flags.set('pi-rules-disabled', false)
  const resumed = harness.emit('context_with_system', {
    messages: [{ role: 'system', content: 'Base' }],
  }) as { messages: { sections: Record<string, string> }[] }
  assert.match(resumed.messages[0].sections.pi_rules, /TypeScript instructions\./)
  assert.doesNotMatch(resumed.messages[0].sections.pi_rules, /Markdown instructions\./)
})

test('active rules are injected when context has no leading system message', () => {
  const harness = extensionHarness()
  harness.emit('session_start')
  harness.emit('tool_call', { toolName: 'edit', input: { path: 'src/main.ts' } })
  const user = { role: 'user', content: 'Edit the file', timestamp: 1 }
  const messages = [user]

  const result = harness.emit('context_with_system', { messages }) as {
    messages: { role: string; content: string; sections?: Record<string, string> }[]
  }

  assert.equal(result.messages.length, 2)
  assert.equal(result.messages[0].role, 'system')
  assert.equal(result.messages[0].content, '')
  assert.match(result.messages[0].sections!.pi_rules, /Project instructions\./)
  assert.match(result.messages[0].sections!.pi_rules, /TypeScript instructions\./)
  assert.strictEqual(result.messages[1], user)
  assert.deepEqual(messages, [user])
  assert.equal(harness.engine.snapshot.injected.size, 2)
  assert.deepEqual(harness.engine.snapshot.warnings, [])
})

test('rules commands inspect disk without activating instructions and print in noninteractive mode', async () => {
  const harness = extensionHarness()
  await harness.command('rules', 'show 20-typescript.mdc')
  assert.deepEqual(harness.output, [
    `${projectRule('20-typescript.mdc')}\nTypeScript instructions.\n\n`,
  ])
  assert.equal(harness.engine.snapshot.activated.length, 0)
  assert.deepEqual(harness.engine.snapshot.warnings, [])
})

test('reload waits for idle before publishing changed active contents', async () => {
  const harness = extensionHarness()
  harness.emit('session_start')
  harness.emit('tool_call', { toolName: 'edit', input: { path: 'src/main.ts' } })
  let release!: () => void
  harness.context.waitForIdle = () =>
    new Promise<void>((resolve) => {
      release = resolve
    })
  harness.contents.set(projectRule('20-typescript.mdc'), '---\nglobs: "*.ts"\n---\nReloaded body.')
  const pending = harness.command('reload-rules')
  assert.match(harness.engine.formatRequest().text, /TypeScript instructions\./)
  assert.deepEqual(harness.output, [])
  release()
  await pending
  assert.match(harness.engine.formatRequest().text, /Reloaded body\./)
  assert.match(harness.output[0], /Reloaded: updated=1 removed=0/)
})

for (const interruption of ['session_start', 'session_shutdown']) {
  test(`pending reload is discarded after ${interruption}`, async () => {
    const harness = extensionHarness()
    harness.emit('session_start')
    let release!: () => void
    harness.context.waitForIdle = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
    const pending = harness.command('reload-rules')
    harness.emit(interruption)
    harness.contents.set(
      projectRule('10-general.mdc'),
      '---\nalwaysApply: true\n---\nChanged after interruption.',
    )
    release()
    await pending
    assert.deepEqual(harness.output, [])
    assert.equal(harness.engine.snapshot.injected.size, 0)
    assert.match(harness.engine.formatRequest().text, /Project instructions\./)
    assert.doesNotMatch(harness.engine.formatRequest().text, /Changed after interruption/)
  })
}

test('a failing notification falls back to stderr and exposes a UI diagnostic', async () => {
  const harness = extensionHarness()
  harness.context.mode = 'rpc'
  harness.context.hasUI = true
  await harness.command('rules', 'status')
  assert.match(harness.output[0], /mode=both disabled=false widget=true/)
  assert.deepEqual(
    harness.engine.snapshot.diagnostics.ui.map((item) => [item.code, item.message]),
    [['ui-failed', 'Noninteractive contexts must not notify']],
  )
  harness.context.mode = 'print'
  harness.context.hasUI = false
  await harness.command('rules')
  assert.deepEqual(harness.engine.snapshot.diagnostics.ui, [])
})
