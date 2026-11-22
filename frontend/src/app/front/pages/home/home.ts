import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { ProductCard } from '../../shared/components/product-card/product-card';
import { RecommendationWidget } from '../../shared/components/recommendation-widget/recommendation-widget';
import { Product, StockStatus, ProductCondition } from '../../models/product';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { ProductService } from '../../core/product.service';
import { AuthService } from '../../core/auth.service';
import { APP_CATEGORIES } from '../../core/categories.config';

interface Promotion {
  id: string;
  title: string;
  description: string;
  discount: number;
  type: 'percentage' | 'fixed';
  code: string;
  expiresAt: Date;
  imageUrl: string;
  backgroundColor: string;
}

@Component({
  selector: 'app-home',
  imports: [ProductCard, RecommendationWidget, CommonModule, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit, OnDestroy {
  private productService = inject(ProductService);
  private authService = inject(AuthService);
  private router = inject(Router);

  // Current logged-in user ID for recommendations
  readonly currentUserId = computed(() => this.authService.currentUser()?.id ?? null);
  readonly isLoggedIn = computed(() => !!this.authService.currentUser());

  // Wheel of Fortune popup
  showWheelPopup = signal(false);

  // Countdown timer — counts to next midnight, resets every 24h
  countdown = signal({ hours: 0, minutes: 0, seconds: 0 });
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  featuredProducts = signal<Product[]>([]);
  flashSaleProducts = signal<Product[]>([]);
  newestProducts = signal<Product[]>([]);
  recommendedProducts = signal<Product[]>([]);

  // Promotions
  promotions = signal<Promotion[]>([
    {
      id: '1',
      title: 'Smart Wearables',
      description: 'Garmin watches & fitness trackers at student prices.',
      discount: 15,
      type: 'percentage',
      code: 'WEAR15',
      expiresAt: new Date('2024-03-31'),
      imageUrl: 'assets/banner/banner1.jfif',
      backgroundColor: 'from-primary to-primary-dark'
    },
    {
      id: '2',
      title: 'Fragrance & Beauty',
      description: 'Premium perfumes & cosmetics — treat yourself.',
      discount: 20,
      type: 'percentage',
      code: 'BEAUTY20',
      expiresAt: new Date('2024-03-15'),
      imageUrl: 'assets/banner/banner2.jfif',
      backgroundColor: 'from-blue-600 to-blue-800'
    },
    {
      id: '3',
      title: 'Gaming Gear',
      description: 'Logitech G502 X & pro peripherals for campus gamers.',
      discount: 10,
      type: 'fixed',
      code: 'GAME10',
      expiresAt: new Date('2024-03-20'),
      imageUrl: 'assets/banner/banner3.jfif',
      backgroundColor: 'from-green-600 to-green-800'
    }
  ]);

  // Categories — single source of truth from categories.config.ts
  categories = signal(APP_CATEGORIES);

  // Hero slideshow — text content per slide (cycles every 6s independently)
  readonly SLIDE_TEXTS = [
    { badge: 'SPECIAL OFFER',     headline: 'HOLIDAY\nSALE',        sub: '30% OFF',              cta: 'Shop Now',       link: '/products' },
    { badge: 'FLASH DEAL',        headline: 'STUDENT\nMARKET',      sub: 'Buy & Sell Easily',    cta: 'Explore',        link: '/products' },
    { badge: 'BEAUTY & CARE',     headline: 'GLOW UP\nDEALS',       sub: 'Up to 40% OFF',        cta: 'Shop Beauty',    link: '/products?category=Beauty' },
    { badge: 'FITNESS',           headline: 'STAY\nACTIVE',         sub: 'Sports Gear Sale',     cta: 'Shop Sports',    link: '/products?category=Sports' },
    { badge: 'NEW ARRIVALS',      headline: 'FRESH\nDROPS',         sub: 'Just Listed Today',    cta: 'See What\'s New', link: '/products' },
    { badge: 'TECH WEEK',         headline: 'LAPTOP\nDEALS',        sub: 'Best Prices on Campus', cta: 'Shop Tech',     link: '/products?category=Electronics' },
    { badge: 'ESPRIT MARKET',     headline: 'SURFACE\nLAPTOP',      sub: 'Premium Devices',      cta: 'View Devices',   link: '/products?category=Electronics' },
    { badge: 'STUDENT PICKS',     headline: 'SURFACE\nPRO',         sub: 'Certified Pre-Owned',  cta: 'Browse Deals',   link: '/products' },
    { badge: 'COSMETICS',         headline: 'AI-CURATED\nBEAUTY',   sub: 'Personalized For You', cta: 'Discover',       link: '/products?category=Beauty' },
    { badge: 'PRODUCTIVITY',      headline: 'NUVOBOOK\nSERIES',     sub: 'Work Smarter',         cta: 'Shop Laptops',   link: '/products?category=Electronics' },
    { badge: 'LIFESTYLE',         headline: 'CAMPUS\nSTYLE',        sub: 'Trending This Week',   cta: 'Shop Now',       link: '/products' },
    { badge: 'DEMO DAY',          headline: 'PRODUCT\nSHOWCASE',    sub: 'Student Innovations',  cta: 'Explore',        link: '/products' },
    { badge: 'SIDE HUSTLE',       headline: 'EARN\nONLINE',         sub: 'Sell on ESPRIT Market', cta: 'Start Selling', link: '/products' },
    { badge: 'SKINCARE',          headline: 'RADIANT\nSKIN',        sub: 'Premium Skincare',     cta: 'Shop Skincare',  link: '/products?category=Beauty' },
    { badge: 'PERIPHERALS',       headline: 'GAMING\nGEAR',         sub: 'Mice, Keyboards & More', cta: 'Shop Gaming',  link: '/products?category=Gaming' },
    { badge: 'ELECTRONICS',       headline: 'SMART\nDEVICES',       sub: 'Top Rated Gadgets',    cta: 'View All',       link: '/products?category=Electronics' },
    { badge: 'ACCESSORIES',       headline: 'LEVEL UP\nYOUR SETUP', sub: 'Cables, Hubs & More',  cta: 'Shop Now',       link: '/products' },
    { badge: 'BACK TO SCHOOL',    headline: 'STUDY\nESSENTIALS',    sub: 'Everything You Need',  cta: 'Shop Now',       link: '/products' },
    { badge: 'FASHION',           headline: 'W CONCEPT\nSTYLE',     sub: 'Campus Fashion Picks', cta: 'Browse Fashion', link: '/products?category=Clothing' },
    { badge: 'FITNESS',           headline: 'STRENGTH\nTRAINING',   sub: 'Dumbbells & Equipment', cta: 'Shop Fitness',  link: '/products?category=Sports' },
  ];

  // Text slide index — changes every 6s
  textSlide      = signal(0);
  textAnimating  = signal(false);
  private textInterval: ReturnType<typeof setInterval> | null = null;

  get currentText() { return this.SLIDE_TEXTS[this.textSlide() % this.SLIDE_TEXTS.length]; }

  private startTextCycle(): void {
    this.textInterval = setInterval(() => {
      this.textAnimating.set(true);
      setTimeout(() => {
        this.textSlide.update(i => (i + 1) % this.SLIDE_TEXTS.length);
        this.textAnimating.set(false);
      }, 400);
    }, 6000);
  }

  // Hero slideshow — images from assets/products/
  readonly SLIDE_IMAGES = [
    'assets/products/@alinessimon #ideogram.jfif',
    'assets/products/AMARO - Sale.jfif',
    'assets/products/beauty.jfif',
    'assets/products/Black Friday Steals For Fitness Lovers.jfif',
    'assets/products/HOME.jfif',
    'assets/products/How To Pack Your Backpack for a Tennis Match.jfif',
    'assets/products/Meet the new Surface Laptop Studio 2.jfif',
    'assets/products/Microsoft Surface 5 - Nachei _.jfif',
    'assets/products/Midjourney V5 prompt cosmetics product rendering stock background advertising AI art.jfif',
    'assets/products/NUVOBOOK SERIES.jfif',
    'assets/products/Photo by Natali Hordiiuk on Unsplash.jfif',
    'assets/products/Product Demos.jfif',
    'assets/products/Simple Online Income Ideas.jfif',
    'assets/products/Skincare on a shiny surface by Beautiful things on @creativemarket.jfif',
    'assets/products/Souris PC _ Comment Choisir votre Souris PC en 2024 _ - Cybertek Blog.jfif',
    'assets/products/télécharger (10).jfif',
    'assets/products/télécharger (11).jfif',
    'assets/products/télécharger (12).jfif',
    'assets/products/w concept.jfif',
    'assets/products/Гантели.jfif',
  ];

  heroSlide      = signal(0);
  heroAnimating  = signal(false);
  protected slideInterval: ReturnType<typeof setInterval> | null = null;

  get heroImage(): string { return this.SLIDE_IMAGES[this.heroSlide()]; }
  get heroTotal(): number { return this.SLIDE_IMAGES.length; }

  goToSlide(i: number): void {
    if (i === this.heroSlide() || this.heroAnimating()) return;
    this.heroAnimating.set(true);
    setTimeout(() => { this.heroSlide.set(i); this.heroAnimating.set(false); }, 400);
  }

  prevSlide(): void { this.goToSlide((this.heroSlide() - 1 + this.heroTotal) % this.heroTotal); }
  nextSlide(): void { this.goToSlide((this.heroSlide() + 1) % this.heroTotal); }

  protected pauseSlideshow(): void {
    if (this.slideInterval) { clearInterval(this.slideInterval); this.slideInterval = null; }
  }

  protected startSlideshow(): void {
    this.pauseSlideshow();
    this.slideInterval = setInterval(() => this.nextSlide(), 3000);
  }

  ngOnInit(): void {
    this.startCountdown();
    this.loadProducts();
    this.startSlideshow();
    this.startTextCycle();

    // Show wheel popup after 1.5s if user is logged in
    setTimeout(() => {
      if (this.isLoggedIn()) {
        const dismissed = sessionStorage.getItem('wheelPopupDismissed');
        if (!dismissed) {
          this.showWheelPopup.set(true);
        }
      }
    }, 1500);
  }

  ngOnDestroy(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    if (this.slideInterval) {
      clearInterval(this.slideInterval);
    }
    if (this.textInterval) {
      clearInterval(this.textInterval);
    }
  }

  private loadProducts(): void {
    this.productService.getAll().subscribe({
      next: (products) => {
        // Flash sale: only products with an active live flash sale
        const flashSale = products.filter(p => p.flashSaleLive === true);
        this.flashSaleProducts.set(flashSale);

        // Newest: sorted by createdAt desc, max 10, exclude flash sale items
        const sorted = [...products]
          .filter(p => !p.flashSaleLive)
          .sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
          });
        this.newestProducts.set(sorted.slice(0, 10));

        // Recommended / trending: next batch
        this.featuredProducts.set(sorted.slice(0, 15));
        this.recommendedProducts.set(sorted.slice(15, 30));

        console.log('✅ Home products loaded:', products.length,
          '| flash:', flashSale.length, '| newest:', this.newestProducts().length);
      },
      error: () => this.setFallbackProducts()
    });
  }

  private setFallbackProducts(): void {
    this.featuredProducts.set([
      {
        id: '1',
        name: 'Modern Laptop Stand',
        description: 'Ergonomic aluminum laptop stand for better productivity.',
        price: 120,
        category: 'Electronics',
        imageUrl: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?q=80&w=870&auto=format&fit=crop',
        sellerId: 'seller1',
        sellerName: 'Amine K.',
        rating: 4.8,
        reviewsCount: 12,
        stock: 5,
        stockStatus: StockStatus.IN_STOCK,
        condition: ProductCondition.NEW,
        isNegotiable: false
      },
      {
        id: '2',
        name: 'Wireless Noise Cancelling Headphones',
        description: 'Premium sound quality with long battery life.',
        price: 350,
        originalPrice: 400,
        category: 'Electronics',
        imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=870&auto=format&fit=crop',
        sellerId: 'seller2',
        sellerName: 'Sarra M.',
        rating: 4.5,
        reviewsCount: 25,
        stock: 2,
        stockStatus: StockStatus.LOW_STOCK,
        condition: ProductCondition.LIKE_NEW,
        isNegotiable: true
      }
    ]);

    this.recommendedProducts.set([
      {
        id: '5',
        name: 'Mechanical Keyboard RGB',
        description: 'Cherry MX switches, full RGB backlighting.',
        price: 180,
        category: 'Gaming',
        imageUrl: 'https://images.unsplash.com/photo-1511467687858-23d96c32e4ae?q=80&w=870&auto=format&fit=crop',
        sellerId: 'seller5',
        sellerName: 'Yassine R.',
        rating: 4.7,
        reviewsCount: 18,
        stock: 8,
        stockStatus: StockStatus.IN_STOCK,
        condition: ProductCondition.NEW,
        isNegotiable: false
      },
      {
        id: '6',
        name: 'USB-C Hub 7-in-1',
        description: 'All ports you need in one compact hub.',
        price: 65,
        category: 'Electronics',
        imageUrl: 'https://images.unsplash.com/photo-1625723044792-44de16ccb4e9?q=80&w=870&auto=format&fit=crop',
        sellerId: 'seller6',
        sellerName: 'Ahmed S.',
        rating: 4.6,
        reviewsCount: 9,
        stock: 12,
        stockStatus: StockStatus.IN_STOCK,
        condition: ProductCondition.NEW,
        isNegotiable: true
      }
    ]);
  }

  private startCountdown(): void {
    const tick = () => {
      const now = new Date();
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0); // next midnight
      const diff = Math.max(0, midnight.getTime() - now.getTime());

      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      this.countdown.set({ hours: h, minutes: m, seconds: s });
    };

    tick(); // set immediately on load
    this.countdownInterval = setInterval(tick, 1000);
  }

  copyPromoCode(code: string): void {
    navigator.clipboard.writeText(code);
  }

  scrollRow(rowId: string, direction: -1 | 1): void {
    const el = document.getElementById(`row-${rowId}`);
    if (el) el.scrollBy({ left: direction * 520, behavior: 'smooth' });
  }

  dismissWheelPopup(): void {
    this.showWheelPopup.set(false);
    sessionStorage.setItem('wheelPopupDismissed', '1');
  }

  goToWheel(): void {
    this.showWheelPopup.set(false);
    this.router.navigate(['/wheel']);
  }
}
