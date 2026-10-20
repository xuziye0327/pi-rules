import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import type { Component } from '@earendil-works/pi-tui'

import type { RulesSnapshot } from '../src/rules/engine.ts'
import type { RuleObservation } from '../src/rules/types.ts'
import { RulesUI } from '../src/ui.ts'

type UIContext = Parameters<RulesUI['update']>[0]

function snapshot(overrides: Partial<RulesSnapshot> = {}): RulesSnapshot {
  return {
    sessionRoot: 'C:/project',
    config: {
      mode: 'both',
      disabled: false,
      widget: true,
      maxRuleChars: 1000,
      maxResultChars: 5000,
    },
    known: [],
    activated: [],
    injected: new Set(),
    diagnostics: {},
    warnings: [],
    ...overrides,
  }
}

function observation(
  relativePath: string,
  realPath = `C:/physical/${relativePath}`,
): RuleObservation {
  return {
    relativePath,
    realPath,
    discoveredPath: `C:/project/${relativePath}`,
    source: '.pi/rules',
    isGlobal: false,
  }
}

function screen(mode: UIContext['mode'] = 'tui', hasUI = true) {
  const notifications: { text: string; type?: 'info' | 'warning' | 'error' }[] = []
  const stderr: string[] = []
  const statuses = new Map<string, string>()
  const widgets = new Map<string, string[] | Component>()
  const ctx: UIContext = {
    mode,
    hasUI,
    ui: {
      notify(text, type) {
        notifications.push({ text, type })
      },
      setStatus(key, text) {
        if (text === undefined) statuses.delete(key)
        else statuses.set(key, text)
      },
      setWidget(key, content) {
        if (content === undefined) {
          widgets.delete(key)
        } else if (typeof content === 'function') {
          // The extension supplies a self-contained component factory with no SDK dependencies.
          widgets.set(key, (content as () => Component)())
        } else {
          widgets.set(key, content)
        }
      },
      theme: { fg: (_color, text) => `\x1b[90m${text}\x1b[39m` },
    },
  }
  return {
    ctx,
    rules: new RulesUI((text) => stderr.push(text)),
    notifications,
    stderr,
    statuses,
    widgets,
    status: () => [...statuses.values()].join('\n'),
    render: (width = 120) =>
      [...widgets.values()].flatMap((widget) =>
        Array.isArray(widget) ? widget : widget.render(width),
      ),
  }
}

for (const mode of ['tui', 'rpc'] as const) {
  test(`command output is delivered as an info notification in ${mode} with UI`, () => {
    const view = screen(mode, true)

    view.rules.output(view.ctx, 'First line\nSecond line')

    assert.deepEqual(view.notifications, [{ text: 'First line\nSecond line', type: 'info' }])
    assert.deepEqual(view.stderr, [])
  })
}

for (const { mode, hasUI } of [
  { mode: 'tui', hasUI: false },
  { mode: 'rpc', hasUI: false },
  { mode: 'json', hasUI: true },
  { mode: 'json', hasUI: false },
  { mode: 'print', hasUI: true },
  { mode: 'print', hasUI: false },
] as const) {
  test(`command output goes to stderr in ${mode} with hasUI=${hasUI}`, () => {
    const view = screen(mode, hasUI)

    view.rules.output(view.ctx, 'Rule details')

    assert.deepEqual(view.stderr, ['Rule details\n'])
    assert.deepEqual(view.notifications, [])
  })
}

test('banner displays five unique paths in discovery order, without source aliases taking a slot', () => {
  const view = screen()
  const first = observation('.pi/rules/one.md')
  const state = snapshot({
    known: [
      first,
      { ...first, source: '~/.pi/rules', relativePath: 'alias.md', isGlobal: true },
      observation('.pi/rules/two.md'),
      observation('.pi/rules/three.md'),
      observation('.pi/rules/four.md'),
      observation('.pi/rules/five.md'),
      observation('.pi/rules/six.md'),
    ],
    warnings: [{ severity: 'warning', code: 'read-failed', source: 'six.md', message: 'EACCES' }],
  })

  view.rules.update(view.ctx, state)

  assert.deepEqual(view.render().map(stripTerminalSequences), [
    '[pi-rules] 6 known · 1 warnings',
    '.pi/rules/one.md',
    '.pi/rules/two.md',
    '.pi/rules/three.md',
    '.pi/rules/four.md',
    '.pi/rules/five.md',
  ])
  assert.equal(view.status(), '[pi-rules] known=6 activated=0 injected=0 warnings=1')
})

test('an empty rule set still displays the banner and a zero-count status', () => {
  const view = screen()

  view.rules.update(view.ctx, snapshot())

  assert.deepEqual(view.render().map(stripTerminalSequences), ['[pi-rules] 0 known · 0 warnings'])
  assert.equal(view.status(), '[pi-rules] known=0 activated=0 injected=0 warnings=0')
})

for (const { width, path } of [
  { width: 0, path: '' },
  { width: 1, path: '.' },
  { width: 2, path: '..' },
  { width: 3, path: '...' },
  { width: 8, path: '规则/...' },
  { width: 12, path: '规则/😀-e\u0301.md' },
]) {
  test(`banner fits ${width} terminal columns with ANSI, wide characters and combining marks`, () => {
    const view = screen()
    view.rules.update(view.ctx, snapshot({ known: [observation('规则/😀-e\u0301.md')] }))

    const rendered = view.render(width)

    assert.equal(rendered.length, 2)
    assert.equal(stripTerminalSequences(rendered[1]), path)
    for (const line of rendered) {
      assert.ok(
        visibleWidth(line) <= width,
        `Line exceeds ${width} columns: ${JSON.stringify(line)}`,
      )
    }
  })
}

test('banner keeps themed content intact when it fits and adapts when the terminal is resized', () => {
  const view = screen()
  view.rules.update(view.ctx, snapshot({ known: [observation('规则/😀-e\u0301.md')] }))

  assert.deepEqual(view.render(80), [
    '\x1b[90m[pi-rules] 1 known · 0 warnings\x1b[39m',
    '\x1b[90m规则/😀-e\u0301.md\x1b[39m',
  ])
  assert.deepEqual(view.render(8).map(stripTerminalSequences), ['[pi-r...', '规则/...'])
  assert.deepEqual(view.render(80).map(stripTerminalSequences), [
    '[pi-rules] 1 known · 0 warnings',
    '规则/😀-e\u0301.md',
  ])
})

test('collapse removes the banner while status continues to reflect later snapshots', () => {
  const view = screen()
  view.rules.update(view.ctx, snapshot({ known: [observation('one.md')] }))

  view.rules.collapse()
  view.rules.update(view.ctx, snapshot({ known: [observation('one.md'), observation('two.md')] }))

  assert.deepEqual(view.render(), [])
  assert.equal(view.status(), '[pi-rules] known=2 activated=0 injected=0 warnings=0')
})

test('start restores a collapsed banner using the current snapshot', () => {
  const view = screen()
  view.rules.update(view.ctx, snapshot({ known: [observation('old.md')] }))
  view.rules.collapse()
  view.rules.update(view.ctx, snapshot())
  assert.deepEqual(view.render(), [])

  view.rules.start()
  view.rules.update(view.ctx, snapshot({ known: [observation('current.md')] }))

  assert.deepEqual(view.render().map(stripTerminalSequences), [
    '[pi-rules] 1 known · 0 warnings',
    'current.md',
  ])
  assert.equal(view.status(), '[pi-rules] known=1 activated=0 injected=0 warnings=0')
})

for (const { mode, hasUI, widget } of [
  { mode: 'rpc', hasUI: true, widget: true },
  { mode: 'rpc', hasUI: false, widget: true },
  { mode: 'json', hasUI: true, widget: true },
  { mode: 'print', hasUI: true, widget: true },
  { mode: 'tui', hasUI: false, widget: true },
  { mode: 'tui', hasUI: true, widget: false },
] as const) {
  test(`no banner or status is installed in ${mode}, hasUI=${hasUI}, widget=${widget}`, () => {
    const view = screen(mode, hasUI)
    const state = snapshot()
    state.config.widget = widget

    view.rules.update(view.ctx, state)

    assert.deepEqual(view.render(), [])
    assert.equal(view.status(), '')
    assert.deepEqual(view.notifications, [])
    assert.deepEqual(view.stderr, [])
  })
}

for (const { mode, hasUI, widget } of [
  { mode: 'rpc', hasUI: true, widget: true },
  { mode: 'json', hasUI: true, widget: true },
  { mode: 'print', hasUI: false, widget: true },
  { mode: 'tui', hasUI: false, widget: true },
  { mode: 'tui', hasUI: true, widget: false },
] as const) {
  test(`an installed banner and status are cleared after switching to ${mode}, hasUI=${hasUI}, widget=${widget}`, () => {
    const view = screen()
    view.rules.update(view.ctx, snapshot({ known: [observation('one.md')] }))
    assert.deepEqual(view.render().map(stripTerminalSequences), [
      '[pi-rules] 1 known · 0 warnings',
      'one.md',
    ])
    const state = snapshot()
    state.config.widget = widget
    view.ctx.mode = mode
    view.ctx.hasUI = hasUI

    view.rules.update(view.ctx, state)

    assert.deepEqual(view.render(), [])
    assert.equal(view.status(), '')
  })
}

for (const config of [
  { mode: 'off', disabled: false },
  { mode: 'both', disabled: true },
  { mode: 'off', disabled: true },
] as const) {
  test(`injection stopped remains visible with mode=${config.mode}, disabled=${config.disabled}`, () => {
    const view = screen()
    const state = snapshot({ known: [observation('one.md')] })
    state.config = { ...state.config, ...config }

    view.rules.update(view.ctx, state)

    assert.equal(
      view.status(),
      '[pi-rules] known=1 activated=0 injected=0 warnings=0 [injection stopped]',
    )
    assert.deepEqual(view.render().map(stripTerminalSequences), [
      '[pi-rules] 1 known · 0 warnings',
      'one.md',
    ])
  })
}

test('clearing removes only the rules UI, leaving other extension content visible', () => {
  const view = screen()
  view.statuses.set('other-extension', 'Other status')
  view.widgets.set('other-extension', ['Other banner'])
  view.rules.update(view.ctx, snapshot())

  view.rules.clear(view.ctx)

  assert.deepEqual(view.render(), ['Other banner'])
  assert.equal(view.status(), 'Other status')
})

test('clear resets installed state so repeated clears cannot erase a later owner’s UI', () => {
  const view = screen()
  view.rules.update(view.ctx, snapshot({ known: [observation('old.md')] }))
  view.rules.clear(view.ctx)
  assert.deepEqual(view.render(), [])
  assert.equal(view.status(), '')

  const replacement = new RulesUI()
  replacement.update(view.ctx, snapshot({ known: [observation('replacement.md')] }))
  view.rules.clear(view.ctx)

  assert.deepEqual(view.render().map(stripTerminalSequences), [
    '[pi-rules] 1 known · 0 warnings',
    'replacement.md',
  ])
  assert.equal(view.status(), '[pi-rules] known=1 activated=0 injected=0 warnings=0')
})

test('enabling the widget again restores the banner and status after clearing', () => {
  const view = screen()
  const state = snapshot({ known: [observation('one.md')] })
  view.rules.update(view.ctx, state)
  view.rules.update(view.ctx, { ...state, config: { ...state.config, widget: false } })
  assert.deepEqual(view.render(), [])
  assert.equal(view.status(), '')

  view.rules.update(view.ctx, state)

  assert.deepEqual(view.render().map(stripTerminalSequences), [
    '[pi-rules] 1 known · 0 warnings',
    'one.md',
  ])
  assert.equal(view.status(), '[pi-rules] known=1 activated=0 injected=0 warnings=0')
})
