/**
 * Production bootstrap — login accounts + master catalog taxonomy only.
 * Subscription plans / pricing live in server/src/config/subscriptionPlans.js (not DB).
 *
 * QA testing groups (PREMIUM_AUTOMATION, PREMIUM_QA) are skipped when NODE_ENV=production
 * unless SEED_QA=true.
 */

const PASSWORDS = {
  admin: 'Admin@123',
  buyer: 'Buyer@123',
  seller: 'Seller@123',
  seller2: 'Ks9#mPq2vWx7nRj4',
  seller3: 'Ln8@wYb5Fc3hKm9',
}

function shouldSeedQaUsers() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_QA !== 'true') {
    return false
  }
  return true
}

/** E2E automation catalog listings — off by default for UAT-clean bootstrap; on in CI */
function shouldSeedE2eProducts() {
  if (process.env.SEED_E2E_PRODUCTS === 'false') return false
  if (process.env.SEED_E2E_PRODUCTS === 'true') return true
  return process.env.CI === 'true'
}

const ADMIN = {
  email: 'admin@b2b.local',
  role: 'ADMIN',
  companyName: 'B2B Marketplace Platform',
  password: PASSWORDS.admin,
}

/** MANUAL_ONBOARDING_USERS — no subscription, no marketplace ID, fresh onboarding flow */
const BUYERS = [
  { email: 'buyer1@test.com', companyName: 'Northwind Retail Pvt Ltd' },
  { email: 'buyer2@test.com', companyName: 'Contoso Imports India' },
  { email: 'buyer3@test.com', companyName: 'Fabrikam Distribution Co' },
  { email: 'buyer4@test.com', companyName: 'Apex Wholesale Buyers' },
  { email: 'buyer5@test.com', companyName: 'Summit Procurement Services' },
].map((u) => ({ ...u, role: 'BUYER', password: PASSWORDS.buyer, group: 'MANUAL_ONBOARDING' }))

const SELLERS = [
  { email: 'seller1@test.com', companyName: 'Alpha Industrial Co.' },
  { email: 'seller4@test.com', companyName: 'Delta Home & Lifestyle' },
  { email: 'seller5@test.com', companyName: 'Echo Engineering Supplies' },
].map((u) => ({ ...u, role: 'SELLER', password: PASSWORDS.seller, group: 'MANUAL_ONBOARDING' }))

const MANUAL_ONBOARDING_USERS = [...BUYERS, ...SELLERS]
const MANUAL_ONBOARDING_EMAILS = MANUAL_ONBOARDING_USERS.map((u) => u.email)

/** PREMIUM_AUTOMATION_USERS — Playwright, CI, regression (subscribed + seller catalog) */
const PREMIUM_AUTOMATION_BUYER = {
  email: 'buyer.premium1@test.com',
  role: 'BUYER',
  password: PASSWORDS.buyer,
  group: 'PREMIUM_AUTOMATION',
  memberId: 'USR-DEMO-000001',
  authifyUserId: '900000000001',
  companyName: 'Premium Automation Buyer',
  address: {
    label: 'Head Office',
    line1: '12, Automation Trade Centre',
    line2: 'Park Street Area',
    city: 'Kolkata',
    state: 'West Bengal',
    postalCode: '700001',
    phone: '9876510001',
  },
}

const PREMIUM_AUTOMATION_SELLER = {
  email: 'seller.premium1@test.com',
  role: 'SELLER',
  password: PASSWORDS.seller,
  group: 'PREMIUM_AUTOMATION',
  memberId: 'USR-DEMO-000002',
  authifyUserId: '900000000002',
  companyName: 'Premium Automation Seller',
  address: {
    label: 'Warehouse',
    line1: '45, Automation Industrial Hub',
    line2: 'Peenya Phase 2',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560001',
    phone: '9876510002',
  },
}

const PREMIUM_AUTOMATION_USERS = [PREMIUM_AUTOMATION_BUYER, PREMIUM_AUTOMATION_SELLER]

/** PREMIUM_QA_USERS — manual QA from scratch (subscribed, no catalog / transactions) */
const PREMIUM_QA_BUYER = {
  email: 'buyer.premium2@test.com',
  role: 'BUYER',
  password: PASSWORDS.buyer,
  group: 'PREMIUM_QA',
  memberId: 'USR-DEMO-000003',
  authifyUserId: '900000000003',
  companyName: 'Premium QA Buyer',
  address: {
    label: 'Head Office',
    line1: '88, QA Business Park',
    line2: 'Connaught Place',
    city: 'Delhi',
    state: 'Delhi',
    postalCode: '110001',
    phone: '9876520001',
  },
}

const PREMIUM_QA_SELLER = {
  email: 'seller.premium2@test.com',
  role: 'SELLER',
  password: PASSWORDS.seller,
  group: 'PREMIUM_QA',
  memberId: 'USR-DEMO-000004',
  authifyUserId: '900000000004',
  companyName: 'Premium QA Seller',
  address: {
    label: 'Warehouse',
    line1: '19, QA Logistics Hub',
    line2: 'Andheri East',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400001',
    phone: '9876520002',
  },
}

/** Subscribed seller QA accounts — manual RFQ / quotation workflow testing */
const PREMIUM_QA_SELLER_2 = {
  email: 'seller2@test.com',
  role: 'SELLER',
  password: PASSWORDS.seller2,
  group: 'PREMIUM_QA',
  memberId: 'USR-DEMO-000005',
  authifyUserId: '900000000005',
  companyName: 'Test Seller 2',
  address: {
    label: 'Warehouse',
    line1: '22, QA Seller Hub Block B',
    line2: 'Sector 62',
    city: 'Noida',
    state: 'Uttar Pradesh',
    postalCode: '201301',
    phone: '9876530002',
  },
}

const PREMIUM_QA_SELLER_3 = {
  email: 'seller3@test.com',
  role: 'SELLER',
  password: PASSWORDS.seller3,
  group: 'PREMIUM_QA',
  memberId: 'USR-DEMO-000006',
  authifyUserId: '900000000006',
  companyName: 'Test Seller 3',
  address: {
    label: 'Warehouse',
    line1: '9, QA Seller Logistics Park',
    line2: 'HITEC City',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCode: '500081',
    phone: '9876530003',
  },
}

/** One BOTH_LIFETIME subscription — grants the buyer and seller workspaces together */
const PREMIUM_QA_BOTH = {
  email: 'both.premium1@test.com',
  role: 'BUYER',
  password: PASSWORDS.buyer,
  group: 'PREMIUM_QA',
  memberId: 'USR-DEMO-000007',
  authifyUserId: '900000000007',
  companyName: 'Premium QA Both',
  address: {
    label: 'Head Office',
    line1: '7, QA Trade Centre',
    line2: 'Koramangala',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560034',
    phone: '9876530007',
  },
}

const PREMIUM_QA_USERS = [
  PREMIUM_QA_BUYER,
  PREMIUM_QA_SELLER,
  PREMIUM_QA_SELLER_2,
  PREMIUM_QA_SELLER_3,
  PREMIUM_QA_BOTH,
]

const PREMIUM_USERS = [...PREMIUM_AUTOMATION_USERS, ...PREMIUM_QA_USERS]
const PREMIUM_USER_EMAILS = PREMIUM_USERS.map((u) => u.email)

const PREMIUM_SUBSCRIPTION_SPECS = [
  {
    email: PREMIUM_AUTOMATION_BUYER.email,
    plan: 'BUYER_LIFETIME',
    paymentKey: 'bootstrap_premium1_buyer_sub',
  },
  {
    email: PREMIUM_AUTOMATION_SELLER.email,
    plan: 'SELLER_LIFETIME',
    paymentKey: 'bootstrap_premium1_seller_sub',
  },
  {
    email: PREMIUM_QA_BUYER.email,
    plan: 'BUYER_LIFETIME',
    paymentKey: 'bootstrap_premium2_buyer_sub',
  },
  {
    email: PREMIUM_QA_SELLER.email,
    plan: 'SELLER_LIFETIME',
    paymentKey: 'bootstrap_premium2_seller_sub',
  },
  {
    email: PREMIUM_QA_SELLER_2.email,
    plan: 'SELLER_LIFETIME',
    paymentKey: 'bootstrap_premium_qa_seller2_sub',
  },
  {
    email: PREMIUM_QA_SELLER_3.email,
    plan: 'SELLER_LIFETIME',
    paymentKey: 'bootstrap_premium_qa_seller3_sub',
  },
  {
    email: PREMIUM_QA_BOTH.email,
    plan: 'BOTH_LIFETIME',
    paymentKey: 'bootstrap_premium_qa_both1_sub',
  },
]

function buildLoginUserSpecs() {
  const specs = [ADMIN, ...MANUAL_ONBOARDING_USERS]
  if (shouldSeedQaUsers()) {
    specs.push(...PREMIUM_USERS)
  }
  return specs
}

const LOGIN_USER_SPECS = buildLoginUserSpecs()
const LOGIN_EMAILS = LOGIN_USER_SPECS.map((u) => u.email)

/** @deprecated use MANUAL_ONBOARDING_EMAILS */
const MANUAL_TEST_EMAILS = MANUAL_ONBOARDING_EMAILS

/** Accounts created by earlier demo seeds — removed on bootstrap re-run */
const LEGACY_DEMO_EMAILS = [
  'buyer.e2e@test.com',
  'seller.e2e@test.com',
  'buyer.sub1@test.com',
  'buyer.sub2@test.com',
  'buyer.sub3@test.com',
  'seller.sub1@test.com',
  'seller.sub2@test.com',
  'seller.sub3@test.com',
  'buyer1@buyer.test',
  'buyer2@buyer.test',
  'buyer3@buyer.test',
  'buyer4@buyer.test',
  'buyer.subscribed@buyer.test',
  'buyer.free@buyer.test',
  'alpha@seller.test',
  'bravo@seller.test',
  'gamma@seller.test',
  'delta@seller.test',
]

/** Master catalog taxonomy (categories, subcategories, brands) — no demo products */
const CATALOG = [
  {
    name: 'Mobile & Accessories',
    slug: 'mobiles',
    brands: ['Apple', 'Samsung', 'OnePlus', 'realme', 'Xiaomi', 'vivo', 'Nokia', 'Motorola'],
    subcategories: ['Smartphones', 'Cases & Covers', 'Screen Protectors', 'Power Banks', 'Tablets', 'Wearables'],
  },
  {
    name: 'Computers & Accessories',
    slug: 'computers',
    brands: ['Dell', 'HP', 'Lenovo', 'Acer', 'ASUS', 'Logitech', 'TP-Link'],
    subcategories: ['Laptops', 'Storage Drives', 'Printers & Ink', 'Networking Devices', 'Keyboards & Mice', 'Monitors'],
  },
  {
    name: 'TV, Appliances, Electronics',
    slug: 'tv',
    brands: ['LG', 'Samsung', 'Sony', 'TCL', 'Panasonic', 'Philips'],
    subcategories: ['LED & Smart TVs', 'Home Audio', 'Kitchen Appliances', 'Air Conditioners', 'Refrigerators', 'Washing Machines'],
  },
  {
    name: "Men's Fashion",
    slug: 'mens-fashion',
    brands: ['Allen Solly', 'Van Heusen', 'Peter England', 'U.S. Polo Assn.', 'Jockey', 'Boldfit'],
    subcategories: ['Shirts & T-Shirts', 'Jeans & Trousers', 'Footwear', 'Watches', 'Bags & Wallets', 'Winterwear'],
  },
  {
    name: "Women's Fashion",
    slug: 'womens-fashion',
    brands: ['GoSriKi', 'ANNI DESIGNER', 'GRECIILOOKS', 'Enamor', 'Leriya Fashion', 'Van Heusen'],
    subcategories: ['Ethnic Wear', 'Western Wear', 'Footwear', 'Jewelry', 'Handbags', 'Innerwear'],
  },
  {
    name: 'Home, Kitchen, Pets',
    slug: 'home-kitchen',
    brands: ['Prestige', 'Pigeon', 'Milton', 'Cello', 'Solimo', 'AGARO'],
    subcategories: ['Furniture', 'Cookware & Dining', 'Home Decor', 'Pet Supplies', 'Bedding & Linen', 'Bath & Cleaning'],
  },
  {
    name: 'Beauty, Health, Grocery',
    slug: 'beauty',
    brands: ['Lakme', 'Maybelline', 'NIVEA', 'L’Oreal', 'Himalaya', 'Tata Sampann'],
    subcategories: ['Makeup', 'Skin Care', 'Health & Wellness', 'Grocery Staples', 'Snacks & Beverages', 'Personal Care'],
  },
  {
    name: 'Sports, Fitness, Bags, Luggage',
    slug: 'sports',
    brands: ['Nike', 'Adidas', 'Puma', 'Reebok', 'Yonex', 'American Tourister'],
    subcategories: ['Cricket', 'Fitness Equipment', 'Outdoor Recreation', 'Bags & Luggage', 'Cycling', 'Team Sports'],
  },
  {
    name: "Toys, Baby Products, Kids' Fashion",
    slug: 'toys',
    brands: ['Lego', 'Mattel', 'Funskool', 'Hot Wheels', 'Mee Mee', 'Babyhug'],
    subcategories: ['Toys & Games', 'Baby Products', "Kids' Fashion", 'Remote Control Toys', 'Board Games', 'School Supplies'],
  },
  {
    name: 'Car, Motorbike, Industrial',
    slug: 'car',
    brands: ['Bosch', '3M', 'Philips', 'Mahle', 'Stanley', 'Godrej'],
    subcategories: ['Car Accessories', 'Car Care', 'Motorbike Accessories', 'Industrial Supplies', 'Tools & Hardware', 'Safety Equipment'],
  },
  {
    name: 'Books',
    slug: 'books',
    brands: ['Penguin', 'HarperCollins', 'Rupa', 'Bloomsbury', 'Arihant', 'Oxford'],
    subcategories: ['Fiction', 'Non-Fiction', 'Textbooks', 'Exam Prep', "Children's Books", 'Business Books'],
  },
  {
    name: 'Movies, Music & Video Games',
    slug: 'movies',
    brands: ['Marvel', 'Disney', 'Sony Music', 'Universal', 'Nintendo', 'PlayStation'],
    subcategories: ['Movies & TV', 'Music', 'Video Games', 'Gaming Accessories', 'Instruments', 'Collectibles'],
  },
]

const EXTRA_BRANDS = ['Boat', 'JBL', 'Canon', 'Epson', 'Whirlpool', 'IFB', 'Britannia', 'Amul', 'Nestle', 'Colgate']

const PLAN_AMOUNTS_PAISE = {
  BUYER_MONTHLY: 99900,
  BUYER_ANNUAL: 999900,
  BUYER_LIFETIME: 4999900,
  SELLER_MONTHLY: 99900,
  SELLER_ANNUAL: 999900,
  SELLER_LIFETIME: 4999900,
  BOTH_MONTHLY: 149900,
  BOTH_ANNUAL: 1499900,
  BOTH_LIFETIME: 7999900,
}

module.exports = {
  PASSWORDS,
  ADMIN,
  BUYERS,
  SELLERS,
  MANUAL_ONBOARDING_USERS,
  MANUAL_ONBOARDING_EMAILS,
  MANUAL_TEST_EMAILS,
  PREMIUM_AUTOMATION_BUYER,
  PREMIUM_AUTOMATION_SELLER,
  PREMIUM_AUTOMATION_USERS,
  PREMIUM_QA_BUYER,
  PREMIUM_QA_SELLER,
  PREMIUM_QA_SELLER_2,
  PREMIUM_QA_SELLER_3,
  PREMIUM_QA_BOTH,
  PREMIUM_QA_USERS,
  PREMIUM_USERS,
  PREMIUM_USER_EMAILS,
  PREMIUM_SUBSCRIPTION_SPECS,
  LOGIN_USER_SPECS,
  LOGIN_EMAILS,
  LEGACY_DEMO_EMAILS,
  CATALOG,
  EXTRA_BRANDS,
  PLAN_AMOUNTS_PAISE,
  shouldSeedQaUsers,
  shouldSeedE2eProducts,
}
