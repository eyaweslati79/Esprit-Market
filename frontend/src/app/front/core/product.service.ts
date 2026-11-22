import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, tap, catchError, throwError, map } from 'rxjs';
import { Product } from '../models/product';
import { environment } from '../../../environment';
import { ImageUrlHelper } from '../../shared/utils/image-url.helper';

export interface ProductFilter {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  search?: string;
  sellerId?: string;
  sortBy?: 'price' | 'rating' | 'date';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface ProductListResponse {
  products: Product[];
  total: number;
  page: number;
  totalPages: number;
}

export interface CreateProductRequest {
  name: string;
  description: string;
  shopId: string;
  categoryIds: string[];
  price: number;
  stock: number;
  images?: ProductImageDTO[];
}

export interface ProductImageDTO {
  url: string;
  altText?: string;
}

export interface UpdateProductRequest extends Partial<CreateProductRequest> {
  id: string;
}

// Backend response interface
export interface ProductResponseDTO {
  id: string;
  name: string;
  description: string;
  shopId: string;
  categoryIds: string[];
  price: number;
  stock: number;
  images?: ProductImageDTO[];
  // Enriched fields from backend mapper
  sellerName?: string;
  categoryName?: string;
  stockStatus?: string;
  isAvailable?: boolean;
  // ✅ APPROVAL WORKFLOW FIELDS
  status?: string;
  createdAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectionReason?: string;
  // ── Flash Sale ────────────────────────────────────────────────────────────
  flashSaleActive?: boolean;
  flashSalePrice?: number;
  flashSaleStartTime?: string;
  flashSaleEndTime?: string;
  flashSaleMaxQuantity?: number;
  flashSaleSoldQuantity?: number;
  flashSaleLive?: boolean;
  // ── Rating ────────────────────────────────────────────────────────────────
  averageRating?: number;
  reviewsCount?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private readonly apiUrl = `${environment.apiUrl}/products`;

  // Reactive state
  readonly products = signal<Product[]>([]);
  readonly selectedProduct = signal<Product | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Cache state
  private productsCache: Product[] = [];
  private lastFetchTime = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  constructor(private http: HttpClient) {}

  /**
   * Validate and fix image URL using ImageUrlHelper
   * @param imageUrl - Original image URL
   * @returns Valid image URL or fallback
   */
  private getValidImageUrl(imageUrl: string | undefined): string {
    return ImageUrlHelper.toAbsoluteUrl(imageUrl, '/assets/images/placeholder.png');
  }

  /**
   * Map backend DTO to frontend Product interface
   * Uses enriched fields from backend (sellerName, categoryName, stockStatus)
   * @param dtos - Backend product DTOs
   * @returns Mapped frontend products
   */
  private mapToFrontendProducts(dtos: ProductResponseDTO[]): Product[] {
    return dtos.map(dto => {
      const p: Product = {
        id: dto.id,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        category: dto.categoryName || 'Autres',
        imageUrl: this.getValidImageUrl(dto.images?.[0]?.url),
        images: dto.images?.map(img => this.getValidImageUrl(img.url)) || [],
        sellerId: dto.shopId,
        sellerName: dto.sellerName || 'Unknown Seller',
        rating: dto.averageRating ?? 0,
        reviewsCount: dto.reviewsCount ?? 0,
        stock: dto.stock,
        stockStatus: (dto.stockStatus || 'OUT_OF_STOCK') as any,
        condition: 'NEW' as any,
        isNegotiable: false,
        isAvailable: dto.isAvailable ?? (dto.stock > 0),
        status: dto.status as any,
        rejectionReason: dto.rejectionReason,
        flashSaleActive: dto.flashSaleActive,
        flashSalePrice: dto.flashSalePrice,
        flashSaleLive: dto.flashSaleLive,
      };
      // Only parse dates when present (avoids unnecessary Date allocations)
      if (dto.approvedAt)        p.approvedAt        = new Date(dto.approvedAt);
      if (dto.createdAt)         p.createdAt         = new Date(dto.createdAt);
      if (dto.approvedBy)        p.approvedBy        = dto.approvedBy;
      if (dto.flashSaleStartTime) p.flashSaleStartTime = new Date(dto.flashSaleStartTime);
      if (dto.flashSaleEndTime)   p.flashSaleEndTime   = new Date(dto.flashSaleEndTime);
      if (dto.flashSaleMaxQuantity)  p.flashSaleMaxQuantity  = dto.flashSaleMaxQuantity;
      if (dto.flashSaleSoldQuantity) p.flashSaleSoldQuantity = dto.flashSaleSoldQuantity;
      return p;
    });
  }

  private getStockStatus(stock: number): string {
    if (stock > 10) return 'IN_STOCK';
    if (stock > 0) return 'LOW_STOCK';
    return 'OUT_OF_STOCK';
  }

  /**
   * Get all products with optional filtering
   * IMPORTANT: Backend getAll() does NOT support query parameters yet
   * @param filter - Optional filter parameters (currently ignored by backend)
   * @returns Observable with products list
   */
  /**
   * Get products for the current authenticated provider's shop
   * This endpoint is secured and only returns products belonging to the provider's shop
   */
  getMyProducts(): Observable<Product[]> {
    return this.http.get<ProductResponseDTO[]>(`${this.apiUrl}/mine`).pipe(
      map((dtos) => this.mapToFrontendProducts(dtos)),
      catchError((error) => throwError(() => error))
    );
  }

  getAll(filter?: ProductFilter, forceRefresh = false): Observable<Product[]> {
    const now = Date.now();
    if (!forceRefresh && this.productsCache.length > 0 && (now - this.lastFetchTime < this.CACHE_DURATION)) {
      this.products.set(this.productsCache);
      return of(this.productsCache);
    }

    this.isLoading.set(true);
    return this.http.get<ProductResponseDTO[]>(this.apiUrl).pipe(
      map((dtos) => {
        const products = this.mapToFrontendProducts(dtos);
        this.productsCache = products;
        this.lastFetchTime = Date.now();
        this.products.set(products);
        this.isLoading.set(false);
        return products;
      }),
      catchError((error) => {
        this.error.set('Failed to load products');
        this.isLoading.set(false);
        return throwError(() => error);
      })
    );
  }

  getApprovedProducts(): Observable<Product[]> {
    this.isLoading.set(true);
    return this.http.get<ProductResponseDTO[]>(`${this.apiUrl}/approved`).pipe(
      map((dtos) => {
        const products = this.mapToFrontendProducts(dtos);
        this.products.set(products);
        this.isLoading.set(false);
        return products;
      }),
      catchError((error) => {
        this.error.set('Failed to load approved products');
        this.isLoading.set(false);
        return throwError(() => error);
      })
    );
  }

  getProductsByStatus(status: string): Observable<Product[]> {
    this.isLoading.set(true);
    return this.http.get<ProductResponseDTO[]>(`${this.apiUrl}/status/${status}`).pipe(
      map((dtos) => {
        const products = this.mapToFrontendProducts(dtos);
        this.isLoading.set(false);
        return products;
      }),
      catchError((error) => {
        this.error.set(`Failed to load ${status} products`);
        this.isLoading.set(false);
        return throwError(() => error);
      })
    );
  }

  approveProduct(productId: string): Observable<Product> {
    return this.http.put<ProductResponseDTO>(`${this.apiUrl}/${productId}/approve`, {}).pipe(
      map((dto) => this.mapToFrontendProducts([dto])[0]),
      catchError((error) => { this.error.set('Failed to approve product'); return throwError(() => error); })
    );
  }

  rejectProduct(productId: string, reason: string): Observable<Product> {
    return this.http.put<ProductResponseDTO>(`${this.apiUrl}/${productId}/reject`, { reason }).pipe(
      map((dto) => this.mapToFrontendProducts([dto])[0]),
      catchError((error) => { this.error.set('Failed to reject product'); return throwError(() => error); })
    );
  }

  getById(id: string): Observable<Product> {
    // Check cache first
    const cached = this.productsCache.find(p => p.id === id);
    if (cached) {
      this.selectedProduct.set(cached);
      return of(cached);
    }
    this.isLoading.set(true);
    return this.http.get<ProductResponseDTO>(`${this.apiUrl}/${id}`).pipe(
      map((dto) => {
        const product = this.mapToFrontendProducts([dto])[0];
        this.selectedProduct.set(product);
        this.isLoading.set(false);
        return product;
      }),
      catchError((error) => {
        this.error.set('Failed to load product');
        this.isLoading.set(false);
        return throwError(() => error);
      })
    );
  }

  create(data: CreateProductRequest): Observable<Product> {
    if (!data.categoryIds || data.categoryIds.length === 0) {
      return throwError(() => new Error('Product must have at least one category'));
    }
    this.isLoading.set(true);
    return this.http.post<ProductResponseDTO>(this.apiUrl, data).pipe(
      map((dto) => {
        const product = this.mapToFrontendProducts([dto])[0];
        this.isLoading.set(false);
        this.productsCache = []; // invalidate cache
        return product;
      }),
      catchError((error) => {
        this.error.set('Failed to create product');
        this.isLoading.set(false);
        return throwError(() => error);
      })
    );
  }

  update(id: string, data: Partial<CreateProductRequest>): Observable<Product> {
    this.isLoading.set(true);
    return this.http.put<ProductResponseDTO>(`${this.apiUrl}/${id}`, data).pipe(
      map((dto) => {
        const product = this.mapToFrontendProducts([dto])[0];
        this.isLoading.set(false);
        this.productsCache = []; // invalidate cache
        return product;
      }),
      catchError((error) => {
        this.error.set('Failed to update product');
        this.isLoading.set(false);
        return throwError(() => error);
      })
    );
  }

  delete(id: string): Observable<void> {
    this.isLoading.set(true);
    return this.http.delete<void>(`${this.apiUrl}/${id}`).pipe(
      tap(() => {
        this.isLoading.set(false);
        this.productsCache = this.productsCache.filter(p => p.id !== id);
      }),
      catchError((error) => {
        this.error.set('Failed to delete product');
        this.isLoading.set(false);
        return throwError(() => error);
      })
    );
  }

  /**
   * Get products by category
   * @param category - Category name
   * @returns Observable with product list
   */
  getByCategory(category: string): Observable<Product[]> {
    return this.getAll({ category });
  }

  /**
   * Search products by query string
   * @param query - Search query
   * @returns Observable with matching products
   */
  search(query: string): Observable<Product[]> {
    return this.getAll({ search: query });
  }

  /**
   * Upload image files for a product — sent to backend which uploads to Cloudinary.
   * Only the returned secure URLs are stored in MongoDB.
   */
  uploadProductImages(productId: string, files: File[]): Observable<{ images: { url: string; altText: string }[] }> {
    if (!files || files.length === 0) throw new Error('No files provided');

    const formData = new FormData();
    files.forEach(file => formData.append('files', file, file.name));

    return this.http.post<any>(`${this.apiUrl}/${productId}/images/upload`, formData).pipe(
      map((dto: any) => ({
        images: (dto.images || []).map((img: any) => ({
          url: img.url,
          altText: img.altText || ''
        }))
      })),
      catchError(err => {
        console.error('❌ Image upload error:', err);
        return throwError(() => err);
      })
    );
  }

  /**
   * Delete a product image — removes from MongoDB and Cloudinary.
   */
  deleteProductImage(productId: string, imageUrl: string): Observable<Product> {
    const params = new HttpParams().set('imageUrl', imageUrl);
    return this.http.delete<ProductResponseDTO>(`${this.apiUrl}/${productId}/images`, { params }).pipe(
      map(dto => this.mapToFrontendProducts([dto])[0]),
      catchError(err => {
        console.error('❌ Delete image error:', err);
        return throwError(() => err);
      })
    );
  }

  // ── Flash Sale ──────────────────────────────────────────────────────────────

  startFlashSale(productId: string, flashSalePrice: number, durationHours: 24 | 48 | 72, maxQuantity?: number): Observable<Product> {
    return this.http.post<ProductResponseDTO>(`${this.apiUrl}/${productId}/flash-sale/start`, {
      flashSalePrice,
      durationHours,
      maxQuantity: maxQuantity ?? null
    }).pipe(
      map(dto => this.mapToFrontendProducts([dto])[0]),
      tap(() => { this.productsCache = []; }), // invalidate cache
      catchError(err => { console.error('❌ Flash sale start error:', err); return throwError(() => err); })
    );
  }

  stopFlashSale(productId: string): Observable<Product> {
    return this.http.post<ProductResponseDTO>(`${this.apiUrl}/${productId}/flash-sale/stop`, {}).pipe(
      map(dto => this.mapToFrontendProducts([dto])[0]),
      tap(() => { this.productsCache = []; }),
      catchError(err => { console.error('❌ Flash sale stop error:', err); return throwError(() => err); })
    );
  }

  getLiveFlashSales(): Observable<Product[]> {
    return this.http.get<ProductResponseDTO[]>(`${this.apiUrl}/flash-sales/live`).pipe(
      map(dtos => this.mapToFrontendProducts(dtos)),
      catchError(err => { console.error('❌ Live flash sales error:', err); return throwError(() => err); })
    );
  }
}
