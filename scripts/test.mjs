import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Vite normalizes Windows drive letters. Match it before Vitest loads so its
// runner state is not split between differently cased module URLs.
const normalizeDrive = (path) => process.platform === 'win32'
  ? path.replace(/^[a-z]:/, (drive) => drive.toUpperCase())
  : path
process.chdir(normalizeDrive(process.cwd()))
const require = createRequire(pathToFileURL(`${process.cwd()}/package.json`))
const cli = normalizeDrive(join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'))
process.argv = [process.execPath, cli, ...process.argv.slice(2)]
await import(pathToFileURL(cli).href)
