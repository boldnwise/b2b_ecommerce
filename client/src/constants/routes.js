/**
 * Centralized route path constants. Prefer these over hard-coded strings
 * so renames are safe and discoverable.
 */
export const ROUTES = Object.freeze({
  HOME: '/',
  SUBSCRIBE: '/pricing',
  SUBSCRIBE_BOTH_BUYER: '/subscribe/both/buyer',
  SUBSCRIBE_BOTH_SELLER: '/subscribe/both/seller',
  PRICING: '/pricing',
  PRODUCTS: '/products',
  HELP: '/help',
  CONTACT: '/contact',

  LOGIN: '/session-required',

  ADMIN_LOGIN: '/admin/login',
  ADMIN_ROOT: '/admin',
  ADMIN_BUYERS: '/admin/buyers',
  ADMIN_SELLERS: '/admin/sellers',
  ADMIN_TRANSACTIONS: '/admin/transactions',
  ADMIN_PRICING: '/admin/pricing',

  PORTAL_HOME: '/portal',
  PORTAL_CONTACT_ADMIN: '/portal/contact-admin',

  BUYER_ROOT: '/buyer',
  BUYER_DASHBOARD: '/buyer/dashboard',
  BUYER_PRICING: '/buyer/pricing',
  BUYER_PRODUCTS: '/buyer/products',
  BUYER_TRANSACTIONS: '/buyer/transactions',
  BUYER_QUOTATIONS: '/buyer/quotations',

  SELLER_ROOT: '/seller',
  SELLER_DASHBOARD: '/seller/dashboard',
  SELLER_PRICING: '/seller/pricing',
  SELLER_PRODUCTS: '/seller/products',
  SELLER_TRANSACTIONS: '/seller/transactions',
  SELLER_ADD_PRODUCT: '/seller/add-product',
  SELLER_PRODUCT_LISTED: '/seller/product-listed',
  SELLER_MANAGE_BUYER: '/seller/manage-buyer',
  SELLER_QUOTATIONS: '/seller/quotations',
})
