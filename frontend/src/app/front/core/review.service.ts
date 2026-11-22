import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environment';

export interface ProductReview {
  id: string;
  productId: string;
  productName?: string;
  customerId: string;
  customerName: string;
  orderItemId: string;
  rating: number;
  comment: string;
  createdAt: string;
  verified: boolean;
  approved: boolean;
}

export interface ReviewableOrderItem {
  orderItemId: string;
  productName: string;
}

export interface CreateReviewRequest {
  productId: string;
  customerId: string;
  orderItemId: string;
  rating: number;
  comment: string;
}

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly base = `${environment.apiUrl}/reviews`;

  constructor(private http: HttpClient) {}

  getProductReviews(productId: string): Observable<ProductReview[]> {
    return this.http.get<ProductReview[]>(`${this.base}/products/${productId}`);
  }

  getReviewableOrderItems(productId: string): Observable<ReviewableOrderItem[]> {
    return this.http.get<ReviewableOrderItem[]>(`${this.base}/products/${productId}/can-review`);
  }

  createReview(req: CreateReviewRequest): Observable<ProductReview> {
    return this.http.post<ProductReview>(this.base, req);
  }
}
