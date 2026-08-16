import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const frontendRoot = join(projectRoot, 'frontend')

const requiredFiles = [
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
  'src/main.tsx',
  'src/api/crowdApi.ts',
  '.env.example',
]

const missingFiles = requiredFiles.filter((relativePath) => !existsSync(join(frontendRoot, relativePath)))
if (missingFiles.length > 0) {
  console.error('Frontend workspace check failed. Missing:')
  for (const relativePath of missingFiles) console.error(`- frontend/${relativePath}`)
  process.exitCode = 1
} else {
  const packageJson = JSON.parse(readFileSync(join(frontendRoot, 'package.json'), 'utf8'))
  const lockJson = JSON.parse(readFileSync(join(frontendRoot, 'package-lock.json'), 'utf8'))
  const packageNameMatches = packageJson.name === lockJson.name
  const hasBuild = typeof packageJson.scripts?.build === 'string'
  const hasWorkspaceCheck = typeof packageJson.scripts?.['check:workspace'] === 'string'
  console.log('Frontend workspace check passed.')
  console.log(`- package/lock aligned: ${packageNameMatches ? 'yes' : 'no'}`)
  console.log(`- build script present: ${hasBuild ? 'yes' : 'no'}`)
  console.log(`- workspace check registered: ${hasWorkspaceCheck ? 'yes' : 'no'}`)
  console.log('- frontend source of truth: frontend/')

  if (!packageNameMatches || !hasBuild || !hasWorkspaceCheck) {
    process.exitCode = 1
  }
}
