import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { BrandLogo } from '../../components/common/BrandLogo.jsx'
import { MyDashboardMenu } from '../../components/common/MyDashboardMenu.jsx'
import { SellerIdentity } from '../../components/common/SellerIdentity.jsx'
import { useAuth } from '../../hooks/useAuth.js'
import { getWishlistItems, removeWishlistItem } from '../../utils/wishlistStorage.js'
import { ProductImage } from '../../components/common/ProductImage.jsx'

function formatMoney(value) {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)
}


export function WishlistPage() {
  const { user, isAuthenticated, initialized: authInitialized } = useAuth()
  const [items, setItems] = useState(() => getWishlistItems())

  useEffect(() => {
    const sync = () => setItems(getWishlistItems())
    window.addEventListener('storage', sync)
    window.addEventListener('wishlist:changed', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('wishlist:changed', sync)
    }
  }, [])

  function handleRemove(id) {
    setItems(removeWishlistItem(id))
    toast.success('Removed from wishlist.')
  }

  return (
    <div className="wishlistPage">
      <header className="mpHeader">
        <div className="mpHeader__inner">
          <Link to="/" className="mpBrand" aria-label="Bold and Wise home">
            <BrandLogo size="nav" alt="" className="mpBrand__logo" />
            <span className="mpBrand__title">Bold and Wise</span>
          </Link>
          <nav className="mpNav" aria-label="Primary">
            <Link to="/products" className="mpNav__link">Products</Link>
            <Link to="/wishlist" className="mpNav__link mpNav__link--active">Wishlist</Link>
            {authInitialized && isAuthenticated ? (
              <MyDashboardMenu
                linkClassName="mpNav__link mpNav__link--dashboard"
                menuClassName="dashboardMenu dashboardMenu--mpNav"
              />
            ) : null}
          </nav>
        </div>
      </header>

      <main className="wishlistMain">
        <div className="wishlistHead">
          <h1>Wishlist</h1>
          <p>Saved products for {user?.companyName || 'your buyer account'}.</p>
        </div>

        {items.length === 0 ? (
          <section className="wishlistEmpty">
            <h2>No wishlisted products yet</h2>
            <p>Go to the product page and click Wishlist on any product card.</p>
            <Link to="/products" className="btn btn--primary">Browse products</Link>
          </section>
        ) : (
          <section className="wishlistGrid" aria-label="Wishlisted products">
            {items.map((item) => (
              <article key={item.id} className="wishlistCard">
                <Link to={`/products/${item.id}`} className="wishlistCard__mediaLink">
                  <ProductImage
                    product={item}
                    className="wishlistCard__img"
                    alt={item.title || 'Wishlisted product'}
                    loading="lazy"
                    decoding="async"
                    placeholderSize={{ width: 600, height: 600 }}
                  />
                </Link>
                <div className="wishlistCard__body">
                  <h2>
                    <Link to={`/products/${item.id}`} className="wishlistCard__titleLink">
                      {item.title}
                    </Link>
                  </h2>
                  <p className="wishlistCard__meta">{item.category?.name || 'Catalog product'}</p>
                  {item.source === 'seller' && item.seller ? (
                    <SellerIdentity seller={item.seller} compact className="wishlistCard__seller" />
                  ) : null}
                  <p className="wishlistCard__price">₹{formatMoney(item.price)}</p>
                  <div className="wishlistCard__actions">
                    <button
                      type="button"
                      className="btnOutline wishlistCard__remove"
                      onClick={() => handleRemove(item.id)}
                    >
                      Remove
                    </button>
                    <Link to={`/products/${item.id}`} className="btn btn--primary">
                      View product
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}
