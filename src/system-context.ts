import type { ContextWithSystemEvent } from '@earendil-works/pi-coding-agent'

type Messages = ContextWithSystemEvent['messages']

/** Replace only this extension's request-local section, preserving transcript deltas. */
export function replaceRulesSection(messages: readonly Messages[number][], text: string): Messages {
  if (messages[0]?.role !== 'system') {
    throw new Error('pi-rules requires a leading system message')
  }

  return messages.map((message, index) => {
    if (message.role !== 'system') return message

    const sections = { ...message.sections }
    delete sections.pi_rules
    if (index === 0 && text !== '') sections.pi_rules = text

    const copy = { ...message }
    if (message.sections !== undefined || Object.keys(sections).length > 0) {
      copy.sections = sections
    }
    return copy
  })
}
