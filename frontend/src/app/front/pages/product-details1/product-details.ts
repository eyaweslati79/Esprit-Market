import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { Product, StockStatus, ProductCondition } from '../../models/product';
import { ProductService } from '../../core/product.service';
import { CartService } from '../../core/cart.service';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { ReviewService, ProductReview, ReviewableOrderItem } from '../../core/review.service';
import { MarketplaceMLService, MarketplaceMLInsight } from '../../core/marketplace-ml.service';
import { NegotiationService } from '../../core/negotiation.service';
import { NegotiationStatus, NegotiationResponse, ProposalStatus } from '../../models/negotiation.model';

@Component({
  selector: 'app-product-details',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, FormsModule],
  templateUrl: './product-details.html',
  styleUrl: './product-details.scss',
})
export class ProductDetails implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private toastService = inject(ToastService);
  private authService = inject(AuthService);
  private reviewService = inject(ReviewService);
  private negotiationService = inject(NegotiationService);
  private fb = inject(FormBuilder);
  readonly mlService = inject(MarketplaceMLService);

  // State
  product = signal<Product | null>(null);
  mlInsight = signal<MarketplaceMLInsight | null>(null);

  // ── Reviews ───────────────────────────────────────────────────────────────
  reviews            = signal<ProductReview[]>([]);
  reviewableItems    = signal<ReviewableOrderItem[]>([]);
  reviewRating       = signal(0);
  reviewHover        = signal(0);
  reviewComment      = '';
  isSubmittingReview = signal(false);
  showReviewModal    = signal(false);
  reviewValidationError = signal<'rating' | 'comment' | 'badword' | null>(null);
  reviewValidationMsg   = signal('');

  // Bad word list — mirrors backend BadWordFilter
  private readonly BAD_WORDS = ['stupid', 'dumb', 'idiot', 'moron'];

  openReviewModal(): void {
    this.reviewRating.set(0);
    this.reviewHover.set(0);
    this.reviewComment = '';
    this.reviewValidationError.set(null);
    this.reviewValidationMsg.set('');
    this.showReviewModal.set(true);
  }

  closeReviewModal(): void {
    this.showReviewModal.set(false);
  }

  onReviewCommentChange(value: string): void {
    this.reviewComment = value;
    // Clear validation error as user types
    if (this.reviewValidationError() === 'comment' || this.reviewValidationError() === 'badword') {
      this.reviewValidationError.set(null);
    }
  }

  private containsBadWord(text: string): string | null {
    const lower = text.toLowerCase();
    for (const word of this.BAD_WORDS) {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(lower)) return word;
    }
    return null;
  }

  private validateReview(): boolean {
    if (this.reviewRating() === 0) {
      this.reviewValidationError.set('rating');
      return false;
    }
    const comment = this.reviewComment.trim();
    if (comment.length < 10) {
      this.reviewValidationError.set('comment');
      this.reviewValidationMsg.set('Review must be at least 10 characters.');
      return false;
    }
    if (comment.length > 500) {
      this.reviewValidationError.set('comment');
      this.reviewValidationMsg.set('Review must be 500 characters or less.');
      return false;
    }
    const badWord = this.containsBadWord(comment);
    if (badWord) {
      this.reviewValidationError.set('badword');
      this.reviewValidationMsg.set(`Please keep your review respectful. The word "${badWord}" is not allowed.`);
      return false;
    }
    this.reviewValidationError.set(null);
    return true;
  }

  readonly hasReviewed = computed(() => {
    const uid = this.authService.currentUser()?.id;
    return uid ? this.reviews().some(r => r.customerId === uid) : false;
  });

  // Any logged-in user can write a review (verified badge shown if they bought it)
  readonly canWriteReview = computed(() =>
    this.authService.isAuthenticated() && !this.hasReviewed()
  );

  readonly avgRating = computed(() => {
    const r = this.reviews();
    if (!r.length) return 0;
    return r.reduce((s, x) => s + x.rating, 0) / r.length;
  });

  readonly reviewRatingLabel = computed(() => {
    const labels = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
    return labels[this.reviewRating()] ?? '';
  });

  setReviewRating(n: number): void { this.reviewRating.set(n); }

  getRatingCount(star: number): number {
    return this.reviews().filter(r => r.rating === star).length;
  }

  getRatingBarPct(star: number): number {
    const total = this.reviews().length;
    return total ? (this.getRatingCount(star) / total) * 100 : 0;
  }

  submitReview(): void {
    if (!this.validateReview()) return;

    const product = this.product();
    const user = this.authService.currentUser();
    if (!product || !user) return;

    // orderItemId is optional — only set if user has a verified purchase
    const item = this.reviewableItems()[0];

    this.isSubmittingReview.set(true);
    this.reviewService.createReview({
      productId: product.id,
      customerId: user.id,
      orderItemId: item?.orderItemId ?? '',   // empty string = not verified
      rating: this.reviewRating(),
      comment: this.reviewComment.trim(),
    }).subscribe({
      next: (review) => {
        this.reviews.update(r => [review, ...r]);
        this.reviewableItems.set([]);
        this.reviewRating.set(0);
        this.reviewComment = '';
        this.isSubmittingReview.set(false);
        this.closeReviewModal();
        this.toastService.success('Review submitted! Thank you. 🌟');
      },
      error: (err) => {
        this.isSubmittingReview.set(false);
        this.toastService.error(err?.error?.message || 'Failed to submit review.');
      }
    });
  }

  images = signal([
    'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?q=80&w=870&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1586528116311-ad86d7c493c8?q=80&w=870&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1544006659-f0b21f04cb1d?q=80&w=870&auto=format&fit=crop'
  ]);

  selectedImage = signal(this.images()[0]);
  quantity = signal(1);
  isAddingToCart = signal(false);
  addedToCart = signal(false);
  activeTab = signal<'description' | 'reviews' | 'negotiation'>('description');

  // Enhanced stock management
  isOutOfStock = computed(() => {
    const product = this.product();
    return !product || product.stock <= 0;
  });
  
  isLowStock = computed(() => {
    const product = this.product();
    return product ? product.stock > 0 && product.stock <= 5 : false;
  });
  
  maxQuantity = computed(() => {
    const product = this.product();
    return product ? Math.min(product.stock, 10) : 0; // Max 10 per purchase
  });
  
  // Enhanced quantity validation
  canIncreaseQuantity = computed(() => this.quantity() < this.maxQuantity());
  canDecreaseQuantity = computed(() => this.quantity() > 1);

  // Stock status information
  stockInfo = computed(() => {
    const product = this.product();
    if (!product) {
      return {
        status: 'loading',
        message: 'Loading product...',
        class: 'text-gray-600 bg-gray-50 border-gray-200',
        icon: '⏳'
      };
    }
    
    const stock = product.stock;
    if (stock <= 0) {
      return {
        status: 'out-of-stock',
        message: 'Currently out of stock',
        class: 'text-red-600 bg-red-50 border-red-200',
        icon: '🚫'
      };
    } else if (stock <= 5) {
      return {
        status: 'low-stock',
        message: `Only ${stock} items left in stock`,
        class: 'text-orange-600 bg-orange-50 border-orange-200',
        icon: '⚡'
      };
    } else {
      return {
        status: 'in-stock',
        message: `${stock} items available`,
        class: 'text-green-600 bg-green-50 border-green-200',
        icon: '✅'
      };
    }
  });

  // Negotiation state
  showNegotiationModal = signal(false);
  negotiationForm!: FormGroup;
  isSubmittingOffer    = signal(false);
  isPredicting         = signal(false);
  hasActiveNegotiation = signal(false);
  negotiationStatus    = signal<NegotiationStatus>(NegotiationStatus.PENDING);
  activeNegotiation    = signal<NegotiationResponse | null>(null);

  // AI prediction result
  aiAcceptProbability = signal<number | null>(null);
  aiExplanation       = signal<string[]>([]);
  aiSuggestedPrice    = signal<number | null>(null);

  // Negotiation history is now driven by the real activeNegotiation signal
  negotiationHistory = computed(() => this.activeNegotiation()?.proposals ?? []);

  // Mock reviews removed — real reviews loaded from backend

  // Related products for AI recommendations
  relatedProducts = signal<Product[]>([
    {
      id: '10',
      name: 'USB-C Hub 7-in-1',
      description: 'All ports you need.',
      price: 65,
      category: 'Electronics',
      imageUrl: 'https://images.unsplash.com/photo-1625723044792-44de16ccb4e9?q=80&w=870&auto=format&fit=crop',
      sellerId: 'seller2',
      sellerName: 'Sarra M.',
      rating: 4.6,
      reviewsCount: 15,
      stock: 3,
      stockStatus: StockStatus.IN_STOCK,
      condition: ProductCondition.NEW,
      isNegotiable: false
    },
    {
      id: '11',
      name: 'Laptop Sleeve 15"',
      description: 'Premium protection.',
      price: 35,
      category: 'Electronics',
      imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?q=80&w=400',
      sellerId: 'seller3',
      sellerName: 'Mehdi B.',
      rating: 4.8,
      reviewsCount: 22,
      stock: 8,
      stockStatus: StockStatus.IN_STOCK,
      condition: ProductCondition.NEW,
      isNegotiable: true
    }
  ]);

  ngOnInit(): void {
    const productId = this.route.snapshot.paramMap.get('id');
    if (productId) {
      this.loadProduct(productId);
    }
    this.initNegotiationForm();
  }

  private initNegotiationForm(): void {
    this.negotiationForm = this.fb.group({
      proposedPrice: [null, [Validators.required, Validators.min(1)]],
      message: ['', [Validators.maxLength(500)]]
    });
  }

  private loadProduct(id: string): void {
    console.log('Loading product:', id);
    
    // ✅ FIXED: Actually load the product from the backend
    this.productService.getById(id).subscribe({
      next: (product) => {
        console.log('✅ Product loaded from backend:', product);
        this.product.set(product);
        
        // Update images if the product has images
        if (product.imageUrl) {
          const productImages = [product.imageUrl];
          this.images.set(productImages);
          this.selectedImage.set(product.imageUrl);
        }

        // Load reviews
        this.reviewService.getProductReviews(product.id).subscribe({
          next: (reviews) => this.reviews.set(reviews),
          error: () => {}
        });

        // Load ML insight (non-blocking)
        this.mlService.getProductInsight(product.id).subscribe({
          next: (insight) => this.mlInsight.set(insight),
          error: () => {}
        });

        // Check if current user can review (verified purchase)
        if (this.authService.isAuthenticated()) {
          this.reviewService.getReviewableOrderItems(product.id).subscribe({
            next: (items) => this.reviewableItems.set(items),
            error: () => {}
          });
        }
      },
      error: (error) => {
        console.error('❌ Failed to load product:', error);
        this.toastService.error('Failed to load product details');
        
        // Fallback: Navigate back to products
        this.router.navigate(['/products']);
      }
    });
  }

  selectImage(img: string): void {
    this.selectedImage.set(img);
  }

  // Enhanced quantity management with stock validation
  increaseQuantity(): void {
    const product = this.product();
    if (!product) return;
    
    const maxStock = product.stock;
    this.quantity.update((q: number) => Math.min(maxStock, q + 1));
  }

  decreaseQuantity(): void {
    this.quantity.update((q: number) => Math.max(1, q - 1));
  }

  // Set quantity directly with validation
  setQuantity(newQuantity: number): void {
    const product = this.product();
    if (!product) return;
    
    const maxStock = product.stock;
    this.quantity.set(Math.max(1, Math.min(maxStock, newQuantity)));
  }

  // Enhanced add to cart with stock validation
  addToCart(): void {
    // ✅ CHECK FOR NULL PRODUCT FIRST
    const product = this.product();
    if (!product) {
      this.toastService.error('Product not loaded yet. Please wait...');
      return;
    }
    
    if (this.isOutOfStock()) {
      this.toastService.error('This product is currently out of stock');
      return;
    }
    
    if (this.quantity() > product.stock) {
      this.toastService.warning('Requested quantity exceeds available stock');
      this.setQuantity(product.stock); // Auto-adjust to max available
      return;
    }
    
    // ✅ ENHANCED VALIDATION: Check data before sending
    const productId = product.id;
    const quantity = this.quantity();
    
    console.log('🔍 Pre-validation check:', {
      productId: productId,
      productIdType: typeof productId,
      quantity: quantity,
      quantityType: typeof quantity,
      product: product
    });
    
    if (!productId) {
      this.toastService.error('Product ID is missing');
      console.error('❌ Product ID is null/undefined:', product);
      return;
    }
    
    if (!quantity || quantity <= 0) {
      this.toastService.error('Please select a valid quantity');
      console.error('❌ Invalid quantity:', quantity);
      return;
    }
    
    this.isAddingToCart.set(true);
    
    // FIXED: Call real CartService with validated data
    this.cartService.addItem({
      productId: productId,
      quantity: quantity
    }).subscribe({
      next: (cartItem) => {
        console.log('✅ Product added to cart:', cartItem);
        this.isAddingToCart.set(false);
        this.addedToCart.set(true);
        
        // Enhanced success message with product info
        const currentProduct = this.product();
        const successMsg = currentProduct 
          ? `${currentProduct.name} x${this.quantity()} added to cart!`
          : `Product x${this.quantity()} added to cart!`;
        this.toastService.success(successMsg);
        
        // Show success for longer if low stock
        const successDuration = this.isLowStock() ? 3000 : 2000;
        setTimeout(() => this.addedToCart.set(false), successDuration);
      },
      error: (error) => {
        console.error('❌ Failed to add product to cart:', error);
        this.isAddingToCart.set(false);
        
        // Enhanced error handling with toast notifications
        if (error.status === 409) {
          this.toastService.error('This item is no longer available. Stock may have changed.');
        } else if (error.status === 400 && error.error?.message?.includes('stock')) {
          this.toastService.error('Insufficient stock available. Please try a smaller quantity.');
        } else if (error.status === 401 || error.status === 403) {
          this.toastService.error('Please log in again to add items to cart.');
        } else if (error.status >= 500) {
          this.toastService.error('Server error. Please try again in a moment.');
        } else {
          this.toastService.error('Failed to add product to cart. Please try again.');
        }
      }
    });
  }

  // Enhanced buy now with stock validation
  buyNow(): void {
    // ✅ CHECK FOR NULL PRODUCT FIRST
    const product = this.product();
    if (!product) {
      this.toastService.error('Product not loaded yet. Please wait...');
      return;
    }
    
    if (this.isOutOfStock()) {
      this.toastService.error('This product is currently out of stock');
      return;
    }
    
    if (this.quantity() > product.stock) {
      this.toastService.warning('Requested quantity exceeds available stock');
      this.setQuantity(product.stock);
      return;
    }
    
    this.isAddingToCart.set(true);
    this.toastService.info('Adding to cart and redirecting to checkout...');
    
    // FIXED: Add to cart first, then navigate after success
    this.cartService.addItem({
      productId: product.id,
      quantity: this.quantity()
    }).subscribe({
      next: (cartItem) => {
        console.log('✅ Product added to cart for immediate purchase:', cartItem);
        this.isAddingToCart.set(false);
        this.addedToCart.set(true);
        
        this.toastService.success('Added to cart! Redirecting to checkout...');
        
        // Navigate to cart after successful add
        setTimeout(() => {
          this.router.navigate(['/cart']);
        }, 500);
      },
      error: (error) => {
        console.error('❌ Failed to add product for purchase:', error);
        this.isAddingToCart.set(false);
        
        // Enhanced error handling with toast notifications
        if (error.status === 409) {
          this.toastService.error('This item is no longer available. Stock may have changed.');
        } else if (error.status === 400 && error.error?.message?.includes('stock')) {
          this.toastService.error('Insufficient stock available. Please try a smaller quantity.');
        } else if (error.status === 401 || error.status === 403) {
          this.toastService.error('Please log in again to make purchases.');
        } else if (error.status >= 500) {
          this.toastService.error('Server error. Please try again in a moment.');
        } else {
          this.toastService.error('Failed to add product to cart. Please try again.');
        }
      }
    });
  }

  toggleFavorite(): void {
    this.product.update(p => p ? ({ ...p, isFavorite: !p.isFavorite }) : p);
  }

  setActiveTab(tab: 'description' | 'reviews' | 'negotiation'): void {
    this.activeTab.set(tab);
  }

  getStarArray(rating: number): boolean[] {
    return Array(5).fill(false).map((_, i) => i < Math.floor(rating));
  }

  hasDiscount(): boolean {
    const p = this.product();
    return p ? !!p.originalPrice && p.originalPrice > p.price : false;
  }

  discountPercentage(): number {
    const p = this.product();
    if (!p || !p.originalPrice || p.originalPrice <= 0) return 0;
    return ((p.originalPrice - p.price) / p.originalPrice) * 100;
  }

  contactSeller(): void {
    const product = this.product();
    if (product) {
      this.router.navigate(['/chat'], { queryParams: { sellerId: product.sellerId } });
    }
  }

  // Negotiation methods
  openNegotiationModal(): void {
    const product = this.product();
    if (!product) return;
    this.showNegotiationModal.set(true);
    this.aiAcceptProbability.set(null);
    this.aiExplanation.set([]);
    this.negotiationForm.patchValue({
      proposedPrice: Math.floor(product.price * 0.9),
      message: ''
    });
    // Run AI prediction immediately with the pre-filled price
    this._runAiPreview(product, Math.floor(product.price * 0.9));
  }

  closeNegotiationModal(): void {
    this.showNegotiationModal.set(false);
    this.negotiationForm.reset();
    this.aiAcceptProbability.set(null);
    this.aiExplanation.set([]);
  }

  /** Called whenever the proposed price changes — updates the AI preview live */
  onProposedPriceChange(): void {
    const product = this.product();
    const price = this.negotiationForm.get('proposedPrice')?.value;
    if (product && price > 0) {
      this._runAiPreview(product, price);
    }
  }

  private _runAiPreview(product: Product, proposedPrice: number): void {
    this.isPredicting.set(true);
    this.negotiationService.predictNegotiation({
      productId: product.id,
      proposedPrice,
      quantity: this.quantity(),
      message: this.negotiationForm.get('message')?.value || ''
    }).subscribe({
      next: (res) => {
        this.isPredicting.set(false);
        if (res.aiAcceptanceProbability != null) {
          this.aiAcceptProbability.set(res.aiAcceptanceProbability);
          this.aiExplanation.set(res.aiExplanation ?? []);
          // Suggest a price that's 5% higher if acceptance is low
          if (res.aiAcceptanceProbability < 0.5) {
            this.aiSuggestedPrice.set(Math.ceil(proposedPrice * 1.05));
          } else {
            this.aiSuggestedPrice.set(null);
          }
        }
      },
      error: () => this.isPredicting.set(false)
    });
  }

  submitOffer(): void {
    if (this.negotiationForm.invalid) {
      this.negotiationForm.markAllAsTouched();
      return;
    }
    const product = this.product();
    if (!product) return;

    this.isSubmittingOffer.set(true);
    const { proposedPrice, message } = this.negotiationForm.value;

    this.negotiationService.createNegotiation({
      productId: product.id,
      proposedPrice,
      quantity: this.quantity(),
      message
    }).subscribe({
      next: (neg) => {
        this.isSubmittingOffer.set(false);
        this.activeNegotiation.set(neg);
        this.hasActiveNegotiation.set(true);
        this.negotiationStatus.set(neg.status);
        this.closeNegotiationModal();
        this.toastService.success('Your offer has been submitted!');
      },
      error: (err) => {
        this.isSubmittingOffer.set(false);
        const msg = err?.error?.message || 'Failed to submit offer. Please try again.';
        this.toastService.error(msg);
      }
    });
  }

  useAiSuggestedPrice(): void {
    const suggested = this.aiSuggestedPrice();
    if (suggested) {
      this.negotiationForm.patchValue({ proposedPrice: suggested });
      this._runAiPreview(this.product()!, suggested);
    }
  }

  acceptOffer(proposalId: string): void {
    const neg = this.activeNegotiation();
    if (!neg) return;
    this.negotiationService.accept(neg.id).subscribe({
      next: (updated) => {
        this.activeNegotiation.set(updated);
        this.negotiationStatus.set(updated.status);
        this.toastService.success('Offer accepted!');
      },
      error: () => this.toastService.error('Failed to accept offer.')
    });
  }

  rejectOffer(proposalId: string): void {
    const neg = this.activeNegotiation();
    if (!neg) return;
    this.negotiationService.reject(neg.id).subscribe({
      next: (updated) => {
        this.activeNegotiation.set(updated);
        this.negotiationStatus.set(updated.status);
        this.toastService.info('Offer rejected.');
      },
      error: () => this.toastService.error('Failed to reject offer.')
    });
  }

  /** Acceptance probability as a percentage string */
  aiProbPct(): string {
    const p = this.aiAcceptProbability();
    return p != null ? `${Math.round(p * 100)}%` : '—';
  }

  /** Tailwind color class for the probability bar */
  aiProbColor(): string {
    const p = this.aiAcceptProbability() ?? 0;
    if (p >= 0.7) return 'bg-green-500';
    if (p >= 0.45) return 'bg-amber-400';
    return 'bg-red-500';
  }

  // Stock status helpers
  getStockStatusClass(status: StockStatus): string {
    switch (status) {
      case StockStatus.IN_STOCK: return 'text-green-600 bg-green-50 border-green-200';
      case StockStatus.LOW_STOCK: return 'text-orange-600 bg-orange-50 border-orange-200';
      case StockStatus.OUT_OF_STOCK: return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  }

  getStockStatusText(status: StockStatus): string {
    switch (status) {
      case StockStatus.IN_STOCK: return 'In Stock';
      case StockStatus.LOW_STOCK: return 'Low Stock';
      case StockStatus.OUT_OF_STOCK: return 'Out of Stock';
      default: return 'Unknown';
    }
  }

  getConditionText(condition: ProductCondition): string {
    return condition.replace('_', ' ');
  }

  getNegotiationStatusClass(status: NegotiationStatus): string {
    switch (status) {
      case NegotiationStatus.PENDING: return 'bg-yellow-100 text-yellow-800';
      case NegotiationStatus.ACCEPTED: return 'bg-green-100 text-green-800';
      case NegotiationStatus.REJECTED: return 'bg-red-100 text-red-800';
      case NegotiationStatus.CLOSED: return 'bg-gray-100 text-gray-800';
      default: return 'bg-blue-100 text-blue-800';
    }
  }

  getProposalStatusClass(status: ProposalStatus): string {
    switch (status) {
      case ProposalStatus.PENDING: return 'bg-yellow-100 text-yellow-700';
      case ProposalStatus.ACCEPTED: return 'bg-green-100 text-green-700';
      case ProposalStatus.REJECTED: return 'bg-red-100 text-red-700';
      case ProposalStatus.COUNTER_OFFERED: return 'bg-blue-100 text-blue-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  }
}
