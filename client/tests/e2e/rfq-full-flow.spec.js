import { test, expect } from '@playwright/test'
import { loginViaUi } from '../fixtures/auth.js'
import { csrfHeadersForPage } from '../fixtures/csrf.js'
import { PREMIUM_QA_USERS, TEST_USERS } from '../fixtures/test-users.js'

const FLOW_SELLERS_BY_PORTAL_ID = {
  'USR-DEMO-000002': TEST_USERS.seller,
  'USR-DEMO-000004': PREMIUM_QA_USERS.seller,
  'USR-DEMO-000005': { email: 'seller2@test.com', password: 'Ks9#mPq2vWx7nRj4' },
  'USR-DEMO-000006': { email: 'seller3@test.com', password: 'Ln8@wYb5Fc3hKm9' },
}

async function expectBuyerRfqLoaded(page, { productTitle, requirement }) {
  await expect(page.getByTestId('quotation-workspace')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: productTitle, level: 2 })).toBeVisible()
  await expect(page.getByText('Mumbai, Maharashtra').first()).toBeVisible()
  await page.getByRole('button', { name: 'Requirement details' }).click()
  await expect(page.getByText(requirement).first()).toBeVisible()
}

async function expectSellerRfqLoaded(page, { productTitle, requirement }) {
  await expect(page.getByTestId('quotation-workspace')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: productTitle, level: 2 })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel(/final unit price/i)).toBeVisible()
  const requirementLocator = page.getByText(requirement).first()
  if (!(await requirementLocator.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Requirement details' }).click()
  }
  await expect(requirementLocator).toBeVisible()
}

async function findFlowProduct(request) {
  const catalogRes = await request.get('/api/catalog/products?limit=100')
  expect(catalogRes.ok()).toBeTruthy()
  const products = (await catalogRes.json()).data?.products || []

  for (const product of products) {
    const seller = FLOW_SELLERS_BY_PORTAL_ID[product.seller?.portalUserId]
    if (seller) {
      return { product, seller, productTitle: product.title }
    }
  }

  throw new Error('No catalog product is owned by a subscribed Playwright seller account')
}

test.describe('RFQ full flow', () => {
  test('buyer creates RFQ, seller responds, buyer accepts, deal appears', async ({ page, browser }) => {
    test.setTimeout(120_000)

    const unique = Date.now()
    const requirement = `Automation RFQ requirement ${unique}`

    await loginViaUi(page, TEST_USERS.buyer)
    const { product, seller, productTitle } = await findFlowProduct(page.request)

    const createRes = await page.request.post('/api/quote-requests', {
      headers: await csrfHeadersForPage(page),
      data: {
        productTitle,
        productId: product.id,
        quantity: Math.max(Number(product.moq) || 1, 1),
        message: requirement,
        deliveryLocation: 'Mumbai, Maharashtra',
        expectedDeliveryDate: '2026-12-31',
      },
    })
    expect(createRes.ok(), await createRes.text()).toBeTruthy()
    const createBody = await createRes.json()
    const requestId = createBody.data?.request?.id || createBody.data?.group?.requests?.[0]?.id
    expect(requestId).toBeTruthy()

    await page.goto(`/buyer/quotations/${requestId}`)
    await expectBuyerRfqLoaded(page, { productTitle, requirement })

    const sellerContext = await browser.newContext()
    const sellerPage = await sellerContext.newPage()
    await loginViaUi(sellerPage, seller)
    await sellerPage.goto(`/seller/quotations/${requestId}`)
    await expectSellerRfqLoaded(sellerPage, { productTitle, requirement })

    await sellerPage.getByLabel(/final unit price/i).fill('250')
    const respondPromise = sellerPage.waitForResponse(
      (res) => /\/quote-requests\/.+\/respond$/.test(res.url()) && res.request().method() === 'PATCH',
    )
    await sellerPage.getByRole('button', { name: /send quotation|update quotation/i }).click()
    const respondRes = await respondPromise
    expect(respondRes.ok(), await respondRes.text()).toBeTruthy()

    await page.reload()
    await expect(page.getByRole('button', { name: /accept quotation/i }).first()).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /accept quotation/i }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    const confirmBtn = dialog.getByRole('button', { name: /accept quotation/i })
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 })

    const acceptPromise = page.waitForResponse(
      (res) => res.url().includes('/accept') && res.request().method() === 'PATCH',
      { timeout: 30_000 },
    )
    await confirmBtn.click({ force: true })
    const acceptRes = await acceptPromise
    expect(acceptRes.ok(), await acceptRes.text()).toBeTruthy()

    await page.goto('/buyer/transactions')
    await expect(page.getByTestId('buyer-transactions-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: /transactions/i, level: 2 })).toBeVisible()

    await sellerContext.close()
  })
})
