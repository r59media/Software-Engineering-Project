import { execFileSync } from 'node:child_process'
import path from 'node:path'

const backendDir = path.resolve(import.meta.dirname, '..')
const DB_NAME = 'r59_db'
const LEGACY_MIGRATION = '0002_add_photo_permissions.sql'

function runWrangler(args, { capture = true } = {}) {
  return execFileSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: backendDir,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
  })
}

function isMigrationPending(rawJson) {
  const parsed = JSON.parse(rawJson)
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.results)
      ? parsed.results
      : Array.isArray(parsed?.migrations)
        ? parsed.migrations
        : []

  return list.some((entry) => {
    if (typeof entry === 'string') return entry === LEGACY_MIGRATION
    if (entry && typeof entry === 'object') {
      return entry.name === LEGACY_MIGRATION || entry.migration === LEGACY_MIGRATION
    }
    return false
  })
}

function hasPhotoPermissionColumn() {
  const raw = runWrangler([
    'd1',
    'execute',
    DB_NAME,
    '--remote',
    '--command',
    'PRAGMA table_info(Bookings);',
    '--json'
  ])
  const parsed = JSON.parse(raw)
  const blocks = Array.isArray(parsed) ? parsed : [parsed]
  return blocks.some((block) =>
    Array.isArray(block?.results) &&
    block.results.some((col) => col?.name === 'photo_permission_portfolio')
  )
}

const pendingJson = runWrangler(['d1', 'migrations', 'list', DB_NAME, '--remote', '--json'])
if (isMigrationPending(pendingJson) && hasPhotoPermissionColumn()) {
  console.log(`[d1-migrate] Recording already-applied ${LEGACY_MIGRATION} in d1_migrations`)
  runWrangler(
    [
      'd1',
      'execute',
      DB_NAME,
      '--remote',
      '--command',
      `INSERT INTO d1_migrations (name) SELECT '${LEGACY_MIGRATION}' WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '${LEGACY_MIGRATION}');`
    ],
    { capture: false }
  )
}

runWrangler(['d1', 'migrations', 'apply', DB_NAME, '--remote'], { capture: false })
