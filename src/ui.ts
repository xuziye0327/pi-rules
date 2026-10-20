import type { ExtensionContext, ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import { rulesSummary } from './commands.ts'
import type { RulesSnapshot } from './rules/engine.ts'

type UIContext = Pick<ExtensionContext, 'mode' | 'hasUI'> & {
  ui: Pick<ExtensionUIContext, 'notify' | 'setStatus' | 'setWidget'> & {
    readonly theme: Pick<Theme, 'fg'>
  }
}

const widgetKey = 'pi-rules:banner'
const statusKey = 'pi-rules'

export class RulesUI {
  private banner = true
  private installed = false
  private readonly stderr: (text: string) => void

  constructor(
    stderr: (text: string) => void = (text) => {
      process.stderr.write(text)
    },
  ) {
    this.stderr = stderr
  }

  start(): void {
    this.banner = true
  }
  collapse(): void {
    this.banner = false
  }

  output(ctx: UIContext, text: string): void {
    if ((ctx.mode === 'tui' || ctx.mode === 'rpc') && ctx.hasUI) {
      ctx.ui.notify(text, 'info')
    } else {
      this.stderr(`${text}\n`)
    }
  }

  update(ctx: UIContext, snapshot: RulesSnapshot): void {
    if (ctx.mode !== 'tui' || !ctx.hasUI || !snapshot.config.widget) {
      this.clear(ctx)
      return
    }
    this.installed = true
    const stopped =
      snapshot.config.disabled || snapshot.config.mode === 'off' ? ' [injection stopped]' : ''
    ctx.ui.setStatus(statusKey, `${rulesSummary(snapshot)}${stopped}`)
    if (!this.banner) {
      ctx.ui.setWidget(widgetKey, undefined)
      return
    }
    const seen = new Set<string>()
    const known = snapshot.known.filter((item) => {
      if (seen.has(item.realPath)) return false
      seen.add(item.realPath)
      return true
    })
    const paths = known.slice(0, 5).map((item) => item.relativePath)
    const lines = [
      `[pi-rules] ${known.length} known · ${snapshot.warnings.length} warnings`,
      ...paths,
    ]
    ctx.ui.setWidget(widgetKey, () => ({
      render: (width) =>
        lines.map((line) => {
          const themed = ctx.ui.theme.fg('muted', line)
          return visibleWidth(themed) <= width ? themed : truncateToWidth(themed, Math.max(0, width))
        }),
      invalidate: () => {},
    }))
  }

  clear(ctx: { ui: Pick<ExtensionUIContext, 'setStatus' | 'setWidget'> }): void {
    if (!this.installed) return
    ctx.ui.setWidget(widgetKey, undefined)
    ctx.ui.setStatus(statusKey, undefined)
    this.installed = false
  }
}
