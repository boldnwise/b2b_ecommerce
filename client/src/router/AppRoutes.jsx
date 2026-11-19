import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, Outlet, useParams } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute.jsx'
import { PageLoader } from '../components/ui/PageLoader.jsx'
import { ErrorBoundary } from '../components/common/ErrorBoundary.jsx'
import { SessionRequiredPage } from '../pages/common/SessionRequiredPage.jsx'

const SubscriptionPage = lazy(() =>
  import('../pages/seller/SubscriptionPage.jsx').then((m) => ({ default: m.SubscriptionPage })),
)
const SubscribeCheckoutLayout = lazy(() =>
  import('../layouts/SubscribeCheckoutLayout.jsx').then((m) => ({
    default: m.SubscribeCheckoutLayout,
  })),
)
const PricingPlansPage = lazy(() =>
  import('../pages/marketing/PricingPlansPage.jsx').then((m) => ({ default: m.PricingPlansPage })),
)
const MarketingProductsPage = lazy(() =>
  import('../pages/marketing/MarketingProductsPage.jsx').then((m) => ({ default: m.MarketingProductsPage })),
)
const ProductDetailPage = lazy(() =>
  import('../pages/marketing/ProductDetailPage.jsx').then((m) => ({ default: m.ProductDetailPage })),
)
const WishlistPage = lazy(() =>
  import('../pages/marketing/WishlistPage.jsx').then((m) => ({ default: m.WishlistPage })),
)
const HelpPage = lazy(() =>
  import('../pages/marketing/HelpPage.jsx').then((m) => ({ default: m.HelpPage })),
)
const ContactPage = lazy(() =>
  import('../pages/marketing/ContactPage.jsx').then((m) => ({ default: m.ContactPage })),
)
const TermsPage = lazy(() =>
  import('../pages/marketing/LegalPages.jsx').then((m) => ({ default: m.TermsPage })),
)
const PrivacyPolicyPage = lazy(() =>
  import('../pages/marketing/LegalPages.jsx').then((m) => ({ default: m.PrivacyPolicyPage })),
)
const ShippingPolicyPage = lazy(() =>
  import('../pages/marketing/LegalPages.jsx').then((m) => ({ default: m.ShippingPolicyPage })),
)
const CancellationRefundsPage = lazy(() =>
  import('../pages/marketing/LegalPages.jsx').then((m) => ({ default: m.CancellationRefundsPage })),
)
const UserPortalLayout = lazy(() =>
  import('../layouts/UserPortalLayout.jsx').then((m) => ({ default: m.UserPortalLayout })),
)
const PortalHome = lazy(() =>
  import('../pages/portal/PortalHome.jsx').then((m) => ({ default: m.PortalHome })),
)
const ProfilePage = lazy(() =>
  import('../pages/portal/ProfilePage.jsx').then((m) => ({ default: m.ProfilePage })),
)
const BuyerDashboard = lazy(() =>
  import('../pages/buyer/BuyerDashboard.jsx').then((m) => ({ default: m.BuyerDashboard })),
)
const BuyerTransactions = lazy(() =>
  import('../pages/buyer/BuyerTransactions.jsx').then((m) => ({ default: m.BuyerTransactions })),
)
const BuyerPricing = lazy(() =>
  import('../pages/buyer/BuyerPricing.jsx').then((m) => ({ default: m.BuyerPricing })),
)
const BuyerQuotations = lazy(() =>
  import('../pages/buyer/BuyerQuotations.jsx').then((m) => ({ default: m.BuyerQuotations })),
)
const BuyerRfqComparison = lazy(() =>
  import('../pages/buyer/BuyerRfqComparison.jsx').then((m) => ({ default: m.BuyerRfqComparison })),
)
const BuyerBothSellerPricing = lazy(() =>
  import('../pages/buyer/BuyerBothSellerPricing.jsx').then((m) => ({
    default: m.BuyerBothSellerPricing,
  })),
)

const SellerDashboard = lazy(() =>
  import('../pages/seller/SellerDashboard.jsx').then((m) => ({ default: m.SellerDashboard })),
)
const SellerTransactions = lazy(() =>
  import('../pages/seller/SellerTransactions.jsx').then((m) => ({ default: m.SellerTransactions })),
)
const SellerProductListing = lazy(() =>
  import('../pages/seller/SellerProductListing.jsx').then((m) => ({ default: m.SellerProductListing })),
)
const AddNewProduct = lazy(() =>
  import('../pages/seller/AddNewProduct.jsx').then((m) => ({ default: m.AddNewProduct })),
)
const EditProduct = lazy(() =>
  import('../pages/seller/EditProduct.jsx').then((m) => ({ default: m.EditProduct })),
)
const ProductListedSuccessfully = lazy(() =>
  import('../pages/seller/ProductListedSuccessfully.jsx').then((m) => ({ default: m.ProductListedSuccessfully })),
)
const ManageBuyer = lazy(() =>
  import('../pages/seller/ManageBuyer.jsx').then((m) => ({ default: m.ManageBuyer })),
)
const SellerQuotations = lazy(() =>
  import('../pages/seller/SellerQuotations.jsx').then((m) => ({ default: m.SellerQuotations })),
)
const SellerPricing = lazy(() =>
  import('../pages/seller/SellerPricing.jsx').then((m) => ({ default: m.SellerPricing })),
)
const SellerCategoryRequestPage = lazy(() =>
  import('../pages/seller/SellerCategoryRequestPage.jsx').then((m) => ({ default: m.SellerCategoryRequestPage })),
)
const BuyerCategoryRequestPage = lazy(() =>
  import('../pages/seller/SellerCategoryRequestPage.jsx').then((m) => ({ default: m.BuyerCategoryRequestPage })),
)

const AdminLogin = lazy(() =>
  import('../pages/admin/AdminLogin.jsx').then((m) => ({ default: m.AdminLogin })),
)
const AdminLayout = lazy(() =>
  import('../layouts/AdminLayout.jsx').then((m) => ({ default: m.AdminLayout })),
)
const SubscribersDashboard = lazy(() =>
  import('../pages/admin/SubscribersDashboard.jsx').then((m) => ({ default: m.SubscribersDashboard })),
)
const TransactionReports = lazy(() =>
  import('../pages/admin/TransactionReports.jsx').then((m) => ({ default: m.TransactionReports })),
)
const AdminMarketingPricingPage = lazy(() =>
  import('../pages/admin/AdminMarketingPricingPage.jsx').then((m) => ({
    default: m.AdminMarketingPricingPage,
  })),
)
const AdminCategoryPage = lazy(() =>
  import('../pages/admin/AdminCategoryPage.jsx').then((m) => ({ default: m.AdminCategoryPage })),
)
const AdminCategoryRequestsPage = lazy(() =>
  import('../pages/admin/AdminCategoryRequestsPage.jsx').then((m) => ({ default: m.AdminCategoryRequestsPage })),
)
const AdminMessagesPage = lazy(() =>
  import('../pages/admin/AdminMessagesPage.jsx').then((m) => ({ default: m.AdminMessagesPage })),
)
const AdminOverviewDashboard = lazy(() =>
  import('../pages/admin/AdminOverviewDashboard.jsx').then((m) => ({
    default: m.AdminOverviewDashboard,
  })),
)
const AdminDealsList = lazy(() =>
  import('../pages/admin/AdminDealsList.jsx').then((m) => ({ default: m.AdminDealsList })),
)
const AdminDealDetail = lazy(() =>
  import('../pages/admin/AdminDealDetail.jsx').then((m) => ({ default: m.AdminDealDetail })),
)
const AdminDealChargeConfig = lazy(() =>
  import('../pages/admin/AdminDealChargeConfig.jsx').then((m) => ({ default: m.AdminDealChargeConfig })),
)
const BuyerDealsList = lazy(() =>
  import('../pages/buyer/BuyerDealsList.jsx').then((m) => ({ default: m.BuyerDealsList })),
)
const BuyerDealDetail = lazy(() =>
  import('../pages/buyer/BuyerDealDetail.jsx').then((m) => ({ default: m.BuyerDealDetail })),
)
const SellerDealsList = lazy(() =>
  import('../pages/seller/SellerDealsList.jsx').then((m) => ({ default: m.SellerDealsList })),
)
const SellerDealDetail = lazy(() =>
  import('../pages/seller/SellerDealDetail.jsx').then((m) => ({ default: m.SellerDealDetail })),
)
const ContactAdminPage = lazy(() =>
  import('../pages/common/ContactAdminPage.jsx').then((m) => ({ default: m.ContactAdminPage })),
)

const UnauthorizedPage = lazy(() =>
  import('../pages/common/UnauthorizedPage.jsx').then((m) => ({ default: m.UnauthorizedPage })),
)

/** Wrap a lazy page element with a subscription-only guard. */
function buyerSub(element) {
  return <ProtectedRoute subscription="buyer">{element}</ProtectedRoute>
}

function sellerSub(element) {
  return <ProtectedRoute subscription="seller">{element}</ProtectedRoute>
}

function LegacyQuotationRedirect({ base }) {
  const { requestId } = useParams()
  return <Navigate to={requestId ? `${base}/${requestId}` : base} replace />
}

export function AppRoutes() {
  return (
    <ErrorBoundary>
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<SubscriptionPage />} />
        <Route path="/subscribe" element={<Navigate to="/pricing" replace />} />
        <Route
          path="/subscribe/both"
          element={
            <ProtectedRoute>
              <SubscribeCheckoutLayout />
            </ProtectedRoute>
          }
        >
          <Route path="buyer" element={<BuyerPricing />} />
          <Route path="seller" element={<BuyerBothSellerPricing />} />
        </Route>
        <Route path="/pricing" element={<PricingPlansPage />} />
        <Route path="/session-required" element={<SessionRequiredPage />} />
        <Route path="/products/:productId" element={<ProductDetailPage />} />
        <Route path="/products" element={<MarketingProductsPage />} />
        <Route
          path="/wishlist"
          element={
            <ProtectedRoute workspace="buyer" subscription="buyer">
              <WishlistPage />
            </ProtectedRoute>
          }
        />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="/shipping-policy" element={<ShippingPolicyPage />} />
        <Route path="/cancellation-refunds" element={<CancellationRefundsPage />} />

        <Route path="/login" element={<Navigate to="/session-required" replace />} />
        <Route path="/register" element={<Navigate to="/session-required" replace />} />
        <Route
          path="/admin/login"
          element={
            <ProtectedRoute guestOnly>
              <AdminLogin />
            </ProtectedRoute>
          }
        />

        <Route
          element={
            <ProtectedRoute roles={['BUYER', 'SELLER']}>
              <UserPortalLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/portal" element={<PortalHome />} />
          <Route path="/portal/profile" element={<ProfilePage />} />
          <Route path="/portal/contact-admin" element={<ContactAdminPage />} />

          <Route element={<ProtectedRoute workspace="buyer"><Outlet /></ProtectedRoute>}>
            <Route path="/buyer" element={<Navigate to="/buyer/dashboard" replace />} />
            <Route path="/buyer/welcome" element={<Navigate to="/buyer/dashboard" replace />} />
            <Route path="/buyer/dashboard" element={buyerSub(<BuyerDashboard />)} />
            <Route path="/buyer/pricing/both-seller" element={<BuyerBothSellerPricing />} />
            <Route path="/buyer/pricing" element={<BuyerPricing />} />
            <Route path="/buyer/rfqs" element={<Navigate to="/buyer/quotations" replace />} />
            <Route path="/buyer/transactions" element={buyerSub(<BuyerTransactions />)} />
            <Route path="/buyer/deals" element={buyerSub(<BuyerDealsList />)} />
            <Route path="/buyer/deals/:dealId" element={buyerSub(<BuyerDealDetail />)} />
            <Route path="/buyer/quotations" element={buyerSub(<BuyerQuotations />)} />
            <Route path="/buyer/quotations/group/:rfqGroupId" element={buyerSub(<BuyerRfqComparison />)} />
            <Route path="/buyer/quotations/:requestId" element={buyerSub(<BuyerQuotations />)} />
            <Route path="/buyer/negotiate" element={<Navigate to="/buyer/quotations" replace />} />
            <Route path="/buyer/negotiate/:requestId" element={<LegacyQuotationRedirect base="/buyer/quotations" />} />
            <Route path="/buyer/quote-requests" element={<Navigate to="/buyer/quotations" replace />} />
            <Route
              path="/buyer/quote-requests/:requestId"
              element={<LegacyQuotationRedirect base="/buyer/quotations" />}
            />
            <Route path="/buyer/category-request" element={<Navigate to="/buyer/dashboard" replace />} />
            <Route path="/buyer/products" element={<Navigate to="/products" replace />} />
            <Route path="/buyer/contact-admin" element={<Navigate to="/portal/contact-admin" replace />} />
          </Route>

          <Route element={<ProtectedRoute workspace="seller"><Outlet /></ProtectedRoute>}>
            <Route path="/seller" element={<Navigate to="/seller/dashboard" replace />} />
            <Route path="/seller/welcome" element={<Navigate to="/seller/dashboard" replace />} />
            <Route path="/seller/dashboard" element={sellerSub(<SellerDashboard />)} />
            <Route path="/seller/pricing" element={<Navigate to="/seller/dashboard" replace />} />
            <Route path="/seller/transactions" element={sellerSub(<SellerTransactions />)} />
            <Route path="/seller/deals" element={sellerSub(<SellerDealsList />)} />
            <Route path="/seller/deals/:dealId" element={sellerSub(<SellerDealDetail />)} />
            <Route path="/seller/products" element={sellerSub(<SellerProductListing />)} />
            <Route path="/seller/products/:productId/edit" element={sellerSub(<EditProduct />)} />
            <Route path="/seller/add-product" element={sellerSub(<AddNewProduct />)} />
            <Route path="/seller/product-listed" element={sellerSub(<ProductListedSuccessfully />)} />
            <Route path="/seller/manage-buyer" element={sellerSub(<ManageBuyer />)} />
            <Route path="/seller/quotations" element={sellerSub(<SellerQuotations />)} />
            <Route path="/seller/quotations/:requestId" element={sellerSub(<SellerQuotations />)} />
            <Route path="/seller/negotiate" element={<Navigate to="/seller/quotations" replace />} />
            <Route path="/seller/negotiate/:requestId" element={<LegacyQuotationRedirect base="/seller/quotations" />} />
            <Route path="/seller/chat" element={<Navigate to="/seller/quotations" replace />} />
            <Route path="/seller/quote-request" element={<Navigate to="/seller/quotations" replace />} />
            <Route
              path="/seller/quote-request/:requestId"
              element={<LegacyQuotationRedirect base="/seller/quotations" />}
            />
            <Route path="/seller/respond-price" element={<Navigate to="/seller/quotations" replace />} />
            <Route path="/seller/accept-quote" element={<Navigate to="/seller/quotations" replace />} />
            <Route path="/seller/category-request" element={sellerSub(<SellerCategoryRequestPage />)} />
            <Route path="/seller/contact-admin" element={<Navigate to="/portal/contact-admin" replace />} />
          </Route>
        </Route>

        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={['ADMIN']} redirectTo="/admin/login">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminOverviewDashboard />} />
          <Route path="buyers" element={<Navigate to="/admin/subscribers" replace />} />
          <Route path="sellers" element={<Navigate to="/admin/subscribers" replace />} />
          <Route path="subscribers" element={<SubscribersDashboard />} />
          <Route path="transactions" element={<TransactionReports />} />
          <Route path="deals" element={<AdminDealsList />} />
          <Route path="deals/:dealId" element={<AdminDealDetail />} />
          <Route path="deal-charge-configs" element={<AdminDealChargeConfig />} />
          <Route path="pricing" element={<AdminMarketingPricingPage />} />
          <Route path="categories" element={<AdminCategoryPage />} />
          <Route path="category-requests" element={<AdminCategoryRequestsPage />} />
          <Route path="messages" element={<AdminMessagesPage />} />
        </Route>

        <Route path="/unauthorized" element={<UnauthorizedPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  )
}
