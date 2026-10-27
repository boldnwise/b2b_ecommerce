/**
 * Phase 4 — migrations are decoupled from application startup.
 * No database: migration steps are injected fakes, and the Docker entrypoint
 * runs under a POSIX shell with logging stubs for `node` / `npx`.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const { buildSteps, runReleaseMigrations, CATALOG_MIGRATE_SCRIPT } = require('../../scripts/migrate-release.js')
const { initializeDatabase } = require('../db/startupInit.js')

const SERVER_ROOT = path.join(__dirname, '../..')
const FAKE_DB = 'postgresql://fake_user:fake_pw@db.example.invalid:5432/app'
const FAKE_DIRECT = 'postgresql://fake_mig:fake_mig_pw@direct.example.invalid:5432/app'
const VALID_SOURCE = { DATABASE_URL: FAKE_DB, DIRECT_URL: FAKE_DIRECT }

function silentLog() {
  const lines = []
  return {
    lines,
    log: (...a) => lines.push(a.join(' ')),
    error: (...a) => lines.push(a.join(' ')),
  }
}

describe('release migration command (scripts/migrate-release.js)', () => {
  it('runs prisma migrate deploy, then catalog schema SQL, in that order', () => {
    const steps = buildSteps(VALID_SOURCE, { prismaCli: '/fake/prisma/build/index.js' })

    expect(steps.map((s) => s.name)).toEqual(['prisma migrate deploy', 'catalog schema migrations'])
    expect(steps[0].command).toBe(process.execPath)
    expect(steps[0].args).toEqual(['/fake/prisma/build/index.js', 'migrate', 'deploy'])
    expect(steps[1].args).toEqual([CATALOG_MIGRATE_SCRIPT])
  })

  it('catalog step uses the migration connection (DIRECT_URL), not the runtime one', () => {
    const [prismaStep, catalogStep] = buildSteps(VALID_SOURCE, { prismaCli: 'p' })
    expect(prismaStep.env.DATABASE_URL).toBe(FAKE_DB)
    expect(catalogStep.env.DATABASE_URL).toBe(FAKE_DIRECT)
  })

  it('never invokes seed, reset, truncate or admin bootstrap', () => {
    const argv = buildSteps(VALID_SOURCE, { prismaCli: 'p' }).flatMap((s) => [s.command, ...s.args]).join(' ')
    expect(argv).not.toMatch(/--seed|seed\.js|reset|uat-cleanup|bootstrap-admin|reference\.js|migrate dev|migrate reset/)
  })

  it('resolves the installed Prisma CLI without a shell', () => {
    const [prismaStep] = buildSteps(VALID_SOURCE)
    expect(fs.existsSync(prismaStep.args[0])).toBe(true)
  })

  it('succeeds only when every step exits 0', () => {
    const run = jest.fn(() => ({ status: 0, signal: null }))
    const out = silentLog()

    expect(runReleaseMigrations({ source: VALID_SOURCE, run, log: out, prismaCli: 'p' })).toBe(0)
    expect(run.mock.calls.map(([s]) => s.name)).toEqual(['prisma migrate deploy', 'catalog schema migrations'])
  })

  it('a failed Prisma migration stops immediately with its non-zero status', () => {
    const run = jest.fn(() => ({ status: 1, signal: null }))
    const out = silentLog()

    expect(runReleaseMigrations({ source: VALID_SOURCE, run, log: out, prismaCli: 'p' })).toBe(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(out.lines.join('\n')).toMatch(/prisma migrate deploy failed .* Do not deploy/)
  })

  it('a failed catalog migration exits non-zero', () => {
    const run = jest.fn()
      .mockReturnValueOnce({ status: 0, signal: null })
      .mockReturnValueOnce({ status: 2, signal: null })

    expect(runReleaseMigrations({ source: VALID_SOURCE, run, log: silentLog(), prismaCli: 'p' })).toBe(2)
  })

  it('a step killed by a signal is a failure', () => {
    const run = jest.fn(() => ({ status: null, signal: 'SIGKILL' }))
    expect(runReleaseMigrations({ source: VALID_SOURCE, run, log: silentLog(), prismaCli: 'p' })).toBe(1)
  })

  it('invalid migration env fails before any step and never prints URLs', () => {
    const run = jest.fn()
    const out = silentLog()

    const code = runReleaseMigrations({
      source: { DATABASE_URL: FAKE_DB, DIRECT_URL: '' },
      run,
      log: out,
      prismaCli: 'p',
    })

    expect(code).toBe(1)
    expect(run).not.toHaveBeenCalled()
    const text = out.lines.join('\n')
    expect(text).toMatch(/DIRECT_URL/)
    expect(text).not.toContain('fake_pw')
    expect(text).not.toContain('db.example.invalid')
  })
})

describe('API startup database work (src/db/startupInit.js)', () => {
  function deps(overrides = {}) {
    return {
      prisma: {},
      logger: { info: jest.fn(), error: jest.fn() },
      ensureCatalogSchema: jest.fn(async () => {}),
      ensureDefaultCategories: jest.fn(async () => {}),
      ensureDefaultDealChargeConfigs: jest.fn(async () => {}),
      ...overrides,
    }
  }

  it.each([
    ['production', { isProd: true, isStaging: false, runStartupMigrations: false }],
    ['staging', { isProd: true, isStaging: true, runStartupMigrations: false }],
    ['development default', { isProd: false, runStartupMigrations: false }],
  ])('%s: no schema DDL at startup', async (_label, env) => {
    const d = deps()

    const result = await initializeDatabase({ env, ...d })

    expect(d.ensureCatalogSchema).not.toHaveBeenCalled()
    expect(result.schemaDdl).toBe('skipped')
    expect(d.ensureDefaultCategories).toHaveBeenCalled()
    expect(d.ensureDefaultDealChargeConfigs).toHaveBeenCalled()
  })

  it('development RUN_MIGRATIONS=true keeps the legacy catalog DDL', async () => {
    const d = deps()
    const result = await initializeDatabase({ env: { runStartupMigrations: true }, ...d })
    expect(d.ensureCatalogSchema).toHaveBeenCalledWith(d.prisma)
    expect(result.schemaDdl).toBe('ok')
  })

  it('missing schema does not crash startup and points at the migration task', async () => {
    const d = deps({ ensureDefaultCategories: jest.fn(async () => { throw new Error('relation does not exist') }) })

    const result = await initializeDatabase({ env: { runStartupMigrations: false }, ...d })

    expect(result.defaults).toBe('failed')
    expect(d.logger.error.mock.calls[0][1]).toMatch(/db:migrate:release/)
  })

  it('src/index.js delegates to initializeDatabase and no longer calls ensureCatalogSchema directly', () => {
    const src = fs.readFileSync(path.join(SERVER_ROOT, 'src/index.js'), 'utf8')
    expect(src).toMatch(/initializeDatabase\(/)
    expect(src).not.toMatch(/await ensureCatalogSchema\(/)
    expect(src).not.toMatch(/migrate deploy|migrate\.js/)
  })
})

function findSh() {
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\sh.exe', 'C:\\Program Files (x86)\\Git\\bin\\sh.exe']
    : ['/bin/sh', '/usr/bin/sh']
  return candidates.find((p) => fs.existsSync(p)) || null
}

const SH = findSh()
const describeWithSh = SH ? describe : describe.skip

describeWithSh('docker entrypoint behaviour (executed with stubbed node/npx)', () => {
  let tmp
  let script
  let logFile

  const STUB_NODE = [
    '#!/bin/sh',
    'if [ "$1" = "-e" ]; then',
    '  echo "probe" >> "$FAKE_LOG"',
    '  [ "${FAKE_PROBE_FAIL:-0}" = "1" ] && exit 1',
    '  exit 0',
    'fi',
    'echo "node $*" >> "$FAKE_LOG"',
    'if [ -n "$FAKE_FAIL_MATCH" ]; then',
    '  case "$*" in *"$FAKE_FAIL_MATCH"*) exit 3 ;; esac',
    'fi',
    'exit 0',
    '',
  ].join('\n')
  const STUB_NPX = '#!/bin/sh\necho "npx $*" >> "$FAKE_LOG"\nexit 0\n'

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'entrypoint-'))
    const bin = path.join(tmp, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'node'), STUB_NODE, { mode: 0o755 })
    fs.writeFileSync(path.join(bin, 'npx'), STUB_NPX, { mode: 0o755 })
    const source = fs.readFileSync(path.join(SERVER_ROOT, 'scripts/docker-entrypoint.sh'), 'utf8')
    script = path.join(tmp, 'docker-entrypoint.sh')
    fs.writeFileSync(script, source.replace(/\r\n/g, '\n'), { mode: 0o755 })
    logFile = path.join(tmp, 'calls.log')
  })

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function runEntrypoint(args = [], vars = {}) {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile)
    const env = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (!/^(path|node_env|seed_db|run_migrations|db_wait_attempts|database_url|direct_url)$/i.test(k)) env[k] = v
    }
    const originalPath = process.env.PATH || process.env.Path || ''
    env.PATH = `${path.join(tmp, 'bin')}${path.delimiter}${originalPath}`
    env.FAKE_LOG = logFile.replace(/\\/g, '/')
    Object.assign(env, vars)

    const result = spawnSync(SH, [script.replace(/\\/g, '/'), ...args], {
      cwd: tmp,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    })
    const calls = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean)
      : []
    return { status: result.status, calls, stderr: result.stderr || '' }
  }

  const PROD = { NODE_ENV: 'production' }
  const STAGING = { NODE_ENV: 'production', APP_ENV: 'staging' }

  it.each([['production', PROD], ['staging', STAGING]])(
    '%s: default start runs no Prisma migrations, no catalog DDL, no seed',
    (_label, vars) => {
      const { status, calls } = runEntrypoint([], vars)

      expect(status).toBe(0)
      expect(calls).toEqual(['node src/index.js'])
    },
  )

  it.each([['production', PROD], ['staging', STAGING]])(
    '%s: RUN_MIGRATIONS=true is refused before anything runs',
    (_label, vars) => {
      const { status, calls, stderr } = runEntrypoint([], { ...vars, RUN_MIGRATIONS: 'true' })

      expect(status).toBe(1)
      expect(calls).toEqual([])
      expect(stderr).toMatch(/RUN_MIGRATIONS=true is not allowed/)
    },
  )

  it('rejects invalid RUN_MIGRATIONS values', () => {
    const { status, calls } = runEntrypoint([], { NODE_ENV: 'development', RUN_MIGRATIONS: 'maybe' })
    expect(status).toBe(1)
    expect(calls).toEqual([])
  })

  it('migrate mode runs only the release migration task and exits', () => {
    const { status, calls } = runEntrypoint(['migrate'], STAGING)

    expect(status).toBe(0)
    expect(calls).toEqual(['probe', 'node scripts/migrate-release.js'])
  })

  it('migrate mode propagates a failed migration exit status and never starts the API', () => {
    const { status, calls } = runEntrypoint(['migrate'], { ...STAGING, FAKE_FAIL_MATCH: 'migrate-release' })

    expect(status).toBe(3)
    expect(calls).not.toContain('node src/index.js')
  })

  it('migrate mode gives up when the database never becomes reachable', () => {
    const { status, calls } = runEntrypoint(['migrate'], { ...PROD, FAKE_PROBE_FAIL: '1', DB_WAIT_ATTEMPTS: '2' })

    expect(status).toBe(1)
    expect(calls).toEqual(['probe', 'probe'])
  })

  it('SEED_DB=true in production is still refused before any work (Phase 3)', () => {
    const { status, calls } = runEntrypoint([], { ...PROD, SEED_DB: 'true' })
    expect(status).toBe(1)
    expect(calls).toEqual([])
  })

  it('development RUN_MIGRATIONS=true migrates, then starts the API', () => {
    const { status, calls } = runEntrypoint([], { NODE_ENV: 'development', RUN_MIGRATIONS: 'true' })

    expect(status).toBe(0)
    expect(calls).toEqual(['probe', 'node scripts/migrate-release.js', 'node src/index.js'])
  })

  it('development: a failed migration stops the API from starting', () => {
    const { status, calls } = runEntrypoint([], {
      NODE_ENV: 'development', RUN_MIGRATIONS: 'true', FAKE_FAIL_MATCH: 'migrate-release',
    })

    expect(status).not.toBe(0)
    expect(calls).not.toContain('node src/index.js')
  })

  it('development SEED_DB=true keeps migrate → seed → start order', () => {
    const { status, calls } = runEntrypoint([], { NODE_ENV: 'development', RUN_MIGRATIONS: 'true', SEED_DB: 'true' })

    expect(status).toBe(0)
    expect(calls).toEqual([
      'probe',
      'node scripts/migrate-release.js',
      'node prisma/seed.js',
      'node src/db/migrate.js --seed',
      'node src/index.js',
    ])
  })

  it('SEED_DB=true without RUN_MIGRATIONS=true is refused', () => {
    const { status, calls } = runEntrypoint([], { NODE_ENV: 'development', SEED_DB: 'true' })
    expect(status).toBe(1)
    expect(calls).toEqual([])
  })

  it('unknown modes are rejected', () => {
    const { status, calls } = runEntrypoint(['bootstrap'], PROD)
    expect(status).toBe(64)
    expect(calls).toEqual([])
  })

  it('never calls npx (no implicit prisma CLI at startup)', () => {
    for (const [args, vars] of [[[], PROD], [['migrate'], PROD], [[], { NODE_ENV: 'development', RUN_MIGRATIONS: 'true' }]]) {
      expect(runEntrypoint(args, vars).calls.some((c) => c.startsWith('npx'))).toBe(false)
    }
  })
})

describe('image and package wiring', () => {
  const dockerfile = fs.readFileSync(path.join(SERVER_ROOT, 'Dockerfile'), 'utf8')
  const { scripts, dependencies } = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8'))

  it('image ships the migration task and its prerequisites', () => {
    expect(dockerfile).toMatch(/^COPY scripts\s+\.\/scripts$/m)
    expect(dockerfile).toMatch(/^COPY prisma\s+\.\/prisma$/m)
    expect(dependencies.prisma).toBeDefined()
  })

  it('image default command is the API server, not migrations', () => {
    expect(dockerfile).toMatch(/^ENTRYPOINT \["\.\/docker-entrypoint\.sh"\]$/m)
    expect(dockerfile).not.toMatch(/^CMD .*migrate/m)
  })

  it('exposes the explicit migration command and keeps CI setup unchanged', () => {
    expect(scripts['db:migrate:release']).toBe('node scripts/migrate-release.js')
    expect(scripts['db:ci:setup']).toBe(
      'prisma generate && prisma migrate deploy && node prisma/seed/reset.js && npm run catalog:migrate && npm run catalog:seed',
    )
    expect(scripts.start).toBe('node src/index.js')
  })
})
