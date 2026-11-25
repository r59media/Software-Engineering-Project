import { execFileSync } from 'node:child_process'
import path from 'node:path'

const backendDir = path.resolve(import.meta.dirname, '..')
const DB_NAME = 'r59_db'
const LEGACY_MIGRATION = '0002_add_photo_permissions.sql'

function runWrangler(args, { capture = true } = {}) {
  try {
    return execFileSync('pnpm', ['exec', 'wrangler', ...args], {
      cwd: backendDir,
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    const combined = `${err?.stdout || ''}\n${err?.stderr || ''}`
    if (!capture && combined.trim()) {
      process.stderr.write(combined)
    }
    err.combinedOutput = combined
    throw err
  }
}

function isMigrationPending(rawOutput) {
  return String(rawOutput || '').includes(LEGACY_MIGRATION)
}

function hasD1MigrationsTable() {
  const raw = runWrangler([
    'd1',
    'execute',
    DB_NAME,
    '--remote',
    '--command',
    "SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations';",
    '--json'
  ])
  const parsed = JSON.parse(raw)
  const blocks = Array.isArray(parsed) ? parsed : [parsed]
  return blocks.some((block) =>
    Array.isArray(block?.results) &&
    block.results.some((row) => row?.name === 'd1_migrations')
  )
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

try {
  const pendingOutput = runWrangler(['d1', 'migrations', 'list', DB_NAME, '--remote'])
  if (isMigrationPending(pendingOutput) && hasD1MigrationsTable() && hasPhotoPermissionColumn()) {
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

  const applyOut = runWrangler(['d1', 'migrations', 'apply', DB_NAME, '--remote'], { capture: false })
  if (applyOut?.trim()) process.stdout.write(applyOut)
} catch (err) {
  const output = String(err?.combinedOutput || err?.message || '')
  if (output.includes('code: 7403') || output.includes('not authorized to access this service')) {
    console.error(
      '::error title=D1 Migration Permission Denied::CLOUDFLARE_API_TOKEN lacks D1:Edit permission (code 7403). Refusing to deploy potentially incompatible Worker code without verifying/applying remote D1 migrations. Grant Account -> D1:Edit permission to CLOUDFLARE_API_TOKEN.'
    )
    if (output.trim()) process.stderr.write(output)
    process.exit(1)
  }
  if (output.trim()) process.stderr.write(output)
  process.exit(1)
}
