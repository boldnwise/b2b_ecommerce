const bcrypt = require('bcryptjs')
const { LOGIN_USER_SPECS } = require('./constants.js')

const ADDRESS_CITIES = [
  ['Mumbai', 'Maharashtra', '400001'],
  ['Delhi', 'Delhi', '110001'],
  ['Bengaluru', 'Karnataka', '560001'],
  ['Chennai', 'Tamil Nadu', '600001'],
  ['Ahmedabad', 'Gujarat', '380001'],
  ['Hyderabad', 'Telangana', '500001'],
  ['Pune', 'Maharashtra', '411001'],
  ['Kolkata', 'West Bengal', '700001'],
]

function buildUserData(spec, passwordHash, { preserveExistingState = false } = {}) {
  const base = {
    role: spec.role,
    companyName: spec.companyName,
    passwordHash,
  }

  if (spec.group === 'MANUAL_ONBOARDING' || spec.group === undefined) {
    if (preserveExistingState) {
      return base
    }

    return {
      ...base,
      portalUserId: null,
      buyerSubscriptionStatus: null,
      buyerSubscriptionPlan: null,
      buyerSubscriptionActivatedAt: null,
      sellerSubscriptionStatus: null,
      sellerSubscriptionPlan: null,
      sellerSubscriptionActivatedAt: null,
    }
  }

  return {
    ...base,
    portalUserId: spec.memberId ?? null,
    // Fixed Authify ids so local Playwright runs can sign these QA users in through SSO.
    ...(spec.authifyUserId ? { authifyUserId: spec.authifyUserId } : {}),
  }
}

async function upsertUsers(prisma, { preserveExistingState = false } = {}) {
  const users = {}
  for (const spec of LOGIN_USER_SPECS) {
    const passwordHash = await bcrypt.hash(spec.password, 10)
    users[spec.email] = await prisma.user.upsert({
      where: { email: spec.email },
      update: buildUserData(spec, passwordHash, { preserveExistingState }),
      create: {
        email: spec.email,
        ...buildUserData(spec, passwordHash),
      },
    })
  }
  return users
}

async function upsertAddresses(prisma, users) {
  let index = 0
  for (const spec of LOGIN_USER_SPECS.filter((u) => u.role !== 'ADMIN')) {
    const label = spec.address?.label || (spec.role === 'SELLER' ? 'Warehouse' : 'Head Office')
    const user = users[spec.email]

    let data
    if (spec.address) {
      data = {
        line1: spec.address.line1,
        line2: spec.address.line2,
        city: spec.address.city,
        state: spec.address.state,
        postalCode: spec.address.postalCode,
        country: 'IN',
        phone: spec.address.phone,
        isDefault: true,
      }
    } else {
      const [city, state, postalCode] = ADDRESS_CITIES[index % ADDRESS_CITIES.length]
      data = {
        line1: `${101 + index}, Trade Park Phase ${(index % 3) + 1}`,
        line2: 'Industrial Area',
        city,
        state,
        postalCode,
        country: 'IN',
        phone: `98765${String(10000 + index).slice(-5)}`,
        isDefault: true,
      }
    }

    const existing = await prisma.address.findFirst({
      where: { userId: user.id, label },
    })

    if (existing) {
      await prisma.address.update({ where: { id: existing.id }, data })
    } else {
      await prisma.address.create({
        data: { userId: user.id, label, ...data },
      })
    }
    index += 1
  }
}

module.exports = {
  upsertUsers,
  upsertAddresses,
}
