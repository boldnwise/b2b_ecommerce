import { Link, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { BrandLogo } from '../../components/common/BrandLogo.jsx'
import { ProductImage } from '../../components/common/ProductImage.jsx'
import { MyDashboardMenu } from '../../components/common/MyDashboardMenu.jsx'
import { SellerIdentity } from '../../components/common/SellerIdentity.jsx'
import { SubscribeFeatureAlert } from '../../components/common/SubscribeFeatureAlert.jsx'
import { RequestQuoteModal } from '../../components/quotation/RequestQuoteModal.jsx'
import { getCategoryLevel } from '../../utils/shopCategoryTree.js'
import { useShopCategoryTree } from '../../hooks/useShopCategoryTree.js'
import { useCatalogProducts } from '../../hooks/useCatalogProducts.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useAppSelector } from '../../hooks/redux.js'
import { selectHasBuyerSubscription } from '../../store/slices/subscriptionSlice.js'
import { canAccessBuyerWorkspace } from '../../utils/portalNav.js'
import { ErrorState } from '../../components/common/ErrorState.jsx'
import { addWishlistItem, getWishlistIds } from '../../utils/wishlistStorage.js'
import { formatProductPrice, formatUom } from '../../utils/formatPrice.js'

const PAGE_SIZE = 12

/** Must match the price slider max; catalog prices are in INR list range ~1k–200k+ */
const DEFAULT_PRICE_CEILING = 200_000

/**
 * Maps the UI top-level category id (from the sidebar tree) to the
 * category slug known to the backend catalog. Unmapped ids are sent
 * through as-is so the backend simply returns an empty result set.
 */
const CATEGORY_SLUG_MAP = {
  mobiles: 'mobiles',
  computers: 'computers',
  tv: 'tv',
  'mens-fashion': 'mens-fashion',
  'womens-fashion': 'womens-fashion',
  'home-kitchen': 'home-kitchen',
  beauty: 'beauty',
  sports: 'sports',
  toys: 'toys',
  car: 'car',
  books: 'books',
  movies: 'movies',
}

/** Brand options per top-level category in the sidebar tree. */
const CATEGORY_BRANDS = {
  mobiles: ['Samsung', 'Apple', 'OnePlus', 'realme', 'Xiaomi', 'vivo', 'Nokia', 'boAt', 'Motorola'],
  computers: ['Dell', 'HP', 'Acer', 'ASUS', 'Samsung', 'Lenovo'],
  tv: ['LG', 'Panasonic', 'Hisense', 'Sony', 'Samsung', 'TCL'],
  'mens-fashion': [
    'Amazon Brand - Symbol',
    'Jockey',
    'Allen Solly',
    'Van Heusen',
    'U.S. Polo Assn.',
    'Peter England',
    'Lymio',
    'XYXX',
    'VINCENT CHASE EYEWEAR',
    'Boldfit',
  ],
  'womens-fashion': [
    'Jockey',
    'GoSriKi',
    'ANNI DESIGNER',
    'GRECIILOOKS',
    'Enamor',
    'Leriya Fashion',
    'Van Heusen',
    'SIRIL',
  ],
  'home-kitchen': [
    'Prestige',
    'Philips',
    'Pigeon',
    'MILTON',
    'Amazon Brand - Solimo',
    'AGARO',
    'Samsung',
    'CELLO',
    'amazon basics',
    'Boldfit',
  ],
  beauty: ['L’Oréal', 'Maybelline', 'Lakmé', 'NIVEA'],
  sports: ['Nike', 'Adidas', 'Puma', 'Reebok'],
  toys: ['Lego', 'Mattel', 'Funskool', 'Hot Wheels'],
  car: ['Bosch', 'Philips', '3M', 'Mahle'],
  books: ['Penguin', 'HarperCollins', 'Rupa', 'Bloomsbury'],
  movies: ['Marvel', 'DC', 'Disney', 'Pixar'],
}

const SORT_OPTIONS = [
  { id: 'best', label: 'Latest' },
  { id: 'price-asc', label: 'Price: Low to High' },
  { id: 'price-desc', label: 'Price: High to Low' },
]

function IconFunnel() {
  return (
    <svg className="mpIcon" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg className="mpIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
      />
    </svg>
  )
}

function IconChevronDown() {
  return (
    <svg className="mpIcon mpIcon--muted" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M7 10l5 5 5-5z" />
    </svg>
  )
}

function IconChevronRight() {
  return (
    <svg className="mpIcon mpShopByCat__chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
    </svg>
  )
}

function IconArrowBack() {
  return (
    <svg className="mpShopByCat__backIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
    </svg>
  )
}

function IconPin() {
  return (
    <svg className="mpIcon mpIcon--pin" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
      />
    </svg>
  )
}

function IconStar() {
  return (
    <svg className="mpIcon mpIcon--star" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
      />
    </svg>
  )
}

function IconChat() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"
      />
    </svg>
  )
}

function IconHeart({ filled = false }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.78-8.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function formatMoney(n, currency = 'INR') {
  return formatProductPrice(n, currency)
}

function useDebouncedValue(value, delay = 400) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return debounced
}

/** Under "Mobiles, Tablets & More", rows that open a sub-menu. */
const MOBILES_SUBMENU_IDS = new Set([
  'm-cases',
  'm-screen',
  'm-power',
  'm-tablets',
  'm-wearable',
  'm-smarthome',
  'm-office',
  'm-software',
])

function categoryItemHasChildren(node, categoryPath) {
  const nested = Boolean(node.children?.length)
  if (!nested) return false
  if (categoryPath.length === 1 && categoryPath[0] === 'mobiles') {
    return MOBILES_SUBMENU_IDS.has(node.id)
  }
  return true
}

export function MarketingProductsPage() {
  const navigate = useNavigate()
  const { user, isAuthenticated, initialized: authInitialized } = useAuth()
  const hasBuyerSubscription = useAppSelector(selectHasBuyerSubscription)
  const buyerWorkspace = canAccessBuyerWorkspace(user?.role, hasBuyerSubscription)
  const showWishlistButton = true
  const showRfqButton = !isAuthenticated || buyerWorkspace
  const [wishlistedIds, setWishlistedIds] = useState(() => getWishlistIds())
  const [wishlistSubscribeAlertOpen, setWishlistSubscribeAlertOpen] = useState(false)
  const [quoteModalOpen, setQuoteModalOpen] = useState(false)
  const [quoteProducts, setQuoteProducts] = useState([])
  const [quoteSubscribeAlertOpen, setQuoteSubscribeAlertOpen] = useState(false)
  const [selectedRfqIds, setSelectedRfqIds] = useState(() => new Set())

  const openWishlistSubscribeAlert = useCallback(() => {
    setWishlistSubscribeAlertOpen(true)
    toast('Subscribe to use the wishlist feature.', { icon: 'ℹ️', duration: 5000 })
  }, [])

  const closeWishlistSubscribeAlert = useCallback(() => {
    setWishlistSubscribeAlertOpen(false)
  }, [])

  const goToPricingFromWishlistAlert = useCallback(() => {
    setWishlistSubscribeAlertOpen(false)
    navigate('/pricing')
  }, [navigate])

  const handleWishlist = useCallback(
    (product) => {
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
        openWishlistSubscribeAlert()
        return
      }
      addWishlistItem(product)
      setWishlistedIds(getWishlistIds())
      toast.success(`"${product?.title || 'Item'}" wishlisted.`)
    },
    [hasBuyerSubscription, isAuthenticated, navigate, openWishlistSubscribeAlert, user?.role],
  )

  const handleRequestQuote = useCallback(
    (product) => {
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
      if (product.source !== 'seller') {
        toast.error('Quotations are available for seller-listed products only.')
        return
      }
      setQuoteProducts([product])
      setQuoteModalOpen(true)
    },
    [buyerWorkspace, hasBuyerSubscription, isAuthenticated, navigate],
  )

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

  function openQuotationHub() {
    if (!isAuthenticated) {
      navigate('/session-required')
      return
    }
    if (!buyerWorkspace) {
      toast.error('Buyer workspace access is required.')
      return
    }
    navigate('/buyer/quotations')
  }

  function supplierDisplayName(product) {
    if (product.source !== 'seller' || !product.seller) {
      return product.brand?.name || '—'
    }
    return null
  }

  const [sortId, setSortId] = useState('best')
  const [priceMax, setPriceMax] = useState(DEFAULT_PRICE_CEILING)

  const [searchInput, setSearchInput] = useState('')
  const debouncedQuery = useDebouncedValue(searchInput, 400)

  const [categoryPath, setCategoryPath] = useState([])
  const [activeLeafCategoryId, setActiveLeafCategoryId] = useState(null)
  const [selectedBrand, setSelectedBrand] = useState('')

  const topLevelCategoryId = categoryPath[0] ?? null

  const [prevTopLevelCategoryId, setPrevTopLevelCategoryId] = useState(topLevelCategoryId)
  if (topLevelCategoryId !== prevTopLevelCategoryId) {
    setPrevTopLevelCategoryId(topLevelCategoryId)
    setSelectedBrand('')
  }

  const { tree: categoryTree, loading: categoriesLoading } = useShopCategoryTree()

  const categoryView = useMemo(
    () => getCategoryLevel(categoryTree || [], categoryPath),
    [categoryTree, categoryPath],
  )

  const brandsForCategory = useMemo(
    () => (topLevelCategoryId ? CATEGORY_BRANDS[topLevelCategoryId] ?? null : null),
    [topLevelCategoryId],
  )
  const showBrandsFilter = !!brandsForCategory?.length

  // Resolve the backend category slug. Leaf subcategories are seeded by their UI id.
  const backendCategorySlug = useMemo(() => {
    if (activeLeafCategoryId) return activeLeafCategoryId
    if (categoryPath.length > 1) return categoryPath[categoryPath.length - 1]
    if (!topLevelCategoryId) return ''
    return CATEGORY_SLUG_MAP[topLevelCategoryId] ?? topLevelCategoryId
  }, [activeLeafCategoryId, categoryPath, topLevelCategoryId])

  const { items, loading, loadingMore, error, initialized, hasMore, loadMore, retry } = useCatalogProducts(
    {
      q: debouncedQuery,
      category: backendCategorySlug,
      brand: selectedBrand,
      limit: PAGE_SIZE,
    },
  )

  /**
   * Apply client-side sort + price ceiling on the currently loaded items.
   * (Backend always returns by latest; price filters and non-latest sorts
   * are applied locally to avoid backend-spec changes.)
   */
  const visibleItems = useMemo(() => {
    const filtered = items.filter((p) => Number(p.price) <= priceMax)
    if (sortId === 'price-asc') return [...filtered].sort((a, b) => Number(a.price) - Number(b.price))
    if (sortId === 'price-desc') return [...filtered].sort((a, b) => Number(b.price) - Number(a.price))
    return filtered
  }, [items, sortId, priceMax])

  const selectedRfqProducts = useMemo(
    () => items.filter((item) => selectedRfqIds.has(item.id)),
    [items, selectedRfqIds],
  )

  const toggleRfqSelection = useCallback((product) => {
    if (product.source !== 'seller') return
    setSelectedRfqIds((prev) => {
      const next = new Set(prev)
      if (next.has(product.id)) next.delete(product.id)
      else next.add(product.id)
      return next
    })
  }, [])

  const openMultiSellerRfq = useCallback(() => {
    if (!selectedRfqProducts.length) return
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
    setQuoteProducts(selectedRfqProducts)
    setQuoteModalOpen(true)
  }, [buyerWorkspace, hasBuyerSubscription, isAuthenticated, navigate, selectedRfqProducts])

  const loadSentinelRef = useRef(null)
  useEffect(() => {
    const el = loadSentinelRef.current
    if (!el || !hasMore || loading || loadingMore) return undefined

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { root: null, rootMargin: '200px', threshold: 0 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, loading, loadingMore, loadMore, visibleItems.length])

  const toggleBrand = useCallback((name) => {
    setSelectedBrand((prev) => (prev === name ? '' : name))
  }, [])

  const clearAllFilters = useCallback(() => {
    setSearchInput('')
    setSelectedBrand('')
    setCategoryPath([])
    setActiveLeafCategoryId(null)
    setPriceMax(DEFAULT_PRICE_CEILING)
    setSortId('best')
  }, [])

  return (
    <div className="mpPage">
      <header className="mpHeader">
        <div className="mpHeader__inner">
          <Link to="/" className="mpBrand" aria-label="Bold and Wise home">
            <BrandLogo size="nav" alt="" className="mpBrand__logo" />
            <span className="mpBrand__title">Bold and Wise</span>
          </Link>

          <div className="mpHeader__searchBlock">
            <form
              className="mpSearch"
              role="search"
              onSubmit={(e) => {
                e.preventDefault()
                // debounce already handles live updates; Enter just forces current value.
                setSearchInput((v) => v)
              }}
            >
              <label className="mpVisuallyHidden" htmlFor="mp-search-type">
                Search in
              </label>
              <div className="mpSelectWrap mpSelectWrap--searchType">
                <select id="mp-search-type" className="mpSelect mpSelect--type" defaultValue="products">
                  <option value="products">Products</option>
                  <option value="suppliers">Suppliers</option>
                </select>
                <IconChevronDown />
              </div>
              <label className="mpVisuallyHidden" htmlFor="mp-q">
                Search query
              </label>
              <input
                id="mp-q"
                type="search"
                className="mpSearch__input"
                placeholder="What are you looking for..."
                autoComplete="off"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <button type="submit" className="mpSearch__btn" aria-label="Search">
                <IconSearch />
              </button>
            </form>
          </div>

          <nav className="mpNav" aria-label="Primary">
            <Link to="/" className="mpNav__link">
              Home
            </Link>
            <Link to="/products" className="mpNav__link">
              Products
            </Link>
            <Link to="/pricing" className="mpNav__link">
              Pricing
            </Link>
            {showWishlistButton ? (
              hasBuyerSubscription && isAuthenticated && buyerWorkspace ? (
                <Link to="/wishlist" className="mpNav__link">
                  Wishlist
                </Link>
              ) : (
                <button
                  type="button"
                  className="mpNav__link mpNav__link--button"
                  onClick={() => {
                    if (!isAuthenticated) {
                      toast('Sign in as a buyer to use the wishlist.', { icon: 'ℹ️' })
                      navigate('/session-required')
                      return
                    }
                    if (!buyerWorkspace) {
                      toast.error('Buyer workspace access is required for the wishlist.')
                      return
                    }
                    openWishlistSubscribeAlert()
                  }}
                >
                  Wishlist
                </button>
              )
            ) : null}
            {authInitialized && isAuthenticated ? (
              <MyDashboardMenu
                linkClassName="mpNav__link mpNav__link--dashboard"
                menuClassName="dashboardMenu dashboardMenu--mpNav"
              />
            ) : null}
          </nav>
        </div>
      </header>

      <div className="mpShell">
        <aside className="mpSidebar" aria-labelledby="mp-filters-heading">
          <div className="mpSidebar__head">
            <IconFunnel />
            <h2 id="mp-filters-heading" className="mpSidebar__title">
              Filters
            </h2>
            {(searchInput || selectedBrand || topLevelCategoryId) && (
              <button
                type="button"
                className="mpSortChip"
                style={{ marginLeft: 'auto' }}
                onClick={clearAllFilters}
              >
                Clear
              </button>
            )}
          </div>

          <div className="mpSidebar__body" role="region" aria-label="Filter options">
            <div className="mpFilterBlock mpFilterBlock--categories">
              <h3 className="mpFilterBlock__title">Categories</h3>
              <nav className="mpShopByCat" aria-label="Shop by category">
                {categoriesLoading ? (
                  <div className="quoteInbox__loading" style={{ padding: '8px 16px', color: 'var(--text-muted)' }}>
                    Loading categories…
                  </div>
                ) : !categoryTree || categoryTree.length === 0 ? (
                  <div style={{ padding: '8px 16px', color: 'var(--text-muted)' }}>
                    No categories found
                  </div>
                ) : (
                  <>
                    {categoryPath.length > 0 ? (
                      <>
                        <button
                          type="button"
                          className="mpShopByCat__back"
                          onClick={() => {
                            setCategoryPath((p) => p.slice(0, -1))
                            setActiveLeafCategoryId(null)
                          }}
                        >
                          <IconArrowBack />
                          <span>{categoryPath.length === 1 ? 'Main menu' : 'Back'}</span>
                        </button>
                        <hr className="mpShopByCat__rule mpShopByCat__rule--afterBack" />
                        <h4 className="mpShopByCat__sectionTitle">{categoryView.sectionTitle}</h4>
                      </>
                    ) : (
                      <p className="mpShopByCat__head">Shop by Category</p>
                    )}
                    <ul className="mpShopByCat__list">
                      {(categoryView.items ?? []).map((node) => {
                        const hasChildren = categoryItemHasChildren(node, categoryPath)
                        const isActive = activeLeafCategoryId === node.id
                        return (
                          <li key={node.id}>
                            <button
                              type="button"
                              className={
                                isActive
                                  ? 'mpShopByCat__row mpShopByCat__row--active'
                                  : 'mpShopByCat__row'
                              }
                              onClick={() => {
                                if (hasChildren) {
                                  setCategoryPath((p) => [...p, node.id])
                                  setActiveLeafCategoryId(null)
                                } else {
                                  setActiveLeafCategoryId(node.id)
                                }
                              }}
                            >
                              <span className="mpShopByCat__label">{node.label}</span>
                              {hasChildren ? <IconChevronRight /> : null}
                            </button>
                            {node.dividerAfter ? <hr className="mpShopByCat__rule" /> : null}
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </nav>
            </div>

            {showBrandsFilter ? (
              <div className="mpFilterBlock mpFilterBlock--mobileExtra">
                <h3 className="mpFilterBlock__title">Brands</h3>
                <ul className="mpSupplierList mpCheckboxFilterList">
                  {brandsForCategory.map((name) => (
                    <li key={name}>
                      <label className="mpSupplierRow mpSupplierRow--textOnly">
                        <input
                          type="checkbox"
                          name={`brand-${name}`}
                          className="mpSupplierRow__check"
                          checked={selectedBrand === name}
                          onChange={() => toggleBrand(name)}
                        />
                        <span className="mpSupplierRow__text">{name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mpFilterBlock">
              <h3 className="mpFilterBlock__title">Price range</h3>
              <div className="mpPriceInputs">
                <input type="number" className="mpInput" defaultValue={0} min={0} aria-label="Minimum price" />
                <span className="mpPriceInputs__dash">—</span>
                <input
                  type="number"
                  className="mpInput"
                  value={priceMax}
                  min={0}
                  onChange={(e) => setPriceMax(Number(e.target.value) || 0)}
                  aria-label="Maximum price"
                />
              </div>
              <div className="mpRangeWrap">
                <input
                  type="range"
                  className="mpRange"
                  min={0}
                  max={200000}
                  step={1000}
                  value={priceMax}
                  onChange={(e) => setPriceMax(Number(e.target.value))}
                  aria-label="Adjust maximum price"
                />
              </div>
            </div>
          </div>
        </aside>

        <div className="mpContent">
          <div className="mpSortBar">
            <span className="mpSortBar__label">Sort by:</span>
            <div className="mpSortBar__opts" role="group" aria-label="Sort options">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={o.id === sortId ? 'mpSortChip mpSortChip--active' : 'mpSortChip'}
                  onClick={() => setSortId(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <span className="mpSortBar__label" style={{ marginLeft: 'auto' }}>
              {loading
                ? 'Loading…'
                : `${visibleItems.length} shown${hasMore ? ' · more available' : ''}`}
            </span>
          </div>

          {error ? (
            <div className="mpGridWrap" style={{ padding: 16 }}>
              <ErrorState
                title="Couldn’t load products"
                message={error.message}
                onRetry={retry}
                retrying={loading}
              />
            </div>
          ) : null}

          <div className="mpGridWrap">
            {loading && visibleItems.length === 0 ? (
              <div className="mpGrid">
                {[...Array(8)].map((_, idx) => (
                  <div key={idx} className="bvpSkeleton" style={{ minHeight: 260 }}>
                    <div className="bvpSkeleton__media" style={{ height: 160 }} />
                    <div className="bvpSkeleton__lines">
                      <div className="bvpSkeleton__line" style={{ width: '80%' }} />
                      <div className="bvpSkeleton__line" style={{ width: '50%' }} />
                      <div className="bvpSkeleton__line" style={{ width: '30%', marginTop: 8 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mpGrid">
                {visibleItems.map((p) => (
                  <article key={p.id} className="mpCard">
                    <div className="mpCard__media">
                      <Link to={`/products/${p.id}`} className="mpCard__link">
                        <ProductImage
                          product={p}
                          className="mpCard__img"
                          alt={p.title || 'Product'}
                          loading="lazy"
                          decoding="async"
                          placeholderSize={{ width: 600, height: 600 }}
                        />
                      </Link>
                      {showWishlistButton ? (
                        <button
                          type="button"
                          className={`mpCard__heartBtn${wishlistedIds.has(String(p.id)) ? ' mpCard__heartBtn--active' : ''}`}
                          aria-label={wishlistedIds.has(String(p.id)) ? 'Remove from wishlist' : 'Add to wishlist'}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleWishlist(p)
                          }}
                        >
                          <IconHeart filled={wishlistedIds.has(String(p.id))} />
                        </button>
                      ) : null}
                    </div>
                    <Link to={`/products/${p.id}`} className="mpCard__link">
                      <div className="mpCard__bodyTop">
                        <h3 className="mpCard__title">{p.title}</h3>
                        <p className="mpCard__price">
                          <strong>{formatMoney(p.price, p.currency || 'INR')}</strong>
                          <span className="mpCard__priceUnit"> / {formatUom(p.uom)}</span>
                        </p>
                      </div>
                    </Link>
                    <div className="mpCard__body">
                      <div className="mpCard__metaRow">
                        <span className="mpCard__loc">
                          <IconPin />
                          {p.source === 'seller' && p.seller ? (
                            <SellerIdentity seller={p.seller} compact showLabel showId={true} />
                          ) : (
                            supplierDisplayName(p) || '—'
                          )}
                        </span>
                        <span className="mpCard__tenure">{p.category?.name || ''}</span>
                        <span className="mpCard__rating">
                          <IconStar /> 4.8
                        </span>
                      </div>
                      {showRfqButton && p.source === 'seller' ? (
                        <div className="mpCard__rfqRow">
                          <label className="mpCard__selectRfq">
                            <input
                              type="checkbox"
                              checked={selectedRfqIds.has(p.id)}
                              onChange={() => toggleRfqSelection(p)}
                              aria-label={`Select ${p.title} for multi-seller RFQ`}
                            />
                            <span>Select for Multi-Seller RFQ</span>
                          </label>
                          <button
                            type="button"
                            className="btn btn--primary mpCard__quote"
                            onClick={() => handleRequestQuote(p)}
                          >
                            Request quotation
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {!loading && initialized && visibleItems.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#6b7280' }}>
                No seller products match your filters yet.
              </div>
            ) : null}

            <div ref={loadSentinelRef} className="mpLoadSentinel" aria-hidden />

            {loadingMore ? (
              <div style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>
                Loading more…
              </div>
            ) : null}

            <span className="mpVisuallyHidden" role="status" aria-live="polite">
              {loading
                ? 'Loading products.'
                : hasMore
                  ? 'More products will load as you scroll.'
                  : `End of listings, ${visibleItems.length} seller products shown.`}
            </span>
          </div>
        </div>
      </div>

      {selectedRfqProducts.length > 0 ? (
        <div className="mpMultiRfqBar">
          <span>{selectedRfqProducts.length} product{selectedRfqProducts.length === 1 ? '' : 's'} selected</span>
          <button type="button" className="btn btn--primary" onClick={openMultiSellerRfq}>
            Send RFQ to {selectedRfqProducts.length} seller{selectedRfqProducts.length === 1 ? '' : 's'}
          </button>
        </div>
      ) : null}

      <button type="button" className="mpQuoteFab" aria-label="Open quotations" onClick={openQuotationHub}>
        <IconChat />
      </button>

      <RequestQuoteModal
        open={quoteModalOpen}
        products={quoteProducts}
        onClose={() => {
          setQuoteModalOpen(false)
          setQuoteProducts([])
        }}
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
        onClose={closeWishlistSubscribeAlert}
        onSubscribe={goToPricingFromWishlistAlert}
      />
    </div>
  )
}
