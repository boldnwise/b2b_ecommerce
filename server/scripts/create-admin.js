'use strict'

/**
 * Create one new ADMIN account on staging.
 *
 * Usage (from server/, in an interactive terminal on the staging host):
 *   NODE_ENV=production APP_ENV=staging npm run admin:create -- admin@example.com
 *
 * The password is typed twice at a hidden prompt. It is never accepted from
 * arguments, environment variables, files, or piped input, and is never printed.
 * An existing email is refused: this command never promotes or changes an
 * existing BUYER/SELLER account. Not run by any build, deploy, migration, or startup step.
 */

const os = require('os')
const { z } = require('zod')

const MIN_PASSWORD_LENGTH = 14
/** bcrypt ignores input beyond 72 bytes, so a longer password would be silently truncated. */
const MAX_PASSWORD_BYTES = 72
const WEAK_FRAGMENTS = ['password', 'admin', 'qwerty', 'letmein', 'welcome', '123456', 'b2b']

const USAGE = 'Usage: NODE_ENV=production APP_ENV=staging npm run admin:create -- <email>'

class AdminCreateError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AdminCreateError'
    this.code = code
  }
}

/** Both values must be set explicitly in the shell; nothing is inferred from .env. */
function assertStagingEnvironment(source = process.env) {
  if (source.NODE_ENV !== 'production' || source.APP_ENV !== 'staging') {
    throw new AdminCreateError(
      'WRONG_ENVIRONMENT',
      'Refusing to run: this command is staging-only. Set NODE_ENV=production and APP_ENV=staging explicitly.',
    )
  }
}

const emailSchema = z.string().trim().toLowerCase().email().max(255)

function parseEmailArg(argv) {
  if (argv.length !== 1 || String(argv[0]).startsWith('-')) {
    throw new AdminCreateError(
      'USAGE',
      `Pass exactly one argument: the email. The password is prompted, never passed.\n${USAGE}`,
    )
  }
  const parsed = emailSchema.safeParse(argv[0])
  if (!parsed.success) {
    throw new AdminCreateError('INVALID_EMAIL', `Not a valid email address.\n${USAGE}`)
  }
  return parsed.data
}

/** Returns a list of unmet rules. Never includes the password itself. */
function passwordProblems(password, email = '') {
  const problems = []
  const value = String(password ?? '')
  if (value.length < MIN_PASSWORD_LENGTH) problems.push(`at least ${MIN_PASSWORD_LENGTH} characters`)
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) problems.push(`at most ${MAX_PASSWORD_BYTES} bytes`)
  if (!/[a-z]/.test(value)) problems.push('a lowercase letter')
  if (!/[A-Z]/.test(value)) problems.push('an uppercase letter')
  if (!/[0-9]/.test(value)) problems.push('a digit')
  if (!/[^A-Za-z0-9]/.test(value)) problems.push('a symbol')
  if (value !== value.trim()) problems.push('no leading or trailing spaces')
  if (/(.)\1{3,}/.test(value)) problems.push('no character repeated 4 or more times in a row')

  const lower = value.toLowerCase()
  const localPart = String(email).split('@')[0].toLowerCase()
  if (localPart.length >= 4 && lower.includes(localPart)) problems.push('must not contain the email name')
  if (WEAK_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
    problems.push(`must not contain common words (${WEAK_FRAGMENTS.join(', ')})`)
  }
  return problems
}

function assertStrongPassword(password, email) {
  const problems = passwordProblems(password, email)
  if (problems.length) {
    throw new AdminCreateError(
      'WEAK_PASSWORD',
      `Password rejected. It needs: ${problems.join('; ')}. Nothing was changed.`,
    )
  }
}

/** Reads one line from a real terminal without echoing it. */
function promptHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new AdminCreateError(
        'NO_TTY',
        'Run this command in an interactive terminal. Piped or file input is refused.',
      ))
      return
    }

    let chars = []
    const finish = (error) => {
      input.removeListener('data', onData)
      input.setRawMode(false)
      input.pause()
      output.write('\n')
      const value = chars.join('')
      chars = []
      if (error) reject(error)
      else resolve(value)
    }

    function onData(chunk) {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') return finish()
        if (ch === '\u0003' || ch === '\u0004') {
          return finish(new AdminCreateError('ABORTED', 'Cancelled. Nothing was changed.'))
        }
        if (ch === '\u007f' || ch === '\b') chars.pop()
        else if (ch >= ' ') chars.push(ch)
      }
      return undefined
    }

    output.write(question)
    input.setRawMode(true)
    input.setEncoding('utf8')
    input.on('data', onData)
    input.resume()
  })
}

async function assertEmailAvailable(prisma, email) {
  let existing
  try {
    existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    })
  } catch (err) {
    throw databaseError(err)
  }
  if (existing) {
    throw new AdminCreateError(
      'EMAIL_EXISTS',
      'An account with this email already exists. It was not changed; this command never promotes accounts.',
    )
  }
}

function databaseError(err) {
  const code = typeof err?.code === 'string' ? ` (${err.code})` : ''
  return new AdminCreateError('DATABASE_ERROR', `Database error${code}. Nothing was changed.`)
}

function operatorContext() {
  try {
    return { operator: os.userInfo().username, host: os.hostname() }
  } catch {
    return { operator: null, host: null }
  }
}

/**
 * Creates the account and its audit row in one transaction. The audit row holds
 * no email, password, or hash.
 */
async function createAdminAccount({ prisma, hashPassword, email, password }) {
  const passwordHash = await hashPassword(password)
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      })
      if (existing) {
        throw new AdminCreateError(
          'EMAIL_EXISTS',
          'An account with this email already exists. It was not changed; this command never promotes accounts.',
        )
      }

      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: 'ADMIN',
          isActive: true,
          authifyUserId: null,
        },
        select: { id: true, role: true },
      })

      await tx.auditLog.create({
        data: {
          actorId: null,
          action: 'CREATE',
          resource: 'user',
          resourceId: user.id,
          meta: { source: 'cli:admin:create', role: 'ADMIN', appEnv: 'staging', ...operatorContext() },
        },
      })
      return user
    })
  } catch (err) {
    if (err instanceof AdminCreateError) throw err
    if (err?.code === 'P2002') {
      throw new AdminCreateError(
        'EMAIL_EXISTS',
        'An account with this email already exists. It was not changed; this command never promotes accounts.',
      )
    }
    throw databaseError(err)
  }
}

/** Loaded only after the environment guard so a refused run never reads config or connects. */
function loadAppDeps() {
  const env = require('../src/config/env.js')
  const { prisma } = require('../src/config/database.js')
  const { hashPassword } = require('../src/utils/password.js')
  return { isStaging: env.isStaging, prisma, hashPassword }
}

/** @returns {Promise<number>} process exit code */
async function run({
  argv = process.argv.slice(2),
  env = process.env,
  prompt = promptHidden,
  loadDeps = loadAppDeps,
  out = console.log,
  err = console.error,
} = {}) {
  let deps
  try {
    assertStagingEnvironment(env)
    const email = parseEmailArg(argv)

    deps = loadDeps()
    if (!deps.isStaging) {
      throw new AdminCreateError('WRONG_ENVIRONMENT', 'Refusing to run: the loaded configuration is not staging.')
    }

    await assertEmailAvailable(deps.prisma, email)

    const password = await prompt('New admin password: ')
    const confirmation = await prompt('Repeat the password: ')
    if (password !== confirmation) {
      throw new AdminCreateError('PASSWORD_MISMATCH', 'Passwords do not match. Nothing was changed.')
    }
    assertStrongPassword(password, email)

    const user = await createAdminAccount({
      prisma: deps.prisma,
      hashPassword: deps.hashPassword,
      email,
      password,
    })

    out(`[admin:create] Created ADMIN account ${user.id}. Sign in at /admin/login with this email.`)
    return 0
  } catch (error) {
    if (error instanceof AdminCreateError) {
      err(`[admin:create] ${error.message}`)
    } else {
      err(`[admin:create] Unexpected ${error?.name || 'error'}. Nothing was changed.`)
    }
    return 1
  } finally {
    if (deps?.prisma?.$disconnect) {
      await deps.prisma.$disconnect().catch(() => {})
    }
  }
}

if (require.main === module) {
  run().then((code) => {
    process.exitCode = code
  })
}

module.exports = {
  AdminCreateError,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  assertStagingEnvironment,
  parseEmailArg,
  passwordProblems,
  assertStrongPassword,
  promptHidden,
  assertEmailAvailable,
  createAdminAccount,
  run,
}
