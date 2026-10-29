import type { ContextWithSystemEvent } from '@earendil-works/pi-coding-agent'

type Messages = ContextWithSystemEvent['messages']

/** Replace only this extension's request-local section, preserving transcript deltas. */
export function replaceRulesSection(messages: readonly Messages[number][], text: string): Messages {
  const result = messages.map((message, index) => {
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

  if (messages[0]?.role !== 'system' && text !== '') {
    result.unshift({
      role: 'system',
      content: '',
      sections: { pi_rules: text },
      timestamp: messages[0]?.timestamp ?? Date.now(),
    })
  }
  return result
}
