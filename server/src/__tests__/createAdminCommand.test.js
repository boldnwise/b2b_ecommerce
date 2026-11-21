'use strict'

const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const bcrypt = require('bcryptjs')

const {
  run,
  promptHidden,
  passwordProblems,
  createAdminAccount,
  AdminCreateError,
} = require('../../scripts/create-admin.js')
const { hashPassword } = require('../utils/password.js')

const STAGING_ENV = { NODE_ENV: 'production', APP_ENV: 'staging' }
const EMAIL_ARG = 'Owner.Test@Example.com'
const EMAIL = 'owner.test@example.com'
const STRONG = 'Tq7#vLm9!rZx2Kp'

function fakePrisma({ existing = null, findError, createError } = {}) {
  const tx = {
    user: {
      findFirst: jest.fn(async () => {
        if (findError) throw findError
        return existing
      }),
      create: jest.fn(async () => {
        if (createError) throw createError
        return { id: 'new-admin-id', role: 'ADMIN' }
      }),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  }
  return {
    ...tx,
    tx,
    $transaction: jest.fn(async (fn) => fn(tx)),
    $disconnect: jest.fn(async () => {}),
  }
}

function setup({ prisma = fakePrisma(), passwords = [STRONG, STRONG], env = STAGING_ENV, argv = [EMAIL_ARG], isStaging = true, hash } = {}) {
  const prompt = jest.fn()
  for (const value of passwords) prompt.mockResolvedValueOnce(value)
  const loadDeps = jest.fn(() => ({ isStaging, prisma, hashPassword: hash ?? jest.fn(async () => '$2a$12$stubbedhashvalue') }))
  const out = jest.fn()
  const err = jest.fn()
  const exec = () => run({ argv, env, prompt, loadDeps, out, err })
  const printed = () => [...out.mock.calls, ...err.mock.calls].flat().join('\n')
  return { prisma, prompt, loadDeps, out, err, exec, printed }
}

describe('admin:create — success', () => {
  test('creates one active ADMIN with a bcrypt cost-12 hash and a safe audit row', async () => {
    const ctx = setup({ hash: hashPassword })

    await expect(ctx.exec()).resolves.toBe(0)

    expect(ctx.prompt).toHaveBeenCalledTimes(2)
    const { data } = ctx.prisma.tx.user.create.mock.calls[0][0]
    expect(data).toMatchObject({ email: EMAIL, role: 'ADMIN', isActive: true, authifyUserId: null })
    expect(data.passwordHash).toMatch(/^\$2[aby]\$12\$/)
    await expect(bcrypt.compare(STRONG, data.passwordHash)).resolves.toBe(true)

    const audit = ctx.prisma.tx.auditLog.create.mock.calls[0][0].data
    expect(audit).toMatchObject({ action: 'CREATE', resource: 'user', resourceId: 'new-admin-id', actorId: null })
    expect(audit.meta).toMatchObject({ source: 'cli:admin:create', role: 'ADMIN', appEnv: 'staging' })
    const auditText = JSON.stringify(audit)
    expect(auditText).not.toContain(STRONG)
    expect(auditText).not.toContain(data.passwordHash)
    expect(auditText).not.toContain(EMAIL)

    expect(ctx.out).toHaveBeenCalledWith(expect.stringContaining('new-admin-id'))
    expect(ctx.printed()).not.toContain(STRONG)
    expect(ctx.printed()).not.toContain(data.passwordHash)
    expect(ctx.prisma.$disconnect).toHaveBeenCalled()
  })
})

describe('admin:create — duplicate email', () => {
  test('refuses an existing account before prompting and changes nothing', async () => {
    const ctx = setup({ prisma: fakePrisma({ existing: { id: 'existing-buyer' } }) })

    await expect(ctx.exec()).resolves.toBe(1)

    expect(ctx.err).toHaveBeenCalledWith(expect.stringMatching(/already exists.*never promotes/))
    expect(ctx.prompt).not.toHaveBeenCalled()
    expect(ctx.prisma.tx.user.create).not.toHaveBeenCalled()
    expect(ctx.prisma.tx.auditLog.create).not.toHaveBeenCalled()
  })

  test('checks the email case-insensitively', async () => {
    const ctx = setup({ prisma: fakePrisma({ existing: { id: 'existing-buyer' } }) })
    await ctx.exec()
    expect(ctx.prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: EMAIL, mode: 'insensitive' } },
      select: { id: true },
    })
  })

  test('maps a concurrent unique-constraint race to EMAIL_EXISTS', async () => {
    const ctx = setup({ prisma: fakePrisma({ createError: Object.assign(new Error('Unique'), { code: 'P2002' }) }) })

    await expect(ctx.exec()).resolves.toBe(1)
    expect(ctx.err).toHaveBeenCalledWith(expect.stringMatching(/already exists/))
    expect(ctx.prisma.tx.auditLog.create).not.toHaveBeenCalled()
  })
})

describe('admin:create — password rules', () => {
  test.each([
    ['too short', 'Aa1!xyzQ'],
    ['no uppercase', 'tq7#vlm9!rzx2kp'],
    ['no lowercase', 'TQ7#VLM9!RZX2KP'],
    ['no digit', 'Tqx#vLmy!rZxwKp'],
    ['no symbol', 'Tq7xvLm9yrZx2Kp'],
    ['common word', 'Password#2026xQ'],
    ['contains the email name', 'owner.test#2026X'],
    ['repeated characters', 'Tq7#vLm9!aaaaKp'],
    ['trailing space', 'Tq7#vLm9!rZx2Kp '],
    ['over 72 bytes', `Tq7#${'é'.repeat(40)}`],
  ])('rejects a weak password (%s) without writing or printing it', async (_label, weak) => {
    const ctx = setup({ passwords: [weak, weak] })

    await expect(ctx.exec()).resolves.toBe(1)

    expect(ctx.err).toHaveBeenCalledWith(expect.stringContaining('Password rejected'))
    expect(ctx.prisma.tx.user.create).not.toHaveBeenCalled()
    expect(ctx.printed()).not.toContain(weak.trim())
  })

  test('accepts a strong password', () => {
    expect(passwordProblems(STRONG, EMAIL)).toEqual([])
  })

  test('rejects mismatched passwords without writing', async () => {
    const ctx = setup({ passwords: [STRONG, `${STRONG}x`] })

    await expect(ctx.exec()).resolves.toBe(1)

    expect(ctx.err).toHaveBeenCalledWith(expect.stringContaining('do not match'))
    expect(ctx.prisma.tx.user.create).not.toHaveBeenCalled()
    expect(ctx.printed()).not.toContain(STRONG)
  })
})

describe('admin:create — environment and arguments', () => {
  test.each([
    ['APP_ENV missing', { NODE_ENV: 'production' }],
    ['APP_ENV=production', { NODE_ENV: 'production', APP_ENV: 'production' }],
    ['NODE_ENV=development', { NODE_ENV: 'development', APP_ENV: 'staging' }],
    ['nothing set', {}],
  ])('refuses to run when %s, before loading config or the database', async (_label, env) => {
    const ctx = setup({ env })

    await expect(ctx.exec()).resolves.toBe(1)

    expect(ctx.err).toHaveBeenCalledWith(expect.stringContaining('staging-only'))
    expect(ctx.loadDeps).not.toHaveBeenCalled()
    expect(ctx.prompt).not.toHaveBeenCalled()
  })

  test('refuses when the loaded configuration is not staging', async () => {
    const ctx = setup({ isStaging: false })

    await expect(ctx.exec()).resolves.toBe(1)
    expect(ctx.prisma.user.findFirst).not.toHaveBeenCalled()
    expect(ctx.prompt).not.toHaveBeenCalled()
  })

  test.each([
    ['no arguments', []],
    ['a password as a second argument', [EMAIL_ARG, STRONG]],
    ['a --password flag', [`--password=${STRONG}`]],
    ['an invalid email', ['not-an-email']],
  ])('refuses %s without loading the database', async (_label, argv) => {
    const ctx = setup({ argv })

    await expect(ctx.exec()).resolves.toBe(1)

    expect(ctx.loadDeps).not.toHaveBeenCalled()
    expect(ctx.prompt).not.toHaveBeenCalled()
    expect(ctx.printed()).not.toContain(STRONG)
  })
})

describe('admin:create — database errors', () => {
  test('reports a failed existence check with only the error code', async () => {
    const ctx = setup({ prisma: fakePrisma({ findError: Object.assign(new Error('connection to secret-host failed'), { code: 'P1001' }) }) })

    await expect(ctx.exec()).resolves.toBe(1)

    expect(ctx.err).toHaveBeenCalledWith('[admin:create] Database error (P1001). Nothing was changed.')
    expect(ctx.printed()).not.toContain('secret-host')
    expect(ctx.prompt).not.toHaveBeenCalled()
    expect(ctx.prisma.$disconnect).toHaveBeenCalled()
  })

  test('reports a failed insert without printing the password, hash, or raw error', async () => {
    const ctx = setup({ prisma: fakePrisma({ createError: Object.assign(new Error('raw driver detail'), { code: 'P2010' }) }) })

    await expect(ctx.exec()).resolves.toBe(1)

    expect(ctx.err).toHaveBeenCalledWith('[admin:create] Database error (P2010). Nothing was changed.')
    expect(ctx.printed()).not.toMatch(/raw driver detail|stubbedhash/)
    expect(ctx.printed()).not.toContain(STRONG)
    expect(ctx.prisma.tx.auditLog.create).not.toHaveBeenCalled()
  })

  test('createAdminAccount rethrows unknown failures as DATABASE_ERROR', async () => {
    const prisma = fakePrisma()
    prisma.tx.auditLog.create.mockRejectedValue(new Error('audit insert failed'))

    await expect(
      createAdminAccount({ prisma, hashPassword: async () => 'h', email: EMAIL, password: STRONG }),
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR' })
  })
})

describe('promptHidden', () => {
  function fakeTerminal({ isTTY = true } = {}) {
    const input = new EventEmitter()
    input.isTTY = isTTY
    input.setRawMode = jest.fn()
    input.setEncoding = jest.fn()
    input.resume = jest.fn()
    input.pause = jest.fn()
    const output = { write: jest.fn() }
    return { input, output }
  }

  test('reads input without echoing it, handling backspace', async () => {
    const { input, output } = fakeTerminal()
    const pending = promptHidden('Password: ', { input, output })
    input.emit('data', 'Tq7#x\u007fvLm')
    input.emit('data', '9!\r')

    await expect(pending).resolves.toBe('Tq7#vLm9!')
    expect(output.write.mock.calls.flat()).toEqual(['Password: ', '\n'])
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true)
    expect(input.setRawMode).toHaveBeenLastCalledWith(false)
  })

  test('Ctrl-C cancels', async () => {
    const { input, output } = fakeTerminal()
    const pending = promptHidden('Password: ', { input, output })
    input.emit('data', 'abc\u0003')

    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    expect(input.setRawMode).toHaveBeenLastCalledWith(false)
  })

  test('refuses piped or file input', async () => {
    const { input, output } = fakeTerminal({ isTTY: false })

    await expect(promptHidden('Password: ', { input, output })).rejects.toBeInstanceOf(AdminCreateError)
    expect(output.write).not.toHaveBeenCalled()
  })
})

describe('admin:create — never runs automatically', () => {
  const serverRoot = path.join(__dirname, '../..')

  test('is only reachable through its own npm script', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'))
    expect(scripts['admin:create']).toBe('node scripts/create-admin.js')
    const others = Object.entries(scripts).filter(([name, cmd]) => name !== 'admin:create' && /create-admin|admin:create/.test(cmd))
    expect(others).toEqual([])
  })

  test.each([
    'src/index.js',
    'src/app.js',
    'scripts/migrate-release.js',
    'scripts/render-build.js',
    'scripts/docker-entrypoint.sh',
    'prisma/seed.js',
  ])('%s does not reference the command', (file) => {
    const full = path.join(serverRoot, file)
    if (!fs.existsSync(full)) return
    expect(fs.readFileSync(full, 'utf8')).not.toMatch(/create-admin|admin:create/)
  })
})
