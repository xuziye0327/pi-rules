import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ruleCompletions, rulesCommand, rulesSummary } from '../src/commands.ts'
import type { RulesSnapshot } from '../src/rules/engine.ts'
import type { LoadedRule, RuleObservation } from '../src/rules/types.ts'

function observation(overrides: Partial<RuleObservation> = {}): RuleObservation {
  const candidate = {
    realPath: 'C:/physical/style guide.md',
    discoveredPath: 'C:/project/.pi/rules/style guide.md',
    relativePath: '.pi/rules/style guide.md',
    source: '.pi/rules' as const,
    isGlobal: false,
    ...overrides,
  }
  return {
    ...candidate,
    rule: {
      ...candidate,
      body: 'Use descriptive names.\nKeep changes focused.',
      metadata: { alwaysApply: false, globs: ['src/**'] },
      contentHash: 'style-v1',
      ruleKey: 'style:style-v1',
    },
    ...overrides,
  }
}

function snapshot(overrides: Partial<RulesSnapshot> = {}): RulesSnapshot {
  return {
    sessionRoot: 'C:/project',
    config: {
      mode: 'both',
      disabled: false,
      widget: true,
      maxRuleChars: 1200,
      maxResultChars: 4000,
    },
    known: [],
    activated: [],
    injected: new Set(),
    diagnostics: {},
    warnings: [],
    ...overrides,
  }
}

test('summary counts physical rules once while keeping activation, injection and warning counts', () => {
  const local = observation()
  const alias = observation({
    source: '~/.pi/rules',
    isGlobal: true,
    discoveredPath: 'C:/home/.pi/rules/alias.md',
  })
  const unreadable = observation({
    realPath: 'C:/physical/broken.md',
    rule: undefined,
    error: 'EACCES',
  })
  const state = snapshot({
    known: [local, alias, unreadable],
    activated: [local.rule!],
    injected: new Set(['style:style-v1']),
    warnings: [{ severity: 'warning', code: 'read-failed', source: 'broken.md', message: 'EACCES' }],
  })

  assert.equal(rulesSummary(state), '[pi-rules] known=2 activated=1 injected=1 warnings=1')
  assert.equal(rulesCommand(' \n\t ', state), '[pi-rules] known=2 activated=1 injected=1 warnings=1')
})

test('paths lists each physical path in first-seen order, including unreadable rules', () => {
  const state = snapshot({
    known: [
      observation(),
      observation({ source: '~/.pi/rules', discoveredPath: 'C:/home/.pi/rules/alias.md' }),
      observation({ realPath: 'C:/physical/broken.md', rule: undefined, error: 'EACCES' }),
    ],
  })

  assert.equal(rulesCommand('  paths  ', state), 'C:/physical/style guide.md\nC:/physical/broken.md')
})

test('list retains source aliases with physical activation and per-version injection details', () => {
  const local = observation({ matchReason: 'glob src/**', targets: ['src/a.ts', 'src/b.ts'] })
  const global = observation({ source: '~/.pi/rules', isGlobal: true })
  const unreadable = observation({
    realPath: 'C:/physical/broken.md',
    rule: undefined,
    error: 'EACCES',
  })
  const state = snapshot({
    known: [local, global, unreadable],
    activated: [local.rule!],
    injected: new Set(['style:style-v1']),
  })

  assert.equal(
    rulesCommand('list', state),
    [
      'C:/physical/style guide.md',
      '  source=.pi/rules active=true injected=true match=glob src/** for src/a.ts, src/b.ts',
      'C:/physical/style guide.md',
      '  source=~/.pi/rules active=true injected=true match=none (last edit/write targets)',
      'C:/physical/broken.md',
      '  source=.pi/rules active=false injected=false match=none (last edit/write targets) unreadable=EACCES',
    ].join('\n'),
  )
})

test('list does not mark a newly loaded rule version as injected by an older version', () => {
  const item = observation()
  const current: LoadedRule = { ...item.rule!, contentHash: 'style-v2', ruleKey: 'style:style-v2' }
  const state = snapshot({
    known: [{ ...item, rule: current }],
    injected: new Set(['style:style-v1']),
  })

  assert.equal(
    rulesCommand('list', state),
    'C:/physical/style guide.md\n  source=.pi/rules active=false injected=false match=none (last edit/write targets)',
  )
})

for (const command of ['paths', 'list']) {
  test(`${command} explains that no rules are known`, () => {
    assert.equal(rulesCommand(command, snapshot()), '[pi-rules] No known rules.')
  })
}

for (const id of [
  'C:/physical/style guide.md',
  '"C:/physical/style guide.md"',
  "'C:/physical/style guide.md'",
  '"C:\\physical\\style guide.md"',
  '.pi/rules/style guide.md',
  '.pi\\rules\\style guide.md',
  'style guide.md',
  'rules/style guide.md',
  'project/.pi/rules/style guide.md',
]) {
  test(`show resolves ${JSON.stringify(id)} to the rule body without alias ambiguity`, () => {
    const state = snapshot({
      known: [observation(), observation({ source: '~/.pi/rules', isGlobal: true })],
    })

    assert.equal(
      rulesCommand(`  show  ${id}  `, state),
      'C:/physical/style guide.md\nUse descriptive names.\nKeep changes focused.',
    )
  })
}

test('show prefers an exact physical path over a conflicting relative ID', () => {
  const exact = observation()
  // IDs are compared as strings; this collision distinguishes exact lookup from suffix lookup.
  const other = observation({
    realPath: 'D:/other.md',
    relativePath: 'C:/physical/style guide.md',
  })

  assert.equal(
    rulesCommand('show C:/physical/style guide.md', snapshot({ known: [other, exact] })),
    'C:/physical/style guide.md\nUse descriptive names.\nKeep changes focused.',
  )
})

test('show reports distinct physical paths for an ambiguous suffix, not source aliases', () => {
  const state = snapshot({
    known: [
      observation(),
      observation({ source: '~/.pi/rules', isGlobal: true }),
      observation({ realPath: 'D:/other/style guide.md' }),
    ],
  })

  assert.equal(
    rulesCommand('show "style guide.md"', state),
    'Ambiguous rule ID:\nC:/physical/style guide.md\nD:/other/style guide.md',
  )
})

test('show does not treat part of a filename as a path suffix', () => {
  assert.equal(
    rulesCommand('show guide.md', snapshot({ known: [observation()] })),
    'Unknown rule: guide.md',
  )
})

test('show reports an unknown quoted path using the unquoted input', () => {
  assert.equal(
    rulesCommand('show "missing path.md"', snapshot({ known: [observation()] })),
    'Unknown rule: missing path.md',
  )
})

test('show reports an unreadable rule instead of displaying an empty body', () => {
  const state = snapshot({ known: [observation({ rule: undefined, error: 'permission denied' })] })

  assert.equal(
    rulesCommand('show "style guide.md"', state),
    'Cannot read C:/physical/style guide.md: permission denied',
  )
})

for (const args of ['show', 'show  ', 'show ""', "show ''"]) {
  test(`${JSON.stringify(args)} requires a rule ID`, () => {
    assert.equal(
      rulesCommand(args, snapshot()),
      'Usage: /rules show <absolute real path, relative path or unique suffix>',
    )
  })
}

test('status reports configuration and diagnostics from every populated domain', () => {
  const state = snapshot({
    config: { mode: 'off', disabled: true, widget: false, maxRuleChars: 300, maxResultChars: 900 },
    diagnostics: {
      configuration: [
        { severity: 'warning', code: 'invalid-mode', source: 'PI_RULES_MODE', message: 'Bad mode' },
      ],
      loading: [
        {
          severity: 'warning',
          code: 'read-failed',
          source: 'broken.md',
          message: 'Permission denied',
        },
      ],
      formatting: [],
      ui: [{ severity: 'warning', code: 'ui-failed', source: 'pi-rules', message: 'Disconnected' }],
    },
    warnings: [
      {
        severity: 'warning',
        code: 'read-failed',
        source: 'broken.md',
        message: 'Permission denied',
      },
    ],
  })

  assert.equal(
    rulesCommand('status', state),
    [
      '[pi-rules] known=0 activated=0 injected=0 warnings=1',
      'mode=off disabled=true widget=false',
      'maxRuleChars=300 maxResultChars=900',
      'sessionRoot=C:/project',
      '[configuration] warning invalid-mode PI_RULES_MODE: Bad mode',
      '[loading] warning read-failed broken.md: Permission denied',
      '[ui] warning ui-failed pi-rules: Disconnected',
    ].join('\n'),
  )
})

test('unknown subcommands display usage rather than being interpreted as paths', () => {
  assert.equal(rulesCommand('reload', snapshot()), 'Usage: /rules [list|show <id>|paths|status]')
})

for (const { prefix, values } of [
  { prefix: '', values: ['list', 'show', 'paths', 'status'] },
  { prefix: 's', values: ['show', 'status'] },
  { prefix: 'sh', values: ['show'] },
  { prefix: 'st', values: ['status'] },
  { prefix: 'paths', values: ['paths'] },
]) {
  test(`completions for ${JSON.stringify(prefix)} offer matching subcommands`, () => {
    assert.deepEqual(
      ruleCompletions(prefix),
      values.map((value) => ({ value, label: value })),
    )
  })
}

for (const prefix of ['x', 'SHOW', 'show ']) {
  test(`completions return null for unmatched prefix ${JSON.stringify(prefix)}`, () => {
    assert.equal(ruleCompletions(prefix), null)
  })
}
