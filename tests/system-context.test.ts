import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ContextWithSystemEvent } from '@earendil-works/pi-coding-agent'

import { replaceRulesSection } from '../src/system-context.ts'

type Message = ContextWithSystemEvent['messages'][number]
type SystemMessage = Extract<Message, { role: 'system' }>

function asSystem(message: Message): SystemMessage {
  assert.ok(message.role === 'system', 'Expected a system message in the preserved transcript')
  return message
}

for (const { name, messages } of [
  { name: 'an empty transcript', messages: [] },
  {
    name: 'a user message before the system message',
    messages: [
      { role: 'user', content: 'Hello', timestamp: 1 },
      { role: 'system', content: 'Late prompt', timestamp: 2 },
    ],
  },
] satisfies { name: string; messages: Message[] }[]) {
  test(`replacement rejects ${name}`, () => {
    assert.throws(() => replaceRulesSection(messages, 'New rules'), {
      name: 'Error',
      message: 'pi-rules requires a leading system message',
    })
  })
}

test('replacement adds request-local rules without rewriting the leading prompt', () => {
  const leading: SystemMessage = Object.freeze({
    role: 'system',
    content: 'Base prompt with literal <pi_rules>transcript text</pi_rules>.',
    timestamp: 1,
  })
  const original = Object.freeze([leading])

  const result = replaceRulesSection(original, '<pi_rules>Use strict checks.</pi_rules>')

  assert.deepEqual(result, [
    {
      role: 'system',
      content: 'Base prompt with literal <pi_rules>transcript text</pi_rules>.',
      timestamp: 1,
      sections: { pi_rules: '<pi_rules>Use strict checks.</pi_rules>' },
    },
  ])
  assert.notStrictEqual(result, original)
  assert.notStrictEqual(result[0], leading)
  assert.equal(Object.hasOwn(leading, 'sections'), false)
})

test('replacement updates only the leading rules section and removes stale later rules deltas', () => {
  const leading: SystemMessage = Object.freeze<SystemMessage>({
    role: 'system',
    content: [{ type: 'text', text: 'Base prompt' }],
    sections: Object.freeze({ pi_rules: 'Old rules', safety: 'Keep safety policy', removed: null }),
    toolsAdded: [
      { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: {} } },
    ],
    timestamp: 1,
  })
  const user: Message = Object.freeze({ role: 'user', content: 'Change src/main.ts', timestamp: 2 })
  const delta: SystemMessage = Object.freeze({
    role: 'system',
    content: 'Additional instructions, including literal pi_rules text.',
    sections: Object.freeze({ pi_rules: 'Stale delta', safety: null, other: 'Keep this delta' }),
    toolsRemoved: [{ name: 'read' }],
    timestamp: 3,
  })
  const tombstone: SystemMessage = Object.freeze({
    role: 'system',
    content: '',
    sections: Object.freeze({ pi_rules: null }),
    timestamp: 4,
  })
  const noSections: SystemMessage = Object.freeze({
    role: 'system',
    content: 'Tool-only update',
    toolsRemoved: [{ name: 'write' }],
    timestamp: 5,
  })
  const original = Object.freeze([leading, user, delta, tombstone, noSections])
  const before = structuredClone(original)

  const result = replaceRulesSection(original, 'Current request rules')

  assert.deepEqual(result, [
    {
      ...leading,
      sections: { safety: 'Keep safety policy', removed: null, pi_rules: 'Current request rules' },
    },
    user,
    { ...delta, sections: { safety: null, other: 'Keep this delta' } },
    { ...tombstone, sections: {} },
    noSections,
  ])
  assert.notStrictEqual(asSystem(result[0]).sections, leading.sections)
  assert.notStrictEqual(asSystem(result[2]).sections, delta.sections)
  assert.notStrictEqual(result[2], delta)
  assert.strictEqual(asSystem(result[0]).content, leading.content)
  assert.strictEqual(asSystem(result[0]).toolsAdded, leading.toolsAdded)
  assert.strictEqual(asSystem(result[2]).toolsRemoved, delta.toolsRemoved)
  assert.equal(leading.sections!.pi_rules, 'Old rules')
  assert.equal(delta.sections!.pi_rules, 'Stale delta')
  assert.deepEqual(tombstone.sections, { pi_rules: null })
  assert.equal(Object.hasOwn(result[4], 'sections'), false)
  assert.deepEqual(original, before)
})

test('replacement preserves user, assistant and tool-result objects and their content in order', () => {
  const leading: SystemMessage = { role: 'system', content: 'Base', timestamp: 1 }
  const transcript: Message[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Literal <pi_rules>user content</pi_rules>' },
        { type: 'image', data: 'c3ludGhldGlj', mimeType: 'image/png' },
      ],
      timestamp: 2,
    },
    {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'src/main.ts' } },
      ],
      api: 'openai-completions',
      provider: 'openai',
      model: 'synthetic-model',
      stopReason: 'toolUse',
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 3,
    },
    {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read',
      content: [{ type: 'text', text: 'File includes pi_rules; retain it verbatim.' }],
      details: { lines: 1 },
      isError: false,
      timestamp: 4,
    },
  ]
  const before = structuredClone(transcript)
  const original = Object.freeze([leading, ...transcript.map((message) => Object.freeze(message))])

  const result = replaceRulesSection(original, 'Request rules')

  assert.deepEqual(result.slice(1), before)
  assert.strictEqual(result[1], transcript[0])
  assert.strictEqual(result[2], transcript[1])
  assert.strictEqual(result[3], transcript[2])
  assert.deepEqual(transcript, before)
})

test('empty rules remove leading and later rules sections while retaining unrelated sections', () => {
  const leading: SystemMessage = Object.freeze({
    role: 'system',
    content: 'Base',
    sections: Object.freeze({ pi_rules: 'Old', safety: 'Retain' }),
    timestamp: 1,
  })
  const delta: SystemMessage = Object.freeze({
    role: 'system',
    content: 'Delta',
    sections: Object.freeze({ pi_rules: 'Stale', other: null }),
    timestamp: 2,
  })

  assert.deepEqual(replaceRulesSection([leading, delta], ''), [
    { role: 'system', content: 'Base', sections: { safety: 'Retain' }, timestamp: 1 },
    { role: 'system', content: 'Delta', sections: { other: null }, timestamp: 2 },
  ])
  assert.deepEqual(leading.sections, { pi_rules: 'Old', safety: 'Retain' })
  assert.deepEqual(delta.sections, { pi_rules: 'Stale', other: null })
})

test('empty rules preserve absence of sections but retain an explicitly empty section map', () => {
  const original: SystemMessage[] = [
    { role: 'system', content: 'Base', timestamp: 1 },
    { role: 'system', content: 'Delta', sections: {}, timestamp: 2 },
  ]

  const result = replaceRulesSection(original, '')

  assert.deepEqual(result, original)
  assert.equal(Object.hasOwn(result[0], 'sections'), false)
  assert.deepEqual(asSystem(result[1]).sections, {})
  assert.notStrictEqual(asSystem(result[1]).sections, original[1].sections)
})

test('separate requests cannot change source sections or rules from another request', () => {
  const original: SystemMessage[] = [
    {
      role: 'system',
      content: 'Base',
      sections: { pi_rules: 'Original', shared: 'Keep' },
      timestamp: 1,
    },
  ]
  const first = replaceRulesSection(original, 'First request')
  const second = replaceRulesSection(original, 'Second request')

  asSystem(first[0]).sections!.shared = 'Changed only in first result'

  assert.deepEqual(asSystem(second[0]).sections, { shared: 'Keep', pi_rules: 'Second request' })
  assert.deepEqual(original[0].sections, { pi_rules: 'Original', shared: 'Keep' })
  assert.deepEqual(asSystem(first[0]).sections, {
    shared: 'Changed only in first result',
    pi_rules: 'First request',
  })
})
