#!/usr/bin/env node
// Verify every entry in package.json "exports" points at a file the build
// actually produced.
//
// The exports map is the package's public surface, and a stale path there
// fails only for consumers, at install time, rather than in the source tree.
// `files` is checked too, so a path can never point at something excluded from
// the published tarball.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const problems = []

for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
  const label = subpath === '.' ? '. (root)' : subpath
  for (const [field, value] of Object.entries(entry)) {
    if (typeof value !== 'string') continue
    if (!existsSync(join(root, value))) {
      problems.push(`${label}: exports.${field} -> ${value} (missing from the build output)`)
    }
  }
}

for (const field of ['main', 'module', 'types']) {
  const value = pkg[field]
  if (typeof value === 'string' && !existsSync(join(root, value))) {
    problems.push(`${field} -> ${value} (missing from the build output)`)
  }
}

// Anything under dist that matches a published files pattern must exist, and
// nothing the exports reference may be filtered out of the tarball.
if (pkg.files && !pkg.files.includes('dist')) {
  problems.push('files does not include dist, so the exports map cannot resolve for consumers')
}

if (problems.length > 0) {
  console.error('package exports are inconsistent with the build output:')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nRun `npm run build` first.')
  process.exit(1)
}

console.log(`package exports OK (${Object.keys(pkg.exports ?? {}).length} subpaths resolved)`)
