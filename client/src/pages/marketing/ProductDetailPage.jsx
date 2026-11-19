import { Link, useNavigate, useParams } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { BrandLogo } from '../../components/common/BrandLogo.jsx'
import { BackNavButton } from '../../components/common/BackNavButton.jsx'
import { MyDashboardMenu } from '../../components/common/MyDashboardMenu.jsx'
import { ErrorState } from '../../components/common/ErrorState.jsx'
import { SubscribeFeatureAlert } from '../../components/common/SubscribeFeatureAlert.jsx'
import { SellerIdentity } from '../../components/common/SellerIdentity.jsx'
import { RequestQuoteModal } from '../../components/quotation/RequestQuoteModal.jsx'
import { PageLoader } from '../../components/ui/PageLoader.jsx'
import { useAuth } from '../../hooks/useAuth.js'
import { useAppSelector } from '../../hooks/redux.js'
import { selectHasBuyerSubscription } from '../../store/slices/subscriptionSlice.js'
import { fetchCatalogProduct, fetchAlternativeSellerListings } from '../../services/catalog.service.js'
import { addWishlistItem, getWishlistIds } from '../../utils/wishlistStorage.js'
import { formatProductPrice, formatUom } from '../../utils/formatPrice.js'
import { ProductImage } from '../../components/common/ProductImage.jsx'


function formatMoney(n, currency = 'INR') {
  return formatProductPrice(n, currency)
}

export function ProductDetailPage() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const { user, isAuthenticated, initialized: authInitialized } = useAuth()
  const hasBuyerSubscription = useAppSelector(selectHasBuyerSubscription)
  const buyerWorkspace = canAccessBuyerWorkspace(user?.role, hasBuyerSubscription)
  const showRfqButton = !isAuthenticated || buyerWorkspace

  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [wishlisted, setWishlisted] = useState(false)
  const [wishlistSubscribeAlertOpen, setWishlistSubscribeAlertOpen] = useState(false)
  const [quoteModalOpen, setQuoteModalOpen] = useState(false)
  const [quoteSubscribeAlertOpen, setQuoteSubscribeAlertOpen] = useState(false)
  const [alternativeSellers, setAlternativeSellers] = useState([])
  const [selectedAlternativeIds, setSelectedAlternativeIds] = useState(() => new Set())

  const loadProduct = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchCatalogProduct(productId)
      if (!data) {
        setProduct(null)
        setError({ message: 'Product not found' })
        return
      }
      setProduct(data)
    } catch (err) {
      setError({ message: err.message || 'Failed to load product' })
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    loadProduct()
  }, [loadProduct])

  useEffect(() => {
    if (product?.id) {
      setWishlisted(getWishlistIds().has(String(product.id)))
    }
  }, [product?.id])

  useEffect(() => {
    if (!product?.id || product.source !== 'seller') {
      setAlternativeSellers([])
      setSelectedAlternativeIds(new Set())
      return
    }
    let alive = true
    fetchAlternativeSellerListings(product.id)
      .then((items) => {
        if (!alive) return
        setAlternativeSellers(items)
        setSelectedAlternativeIds(new Set())
      })
      .catch(() => {
        if (alive) setAlternativeSellers([])
      })
    return () => {
      alive = false
    }
  }, [product?.id, product?.source])

  const rfqProducts = useMemo(() => {
    if (!product) return []
    const extras = alternativeSellers.filter((item) => selectedAlternativeIds.has(item.id))
    return [product, ...extras]
  }, [product, alternativeSellers, selectedAlternativeIds])

  function toggleAlternativeSeller(id) {
    setSelectedAlternativeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleWishlist = useCallback(() => {
    if (!isAuthenticated) {
      toast('Sign in as a buyer to use the wishlist.', { icon: 'ℹ️' })
      navigate('/session-required')
      return
    }
    if (!buyerWorkspace) {
      toast.error('Buyer workspace access is required for the wishlist.')
      return
    }
    if (!hasBuyerSubscription) {
      setWishlistSubscribeAlertOpen(true)
      toast('Subscribe to use the wishlist feature.', { icon: 'ℹ️', duration: 5000 })
      return
    }
    addWishlistItem(product)
    setWishlisted(true)
    toast.success(`"${product.title}" wishlisted.`)
  }, [hasBuyerSubscription, isAuthenticated, navigate, product, user?.role])

  const handleRequestQuote = useCallback(() => {
    if (!isAuthenticated) {
      toast('Sign in to request a quotation.', { icon: 'ℹ️' })
      navigate('/session-required')
      return
    }
    if (!buyerWorkspace) {
      toast.error('Buyer workspace access is required to request quotations.')
      return
    }
    if (!hasBuyerSubscription) {
      setQuoteSubscribeAlertOpen(true)
      return
    }
    if (product?.source !== 'seller') {
      toast.error('Quotations are available for seller-listed products only.')
      return
    }
    setQuoteModalOpen(true)
  }, [buyerWorkspace, hasBuyerSubscription, isAuthenticated, navigate, product?.source])

  const handleQuoteSuccess = useCallback(
    (data) => {
      const groupId = data?.group?.rfqGroupId
      const requestId = data?.request?.id || data?.group?.requests?.[0]?.id
      if (groupId && (data?.group?.requests?.length || 0) > 1) {
        navigate(`/buyer/quotations/group/${groupId}`)
        return
      }
      if (requestId) navigate(`/buyer/quotations/${requestId}`)
    },
    [navigate],
  )

  return (
    <div className="mpPage mpPage--detail">
      <header className="mpHeader">
        <div className="mpHeader__inner">
          <Link to="/" className="mpBrand" aria-label="Bold and Wise home">
            <BrandLogo size="nav" alt="" className="mpBrand__logo" />
            <span className="mpBrand__title">Bold and Wise</span>
          </Link>

          <nav className="mpNav" aria-label="Primary">
            <Link to="/" className="mpNav__link">Home</Link>
            <Link to="/products" className="mpNav__link mpNav__link--current">Products</Link>
            <Link to="/pricing" className="mpNav__link">Pricing</Link>
            {authInitialized && isAuthenticated ? (
              <MyDashboardMenu
                linkClassName="mpNav__link mpNav__link--dashboard"
                menuClassName="dashboardMenu dashboardMenu--mpNav"
              />
            ) : null}
          </nav>
        </div>
      </header>

      <main className="pdMain">
        <div className="pdShell">
          <BackNavButton fallback="/products" label="← Back" className="backNavBtn backNavBtn--inline" />
          <nav className="pdBreadcrumb" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span aria-hidden>/</span>
            <Link to="/products">Products</Link>
            {product?.category?.name ? (
              <>
                <span aria-hidden>/</span>
                <span>{product.category.name}</span>
              </>
            ) : null}
          </nav>

          {loading ? (
            <div className="pdHero" style={{ animation: 'dealSkeletonPulse 1.2s ease-in-out infinite' }}>
              <div className="pdGallery bvpSkeleton__media" style={{ height: 400, borderRadius: 14 }} />
              <div className="pdBuyBox" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ height: 16, backgroundColor: '#f1f5f9', width: '30%', borderRadius: 4 }} />
                <div style={{ height: 32, backgroundColor: '#f1f5f9', width: '90%', borderRadius: 4 }} />
                <div style={{ height: 16, backgroundColor: '#f1f5f9', width: '40%', borderRadius: 4 }} />
                <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '8px 0' }} />
                <div style={{ height: 24, backgroundColor: '#f1f5f9', width: '50%', borderRadius: 4 }} />
                <div style={{ height: 12, backgroundColor: '#f1f5f9', width: '70%', borderRadius: 4 }} />
                <div style={{ height: 48, backgroundColor: '#f1f5f9', width: '100%', borderRadius: 8, marginTop: 24 }} />
              </div>
            </div>
          ) : error ? (
            <ErrorState
              title="Product unavailable"
              message={error.message}
              onRetry={loadProduct}
              retrying={loading}
            />
          ) : product ? (
            <>
              <article className="pdHero">
                <div className="pdGallery">
                  <ProductImage
                    product={product}
                    className="pdGallery__img"
                    alt={product.title}
                    loading="eager"
                    decoding="async"
                    placeholderSize={{ width: 1200, height: 900 }}
                  />
                </div>

                <div className="pdBuyBox">
                  <p className="pdInfo__eyebrow">{product.category?.name || 'Catalog product'}</p>
                  <h1 className="pdInfo__title">{product.title}</h1>
                  <div className="pdInfo__rating">
                    <span className="pdInfo__stars" aria-hidden>★★★★★</span>
                    <span>4.8 buyer rating</span>
                  </div>

                  <div className="pdInfo__priceBlock">
                    <div className="pdInfo__price">
                      {formatMoney(product.price, product.currency || 'INR')}
                      <span className="pdInfo__priceUnit"> / {formatUom(product.uom)}</span>
                    </div>
                    <p className="pdInfo__priceNote">Wholesale unit price for B2B buyers</p>
                  </div>

                  <div className="pdInfo__supplier">
                    {product.source === 'seller' && product.seller ? (
                      <SellerIdentity seller={product.seller} compact showLabel showId={true} />
                    ) : (
                      <>
                        <strong>Supplier:</strong> {product.brand?.name || '—'}
                      </>
                    )}
                  </div>

                  <div className="pdInfo__actions">
                    {showRfqButton && product.source === 'seller' ? (
                      <button
                        type="button"
                        className="btn btn--primary pdInfo__primaryBtn"
                        onClick={handleRequestQuote}
                      >
                        Request quotation
                      </button>
                    ) : null}
                    <button type="button" className="btnOutline pdInfo__secondaryBtn" onClick={handleWishlist}>
                      {wishlisted ? 'Wishlisted' : 'Add to Wishlist'}
                    </button>
                  </div>
                </div>
              </article>

              <div className="pdLower">
                <section className="pdPanel">
                  <h2>About this product</h2>
                  <p>{product.description || 'No description provided for this catalog item.'}</p>
                </section>

                <section className="pdPanel">
                  <h2>Product details</h2>
                  <dl className="pdFacts">
                    <div><dt>Category</dt><dd>{product.category?.name || '—'}</dd></div>
                    <div><dt>Brand</dt><dd>{product.brand?.name || '—'}</dd></div>
                    <div><dt>Unit of measure</dt><dd>{formatUom(product.uom)}</dd></div>
                    {product.source === 'seller' && product.seller ? (
                      <div className="pdFacts__seller">
                        <dt>Seller</dt>
                        <dd><SellerIdentity seller={product.seller} compact showLabel /></dd>
                      </div>
                    ) : null}
                    <div><dt>Listing ID</dt><dd>{product.id}</dd></div>
                  </dl>
                </section>

                {product.source === 'seller' && alternativeSellers.length ? (
                  <section className="pdPanel">
                    <h2>Request quote from multiple sellers</h2>
                    <p className="panelSub">
                      Include other sellers offering similar products in the same RFQ for side-by-side comparison.
                    </p>
                    <ul className="pdAltSellers">
                      {alternativeSellers.map((item) => (
                        <li key={item.id} className="pdAltSellers__item">
                          <label className="pdAltSellers__label">
                            <input
                              type="checkbox"
                              checked={selectedAlternativeIds.has(item.id)}
                              onChange={() => toggleAlternativeSeller(item.id)}
                            />
                            <span>
                              <SellerIdentity seller={item.seller} compact showLabel />
                              {' · '}
                              {formatMoney(item.price, item.currency || 'INR')}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </main>

      <RequestQuoteModal
        open={quoteModalOpen}
        products={rfqProducts}
        onClose={() => setQuoteModalOpen(false)}
        onSuccess={handleQuoteSuccess}
      />
      <SubscribeFeatureAlert
        open={quoteSubscribeAlertOpen}
        title="Subscribe to request quotations"
        message="Send RFQs to sellers with an active buyer plan."
        onClose={() => setQuoteSubscribeAlertOpen(false)}
        onSubscribe={() => {
          setQuoteSubscribeAlertOpen(false)
          navigate('/pricing')
        }}
      />
      <SubscribeFeatureAlert
        open={wishlistSubscribeAlertOpen}
        title="Subscribe to use wishlist"
        message="Save products to your wishlist with an active buyer plan. Choose a plan on Plans & Pricing to unlock this feature."
        onClose={() => setWishlistSubscribeAlertOpen(false)}
        onSubscribe={() => {
          setWishlistSubscribeAlertOpen(false)
          navigate('/pricing')
        }}
      />
    </div>
  )
}
