import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatRules } from '../src/rules/formatter.ts'
import type { LoadedRule } from '../src/rules/types.ts'

function rule(path: string, body: string): LoadedRule {
  return {
    discoveredPath: path,
    realPath: path,
    source: '.pi/rules',
    relativePath: path.slice(1),
    isGlobal: false,
    metadata: { alwaysApply: true, globs: [] },
    body,
    contentHash: `content:${path}`,
    ruleKey: `rule:${path}`,
  }
}

test('no rules produce no wrapper or bookkeeping entries', () => {
  assert.deepEqual(formatRules([], { maxRuleChars: 100, maxResultChars: 1000 }), {
    text: '',
    included: [],
    omitted: [],
    diagnostics: [],
  })
})

test('rule blocks retain caller priority, source attributes, and body whitespace', () => {
  const high = rule('/z', '  Higher priority\n')
  const low = rule('/a', 'Lower priority')
  const result = formatRules([high, low], { maxRuleChars: 100, maxResultChars: 1000 })

  assert.deepEqual(result, {
    text: '<pi_rules>\n<rule source="/z">\n  Higher priority\n\n</rule>\n\n<rule source="/a">\nLower priority\n</rule>\n</pi_rules>',
    included: [
      { rule: high, truncated: false },
      { rule: low, truncated: false },
    ],
    omitted: [],
    diagnostics: [],
  })
})

test('source attributes are escaped and their full length counts toward the total budget', () => {
  const candidate = rule('/rules/"a&<b>".mdc', 'A')
  const expected =
    '<pi_rules>\n<rule source="/rules/&quot;a&amp;&lt;b&gt;&quot;.mdc">\nA\n</rule>\n</pi_rules>'
  const exact = formatRules([candidate], { maxRuleChars: 1, maxResultChars: expected.length })
  const short = formatRules([candidate], { maxRuleChars: 1, maxResultChars: expected.length - 1 })

  assert.equal(exact.text, expected)
  assert.equal(short.text, '')
  assert.deepEqual(short.omitted, [candidate])
})

test('an exact total budget includes both wrappers and the full body', () => {
  const candidate = rule('/a', 'A')
  // The outer wrapper uses 23 characters and this rule wrapper uses 27.
  const result = formatRules([candidate], { maxRuleChars: 1, maxResultChars: 51 })

  assert.deepEqual(result, {
    text: '<pi_rules>\n<rule source="/a">\nA\n</rule>\n</pi_rules>',
    included: [{ rule: candidate, truncated: false }],
    omitted: [],
    diagnostics: [],
  })
  assert.equal(result.text.length, 51)
})

test('one character below the full budget omits a body that cannot fit a truncation notice', () => {
  const candidate = rule('/a', 'A')

  assert.deepEqual(formatRules([candidate], { maxRuleChars: 1, maxResultChars: 50 }), {
    text: '',
    included: [],
    omitted: [candidate],
    diagnostics: [
      {
        severity: 'warning',
        code: 'rule-omitted',
        source: '/a',
        message:
          'Rule omitted because its wrapper or minimum body does not fit the character budgets.',
      },
    ],
  })
})

test('an empty body fits when the total budget has room for exactly both wrappers', () => {
  const candidate = rule('/a', '')

  assert.deepEqual(formatRules([candidate], { maxRuleChars: 1, maxResultChars: 50 }), {
    text: '<pi_rules>\n<rule source="/a">\n\n</rule>\n</pi_rules>',
    included: [{ rule: candidate, truncated: false }],
    omitted: [],
    diagnostics: [],
  })
})

for (const { name, maxRuleChars, maxResultChars } of [
  { name: 'per-rule', maxRuleChars: 42, maxResultChars: 200 },
  { name: 'total', maxRuleChars: 200, maxResultChars: 92 },
]) {
  test(`the ${name} budget truncates the body while reserving the full-rule notice`, () => {
    const candidate = rule('/a', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
    const result = formatRules([candidate], { maxRuleChars, maxResultChars })

    assert.deepEqual(result, {
      text: '<pi_rules>\n<rule source="/a">\nabcd\n\n[Rule truncated. Read full rule: /a]\n</rule>\n</pi_rules>',
      included: [{ rule: candidate, truncated: true }],
      omitted: [],
      diagnostics: [
        {
          severity: 'warning',
          code: 'rule-truncated',
          source: '/a',
          message: 'Rule truncated to fit the character budgets; the full-rule notice is included.',
        },
      ],
    })
    assert.equal(result.text.length, 92)
    assert.equal(candidate.body, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
  })
}

test('higher-priority truncation spends the total budget before lower-priority rules', () => {
  const high = rule('/a', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
  const low = rule('/b', 'B')
  const result = formatRules([high, low], { maxRuleChars: 100, maxResultChars: 92 })

  assert.equal(
    result.text,
    '<pi_rules>\n<rule source="/a">\nabcd\n\n[Rule truncated. Read full rule: /a]\n</rule>\n</pi_rules>',
  )
  assert.deepEqual(result.included, [{ rule: high, truncated: true }])
  assert.deepEqual(result.omitted, [low])
  assert.deepEqual(
    result.diagnostics.map(({ code, source }) => ({ code, source })),
    [
      { code: 'rule-truncated', source: '/a' },
      { code: 'rule-omitted', source: '/b' },
    ],
  )
})

test('an omitted rule wrapper spends neither budget nor an entry separator', () => {
  const tooLong = rule('/very-long-source-path', 'A')
  const fitting = rule('/a', 'A')
  const result = formatRules([tooLong, fitting], { maxRuleChars: 1, maxResultChars: 51 })

  assert.equal(result.text, '<pi_rules>\n<rule source="/a">\nA\n</rule>\n</pi_rules>')
  assert.deepEqual(result.included, [{ rule: fitting, truncated: false }])
  assert.deepEqual(result.omitted, [tooLong])
  assert.deepEqual(
    result.diagnostics.map(({ code, source }) => ({ code, source })),
    [{ code: 'rule-omitted', source: '/very-long-source-path' }],
  )
})

test('an omitted middle body leaves the remaining budget available to a later rule', () => {
  const first = rule('/a', 'first')
  const omitted = rule('/b', 'This cannot fit a notice.')
  const last = rule('/c', 'end')
  const result = formatRules([first, omitted, last], { maxRuleChars: 5, maxResultChars: 87 })

  assert.equal(
    result.text,
    '<pi_rules>\n<rule source="/a">\nfirst\n</rule>\n\n<rule source="/c">\nend\n</rule>\n</pi_rules>',
  )
  assert.equal(result.text.length, 87)
  assert.deepEqual(result.included, [
    { rule: first, truncated: false },
    { rule: last, truncated: false },
  ])
  assert.deepEqual(result.omitted, [omitted])
  assert.deepEqual(
    result.diagnostics.map(({ code, source }) => ({ code, source })),
    [{ code: 'rule-omitted', source: '/b' }],
  )
})

for (const { name, maxRuleChars, expectedBody } of [
  {
    name: 'backs up before a surrogate pair rather than including its high surrogate',
    maxRuleChars: 42,
    expectedBody: 'abc\n\n[Rule truncated. Read full rule: /a]',
  },
  {
    name: 'keeps a complete surrogate pair when it fits',
    maxRuleChars: 43,
    expectedBody: 'abc\u{1D400}\n\n[Rule truncated. Read full rule: /a]',
  },
]) {
  test(`truncation ${name}`, () => {
    const candidate = rule('/a', 'abc\u{1D400}' + 'x'.repeat(50))
    const result = formatRules([candidate], { maxRuleChars, maxResultChars: 200 })

    assert.equal(
      result.text,
      `<pi_rules>\n<rule source="/a">\n${expectedBody}\n</rule>\n</pi_rules>`,
    )
    assert.deepEqual(result.included, [{ rule: candidate, truncated: true }])
    assert.deepEqual(result.omitted, [])
    assert.deepEqual(
      result.diagnostics.map(({ code, source }) => ({ code, source })),
      [{ code: 'rule-truncated', source: '/a' }],
    )
  })
}

test('the notice alone is not enough to include a truncated rule', () => {
  const candidate = rule('/a', 'x'.repeat(50))
  const result = formatRules([candidate], { maxRuleChars: 38, maxResultChars: 200 })

  assert.equal(result.text, '')
  assert.deepEqual(result.included, [])
  assert.deepEqual(result.omitted, [candidate])
  assert.deepEqual(
    result.diagnostics.map(({ code, source }) => ({ code, source })),
    [{ code: 'rule-omitted', source: '/a' }],
  )
})

test('one body character plus the complete notice is enough to include a truncated rule', () => {
  const candidate = rule('/a', 'x'.repeat(50))
  const result = formatRules([candidate], { maxRuleChars: 39, maxResultChars: 200 })

  assert.equal(
    result.text,
    '<pi_rules>\n<rule source="/a">\nx\n\n[Rule truncated. Read full rule: /a]\n</rule>\n</pi_rules>',
  )
  assert.deepEqual(result.included, [{ rule: candidate, truncated: true }])
  assert.deepEqual(result.omitted, [])
  assert.deepEqual(
    result.diagnostics.map(({ code, source }) => ({ code, source })),
    [{ code: 'rule-truncated', source: '/a' }],
  )
})

test('a surrogate pair is omitted when the truncation budget cannot keep any complete character', () => {
  const candidate = rule('/a', '\u{1D400}' + 'x'.repeat(50))
  const result = formatRules([candidate], { maxRuleChars: 39, maxResultChars: 200 })

  assert.equal(result.text, '')
  assert.deepEqual(result.included, [])
  assert.deepEqual(result.omitted, [candidate])
  assert.deepEqual(
    result.diagnostics.map(({ code, source }) => ({ code, source })),
    [{ code: 'rule-omitted', source: '/a' }],
  )
})
