import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { ruleCompletions, rulesCommand, rulesSummary } from './commands.ts'
import { RulesEngine } from './rules/engine.ts'
import type { EngineOptions } from './rules/engine.ts'
import { replaceRulesSection } from './system-context.ts'
import { RulesUI } from './ui.ts'

export interface ExtensionOptions extends EngineOptions {
  stderr?: (text: string) => void
}

export function toolTargets(event: {
  toolName: string
  input: unknown
  parentToolCallId?: string
}): string[] {
  if (
    event.parentToolCallId !== undefined ||
    (event.toolName !== 'edit' && event.toolName !== 'write')
  )
    return []
  const input: unknown = event.input
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return []
  const record = input as Record<string, unknown>
  const paths = event.toolName === 'write' ? [record.filePath, record.path] : [record.path]
  return paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
}

/** Injectable filesystem, home, environment and output boundaries for embedding and tests. */
export function registerRules(pi: ExtensionAPI, options: ExtensionOptions = {}): RulesEngine {
  const engine = new RulesEngine(options)
  const ui = new RulesUI(options.stderr)
  let generation = 0
  const sync = (ctx: ExtensionContext) => {
    engine.syncFlags({
      disabled: pi.getFlag('pi-rules-disabled'),
      mode: pi.getFlag('pi-rules-mode'),
      widget: pi.getFlag('pi-rules-widget'),
    })
    if (!engine.snapshot.sessionRoot) engine.startSession(ctx.cwd)
  }
  const update = (ctx: ExtensionContext) => {
    try {
      engine.setUIDiagnostic()
      ui.update(ctx, engine.snapshot)
    } catch (error) {
      engine.setUIDiagnostic(error)
    }
  }

  const output = (ctx: ExtensionContext, text: string) => {
    try {
      ui.output(ctx, text)
    } catch (error) {
      engine.setUIDiagnostic(error)
      const stderr =
        options.stderr ??
        ((value: string) => {
          process.stderr.write(value)
        })
      stderr(`${text}\n`)
    }
  }

  pi.registerFlag('pi-rules-disabled', {
    type: 'boolean',
    default: false,
    description: 'Pause rule activation and injection',
  })
  pi.registerFlag('pi-rules-mode', {
    type: 'string',
    default: 'both',
    description: 'Rule mode: static, dynamic, both or off',
  })
  pi.registerFlag('pi-rules-widget', {
    type: 'string',
    default: 'true',
    description: 'Display rule widgets: true or false',
  })

  pi.on('session_start', (_event, ctx) => {
    generation++
    engine.startSession(ctx.cwd)
    sync(ctx)
    ui.start()
    update(ctx)
  })
  pi.on('before_agent_start', (event, ctx) => {
    sync(ctx)
    engine.prepareAgent(event.systemPromptOptions.contextFiles.map((file) => file.path))
    update(ctx)
  })
  pi.on('tool_call', (event, ctx) => {
    sync(ctx)
    const paths = toolTargets(event)
    if (paths.length) engine.activateTargets(paths, ctx.cwd)
    update(ctx)
  })
  pi.on('context_with_system', (event, ctx) => {
    sync(ctx)
    const result = engine.formatRequest()
    const messages = replaceRulesSection(event.messages, result.text)
    engine.commitInjection(result)
    ui.collapse()
    update(ctx)
    return { messages }
  })
  // Compaction and same-session tree navigation intentionally preserve the in-memory activation Map.
  pi.on('session_shutdown', (_event, ctx) => {
    generation++
    try {
      ui.clear(ctx)
    } catch (error) {
      engine.setUIDiagnostic(error)
    }
  })

  pi.registerCommand('rules', {
    description: 'Inspect rules: list, show <id>, paths, status',
    getArgumentCompletions: ruleCompletions,
    handler: async (args, ctx) => {
      sync(ctx)
      const text = rulesCommand(args, engine.inspect())
      update(ctx)
      output(ctx, text)
    },
  })
  pi.registerCommand('reload-rules', {
    description: 'Wait until idle and reload rules without resetting activation order',
    handler: async (_args, ctx) => {
      sync(ctx)
      const identity = engine.sessionIdentity
      const token = generation
      await ctx.waitForIdle()
      if (identity !== engine.sessionIdentity || token !== generation) return
      sync(ctx)
      const changed = engine.reload()
      update(ctx)
      output(
        ctx,
        `[pi-rules] Reloaded: updated=${changed.updated} removed=${changed.removed}\n${rulesSummary(engine.snapshot)}`,
      )
    },
  })
  return engine
}

export default function extension(pi: ExtensionAPI): void {
  registerRules(pi)
}
