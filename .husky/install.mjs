import { existsSync } from 'node:fs'

// Production installs can omit devDependencies without setting NODE_ENV.
const hasLocalHusky = existsSync(new URL('../node_modules/husky/package.json', import.meta.url))

if (process.env.NODE_ENV !== 'production' && process.env.HUSKY !== '0' && hasLocalHusky) {
  const { default: install } = await import('husky')
  const error = install()
  if (error) throw new Error(error)
}
