import {
  Component,
  input,
  inject,
  signal,
  computed,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import {
  RecommendationService,
  RecommendedProduct,
} from '../../../../core/services/recommendation.service';
import { AuthService } from '../../../core/auth.service';
import { CartService } from '../../../core/cart.service';
import { ToastService } from '../../../core/toast.service';
import { ImageUrlHelper } from '../../../../shared/utils/image-url.helper';
import { ProductCard } from '../product-card/product-card';
import { Product, StockStatus, ProductCondition } from '../../../models/product';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-recommendation-widget',
  standalone: true,
  imports: [CommonModule, RouterLink, ProductCard],
  templateUrl: './recommendation-widget.html',
  styleUrl: './recommendation-widget.scss',
})
export class RecommendationWidget implements OnInit, OnChanges, OnDestroy {
  userId          = input<string | null>(null);
  limit           = input<number>(4);
  title           = input<string>('Recommended For You');
  showInfoCard    = input<boolean>(true);
  /** When set, only show products from this category */
  filterCategory  = input<string | null>(null);
  /** When set, exclude this product ID from results */
  excludeId       = input<string | null>(null);
  /**
   * Context controls which ML endpoint is called:
   *   'home'    → multi-category personalised feed
   *   'product' → same-category items (requires excludeId to be set)
   *   'cart'    → cart-category + complementary (requires cartProductIds)
   *   'generic' → default (category filter if provided, else home)
   */
  context         = input<'home' | 'product' | 'cart' | 'generic'>('generic');
  /** Product IDs currently in the cart — required for context='cart' */
  cartProductIds  = input<string[]>([]);

  private recommendationService = inject(RecommendationService);
  private authService  = inject(AuthService);
  private cartService  = inject(CartService);
  private toastService = inject(ToastService);
  private router       = inject(Router);

  // Cancels any in-flight HTTP request when a new load() is triggered
  private readonly cancel$ = new Subject<void>();

  readonly isLoading        = signal(false);
  readonly enrichedProducts = signal<EnrichedRecommendation[]>([]);
  readonly productCards     = computed<Product[]>(() =>
    this.enrichedProducts().map(rec => this.toProduct(rec))
  );
  readonly error         = signal<string | null>(null);
  readonly algorithmLabel = signal('AI-powered');
  readonly addingToCart  = signal<Record<string, boolean>>({});

  readonly hasRecommendations = computed(() => this.enrichedProducts().length > 0);
  readonly isAuthenticated    = computed(() => this.authService.isAuthenticated());
  readonly isClient           = computed(() => this.authService.userRole() === 'CLIENT');

  ngOnInit(): void { this.load(); }

  ngOnChanges(changes: SimpleChanges): void {
    // For product context: wait until excludeId is actually set before loading.
    // This prevents a premature load with null excludeId that returns wrong-category results.
    const ctx = this.context();
    if (ctx === 'product') {
      // Only (re)load when excludeId becomes non-null, or when it changes to a different product
      if (changes['excludeId'] && this.excludeId()) {
        this.load();
      }
      return;
    }

    // For cart context: only load when cartProductIds becomes non-empty
    if (ctx === 'cart') {
      if (changes['cartProductIds'] && this.cartProductIds().length > 0) {
        this.load();
      }
      return;
    }

    // For home/generic: reload on userId change
    if (changes['userId'] || changes['filterCategory'] || changes['context']) {
      this.load();
    }
  }

  ngOnDestroy(): void {
    this.cancel$.next();
    this.cancel$.complete();
  }

  private load(): void {
    const uid = this.userId() ?? this.authService.currentUser()?.id ?? null;
    if (!uid) return;

    const ctx       = this.context();
    const category  = this.filterCategory();
    const excludeId = this.excludeId();
    const cartPids  = this.cartProductIds();

    // Guard: don't fire product-page request without a product ID
    if (ctx === 'product' && !excludeId) return;

    // Guard: don't fire cart request without cart items
    if (ctx === 'cart' && cartPids.length === 0) return;

    // Cancel any previous in-flight request
    this.cancel$.next();

    this.isLoading.set(true);
    this.error.set(null);

    // Choose the right API call based on context
    let obs$;
    if (ctx === 'cart') {
      obs$ = this.recommendationService.getCartRecommendations(uid, cartPids);
    } else if (ctx === 'product') {
      obs$ = this.recommendationService.getProductPageRecommendations(uid, excludeId!);
    } else {
      obs$ = this.recommendationService.getRecommendations(uid, category ?? undefined);
    }

    obs$.pipe(takeUntil(this.cancel$)).subscribe({
      next: (resp) => {
        this.algorithmLabel.set(this.formatAlgorithm(resp.algorithm_used ?? resp.algorithmUsed));

        let enriched: EnrichedRecommendation[] = (resp.recommendations ?? [])
          .map(rec => ({
            ...rec,
            imageUrl:     rec.image_url ? ImageUrlHelper.toAbsoluteUrl(rec.image_url) : null,
            stock:        rec.in_stock ? 1 : 0,
            isNegotiable: rec.is_negotiable ?? false,
            sellerName:   'Marketplace Seller',
            found:        true,
          }))
          .filter(e => e.name && e.name.trim() !== '');

        // Exclude current product (product page)
        if (excludeId) {
          enriched = enriched.filter(e => e.product_id !== excludeId && e.productId !== excludeId);
        }

        // Hard client-side category guard for product context:
        // Even if the server returns something wrong, enforce the category here.
        if (ctx === 'product' && category) {
          const cat = category.toLowerCase();
          const filtered = enriched.filter(e =>
            e.category && e.category.toLowerCase().includes(cat)
          );
          if (filtered.length > 0) enriched = filtered;
        }

        this.enrichedProducts.set(enriched.slice(0, this.limit()));
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.error.set('Could not load recommendations');
      },
    });
  }

  private toProduct(rec: EnrichedRecommendation): Product {
    return {
      id:           rec.product_id,
      name:         rec.name,
      description:  rec.reason ?? '',
      price:        rec.price,
      category:     rec.category ?? 'Autres',
      imageUrl:     rec.imageUrl ?? '/assets/images/placeholder.png',
      sellerId:     rec.product_id,
      sellerName:   rec.sellerName,
      rating:       4.5,
      reviewsCount: 0,
      stock:        rec.stock,
      stockStatus:  rec.stock > 0 ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
      condition:    ProductCondition.NEW,
      isNegotiable: rec.isNegotiable,
    };
  }

  // ── Cart actions (used by showInfoCard grid) ──────────────────────────────

  addToCart(rec: EnrichedRecommendation, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isAuthenticated()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: `/product/${rec.product_id}` } });
      return;
    }
    if (!this.isClient()) { this.toastService.warning('Only clients can add products to cart'); return; }
    if (rec.stock <= 0)   { this.toastService.error('This product is out of stock'); return; }

    this.addingToCart.update(s => ({ ...s, [rec.product_id]: true }));
    this.cartService.addItem({ productId: rec.product_id, quantity: 1 }).subscribe({
      next: () => {
        this.toastService.success(`${rec.name} added to cart!`, 3000);
        this.addingToCart.update(s => ({ ...s, [rec.product_id]: false }));
        this.trackView(rec.product_id);
      },
      error: () => {
        this.toastService.error('Failed to add to cart.');
        this.addingToCart.update(s => ({ ...s, [rec.product_id]: false }));
      },
    });
  }

  buyNow(rec: EnrichedRecommendation, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isAuthenticated()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: `/product/${rec.product_id}` } });
      return;
    }
    if (rec.stock <= 0) { this.toastService.error('This product is out of stock'); return; }
    this.cartService.addItem({ productId: rec.product_id, quantity: 1 }).subscribe({
      next: () => this.router.navigate(['/cart'], { queryParams: { step: 'PLACE_ORDER' } }),
      error: () => this.toastService.error('Could not proceed to checkout.'),
    });
  }

  isAddingToCart(productId: string): boolean {
    return this.addingToCart()[productId] ?? false;
  }

  trackView(productId: string): void {
    const uid = this.userId() ?? this.authService.currentUser()?.id ?? null;
    if (uid) this.recommendationService.trackInteraction(uid, productId, 'view').subscribe();
  }

  reload(): void { this.load(); }

  scrollRec(direction: -1 | 1): void {
    const el = document.getElementById('row-rec');
    if (el) el.scrollBy({ left: direction * 520, behavior: 'smooth' });
  }

  private formatAlgorithm(algo: string): string {
    if (!algo) return 'AI-powered';
    if (algo.includes('collaborative')) return 'Collaborative Filtering';
    if (algo.includes('popularity'))    return 'Popularity-based';
    if (algo.includes('mock'))          return 'Curated';
    return 'AI-powered';
  }

  getScorePercent(score: number): number { return Math.round(score * 100); }

  getReasonIcon(reason: string): string {
    if (!reason) return '✨';
    const r = reason.toLowerCase();
    if (r.includes('similar') || r.includes('taste'))     return '👥';
    if (r.includes('interest') || r.includes('category')) return '🎯';
    if (r.includes('popular') || r.includes('trending'))  return '🔥';
    if (r.includes('purchase') || r.includes('bought'))   return '🛒';
    return '✨';
  }
}

export interface EnrichedRecommendation extends RecommendedProduct {
  imageUrl:     string | null;
  stock:        number;
  isNegotiable: boolean;
  sellerName:   string;
  found:        boolean;
}
