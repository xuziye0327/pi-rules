import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readConfiguration } from '../src/rules/config.ts'

test('missing settings resolve to enabled defaults without diagnostics', () => {
  assert.deepEqual(readConfiguration({}, {}), {
    config: {
      mode: 'both',
      widget: true,
      disabled: false,
      maxRuleChars: 12000,
      maxResultChars: 40000,
    },
    diagnostics: [],
  })
})

for (const mode of ['static', 'dynamic', 'both', 'off']) {
  test(`the ${mode} mode flag is accepted without changing other settings`, () => {
    assert.deepEqual(readConfiguration({}, { mode }), {
      config: {
        mode,
        widget: true,
        disabled: false,
        maxRuleChars: 12000,
        maxResultChars: 40000,
      },
      diagnostics: [],
    })
  })
}

for (const { value, expected } of [
  { value: 'true', expected: true },
  { value: 'false', expected: false },
]) {
  test(`the widget string ${value} resolves to a boolean`, () => {
    const result = readConfiguration({}, { widget: value })

    assert.equal(result.config.widget, expected)
    assert.deepEqual(result.diagnostics, [])
  })
}

for (const { name, flags, expectedSource, expectedMessage } of [
  {
    name: 'uppercase mode',
    flags: { mode: 'STATIC' },
    expectedSource: '--pi-rules-mode',
    expectedMessage: 'Expected static, dynamic, both, or off; using both.',
  },
  {
    name: 'non-string mode',
    flags: { mode: true },
    expectedSource: '--pi-rules-mode',
    expectedMessage: 'Expected static, dynamic, both, or off; using both.',
  },
  {
    name: 'boolean widget',
    flags: { widget: false },
    expectedSource: '--pi-rules-widget',
    expectedMessage: 'Expected the string true or false; using true.',
  },
  {
    name: 'uppercase widget',
    flags: { widget: 'FALSE' },
    expectedSource: '--pi-rules-widget',
    expectedMessage: 'Expected the string true or false; using true.',
  },
  {
    name: 'string disabled flag',
    flags: { disabled: 'true' },
    expectedSource: '--pi-rules-disabled',
    expectedMessage: 'Expected a boolean presence flag; using false for the flag.',
  },
  {
    name: 'numeric disabled flag',
    flags: { disabled: 1 },
    expectedSource: '--pi-rules-disabled',
    expectedMessage: 'Expected a boolean presence flag; using false for the flag.',
  },
]) {
  test(`an invalid ${name} warns and uses the setting's fallback`, () => {
    assert.deepEqual(readConfiguration({}, flags), {
      config: {
        mode: 'both',
        widget: true,
        disabled: false,
        maxRuleChars: 12000,
        maxResultChars: 40000,
      },
      diagnostics: [
        {
          severity: 'warning',
          code: 'invalid-config',
          source: expectedSource,
          message: expectedMessage,
        },
      ],
    })
  })
}

for (const value of ['1', ' true ', 'YES', '\tOn\n']) {
  test(`environment disable ${JSON.stringify(value)} takes precedence over a false flag`, () => {
    const result = readConfiguration({ PI_RULES_DISABLED: value }, { disabled: false, mode: 'both' })

    assert.equal(result.config.disabled, true)
    assert.equal(result.config.mode, 'both')
    assert.deepEqual(result.diagnostics, [])
  })
}

for (const value of [undefined, '', '0', 'false', 'no', 'off', 'anything']) {
  test(`environment value ${JSON.stringify(value)} does not disable rules by itself`, () => {
    const result = readConfiguration({ PI_RULES_DISABLED: value }, { disabled: false })

    assert.equal(result.config.disabled, false)
    assert.deepEqual(result.diagnostics, [])
  })
}

test('a true disable flag takes precedence over an inactive environment setting', () => {
  const result = readConfiguration({ PI_RULES_DISABLED: 'false' }, { disabled: true })

  assert.equal(result.config.disabled, true)
  assert.deepEqual(result.diagnostics, [])
})

test('environment disable still applies when the disable flag has an invalid type', () => {
  const result = readConfiguration({ PI_RULES_DISABLED: 'yes' }, { disabled: 'false' })

  assert.equal(result.config.disabled, true)
  assert.deepEqual(result.diagnostics, [
    {
      severity: 'warning',
      code: 'invalid-config',
      source: '--pi-rules-disabled',
      message: 'Expected a boolean presence flag; using false for the flag.',
    },
  ])
})

test('trimmed decimal budgets accept one, leading zeros, and the safe-integer boundary', () => {
  assert.deepEqual(
    readConfiguration(
      { PI_RULES_MAX_RULE_CHARS: ' 0001 ', PI_RULES_MAX_RESULT_CHARS: '9007199254740991' },
      { mode: 'dynamic', widget: 'false' },
    ),
    {
      config: {
        mode: 'dynamic',
        widget: false,
        disabled: false,
        maxRuleChars: 1,
        maxResultChars: 9007199254740991,
      },
      diagnostics: [],
    },
  )
})

for (const value of [
  '',
  '   ',
  '0',
  '-1',
  '+2',
  '1.5',
  '1e3',
  '0x10',
  'Infinity',
  'NaN',
  '9007199254740992',
]) {
  test(`invalid budget ${JSON.stringify(value)} falls back and identifies both environment keys`, () => {
    const result = readConfiguration(
      { PI_RULES_MAX_RULE_CHARS: value, PI_RULES_MAX_RESULT_CHARS: value },
      { mode: 'static', widget: 'false' },
    )

    assert.deepEqual(result, {
      config: {
        mode: 'static',
        widget: false,
        disabled: false,
        maxRuleChars: 12000,
        maxResultChars: 40000,
      },
      diagnostics: [
        {
          severity: 'warning',
          code: 'invalid-config',
          source: 'PI_RULES_MAX_RULE_CHARS',
          message: 'Expected a positive decimal safe integer; using 12000.',
        },
        {
          severity: 'warning',
          code: 'invalid-config',
          source: 'PI_RULES_MAX_RESULT_CHARS',
          message: 'Expected a positive decimal safe integer; using 40000.',
        },
      ],
    })
  })
}

test('invalid flags preserve unrelated valid flags and budgets', () => {
  assert.deepEqual(
    readConfiguration(
      { PI_RULES_MAX_RULE_CHARS: '100', PI_RULES_MAX_RESULT_CHARS: '200' },
      { mode: 'dynamic', widget: false, disabled: true },
    ),
    {
      config: {
        mode: 'dynamic',
        widget: true,
        disabled: true,
        maxRuleChars: 100,
        maxResultChars: 200,
      },
      diagnostics: [
        {
          severity: 'warning',
          code: 'invalid-config',
          source: '--pi-rules-widget',
          message: 'Expected the string true or false; using true.',
        },
      ],
    },
  )
})

test('a bad per-rule budget does not replace a valid total budget', () => {
  const result = readConfiguration(
    { PI_RULES_MAX_RULE_CHARS: '0', PI_RULES_MAX_RESULT_CHARS: '500' },
    {},
  )

  assert.equal(result.config.maxRuleChars, 12000)
  assert.equal(result.config.maxResultChars, 500)
  assert.deepEqual(
    result.diagnostics.map(({ code, source }) => ({ code, source })),
    [{ code: 'invalid-config', source: 'PI_RULES_MAX_RULE_CHARS' }],
  )
})
