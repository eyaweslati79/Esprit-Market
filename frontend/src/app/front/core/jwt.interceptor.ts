import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable()
export class JwtInterceptor implements HttpInterceptor {
  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Skip auth header for upload endpoints
    if (request.url.includes('/uploads/')) {
      return next.handle(request);
    }

    // Remove skip-auth header if present
    if (request.headers.has('X-Skip-Auth')) {
      request = request.clone({ headers: request.headers.delete('X-Skip-Auth') });
      return next.handle(request);
    }

    const token = localStorage.getItem('authToken');
    if (token) {
      request = request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
    }

    return next.handle(request);
  }
}
