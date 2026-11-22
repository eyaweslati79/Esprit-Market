import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environment';
import { DeliveryEtaPrediction } from '../models/delivery-eta.models';

export interface EtaCoords {
  originLat: number;
  originLng: number;
  destLat:   number;
  destLng:   number;
}

@Injectable({ providedIn: 'root' })
export class DeliveryEtaService {
  private readonly baseUrl = `${environment.apiUrl}/delivery-eta`;

  constructor(private http: HttpClient) {}

  predict(deliveryId: string): Observable<DeliveryEtaPrediction> {
    return this.http.post<DeliveryEtaPrediction>(`${this.baseUrl}/${deliveryId}/predict`, {});
  }

  /** Predict using exact map coordinates — more accurate than zone-centroid geocoding. */
  predictWithCoords(deliveryId: string, coords: EtaCoords): Observable<DeliveryEtaPrediction> {
    return this.http.post<DeliveryEtaPrediction>(
      `${this.baseUrl}/${deliveryId}/predict-with-coords`, coords
    );
  }

  latest(deliveryId: string): Observable<DeliveryEtaPrediction> {
    return this.http.get<DeliveryEtaPrediction>(`${this.baseUrl}/${deliveryId}/latest`);
  }

  history(deliveryId: string): Observable<DeliveryEtaPrediction[]> {
    return this.http.get<DeliveryEtaPrediction[]>(`${this.baseUrl}/${deliveryId}/history`);
  }
}
