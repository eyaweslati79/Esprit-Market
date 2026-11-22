import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { OrderService } from '../../../core/order.service';
import { AuthService } from '../../../core/auth.service';
import { OrderResponse, OrderStatus } from '../../../models/order.model';

@Component({
  selector: 'app-profile-orders',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="ord-root">

      <!-- ── Left: Orders list ── -->
      <div class="ord-list">
        <div class="ord-header">
          <h2 class="ord-title">My Orders</h2>
          <span class="ord-badge">{{ totalElements() || orders().length }}</span>
        </div>

        @if (isLoading()) {
          <div class="ord-empty">
            <div class="ord-spinner"></div>
            <p>Loading orders...</p>
          </div>
        } @else if (orders().length === 0) {
          <div class="ord-empty">
            <svg class="ord-empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
            <p class="font-semibold" style="color:var(--text-color)">No orders yet</p>
            <p class="text-sm mt-1" style="color:var(--muted)">Start shopping to see your orders here</p>
            <a routerLink="/products" class="ord-cta">Browse Products</a>
          </div>
        } @else {
          <div class="ord-items">
            @for (order of orders(); track order.id) {
              <div class="ord-card">
                <div class="ord-card-head">
                  <div>
                    <span class="ord-num">{{ order.orderNumber }}</span>
                    <span class="ord-status" [ngClass]="getStatusClass(order.status)">{{ order.status }}</span>
                    @if (order.paymentStatus) {
                      <span class="ord-pay" [ngClass]="order.paymentStatus === 'PAID' ? 'ord-pay-paid' : 'ord-pay-pending'">
                        {{ order.paymentStatus }}
                      </span>
                    }
                  </div>
                  <div class="ord-card-right">
                    <span class="ord-amount">{{ order.finalAmount.toFixed(2) }} TND</span>
                    @if ((order.status === 'PENDING' || order.status === 'CONFIRMED') && canCancelOrder(order.id)) {
                      <button (click)="cancelOrder(order.id)" class="ord-cancel-btn">Cancel</button>
                    }
                  </div>
                </div>
                <p class="ord-date">{{ formatDate(order.createdAt) }}</p>
                <div class="ord-products">
                  @for (item of order.items; track item.id) {
                    <div class="ord-product-row">
                      <span class="ord-product-name">{{ item.productName }}</span>
                      <span class="ord-product-price">×{{ item.quantity }} · {{ item.subtotal.toFixed(2) }} TND</span>
                    </div>
                  }
                </div>
                @if (order.deliveryConfirmationCode && order.deliveryStatus !== 'DELIVERED') {
                  <div class="ord-code-box">
                    <span class="ord-code-lbl">Delivery code</span>
                    <span class="ord-code">{{ order.deliveryConfirmationCode }}</span>
                  </div>
                }
                @if (order.status === 'PENDING') {
                  <p class="ord-note">{{ getOrderAgeMessage(order.createdAt) }}</p>
                }
              </div>
            }
          </div>
          @if (totalPages() > 1) {
            <div class="ord-pagination">
              <button (click)="previousPage()" [disabled]="currentPage() === 0" class="ord-page-btn">←</button>
              @for (p of getPageNumbers(); track p) {
                <button (click)="goToPage(p)" class="ord-page-btn" [class.ord-page-active]="currentPage() === p">{{ p + 1 }}</button>
              }
              <button (click)="nextPage()" [disabled]="currentPage() === totalPages()-1" class="ord-page-btn">→</button>
            </div>
          }
        }
      </div>

      <!-- ── Right: Capture Efficiency dark card ── -->
      <div class="ord-eff">

        <!-- Header -->
        <div class="ord-eff-head">
          <h3 class="ord-eff-title">Order <span class="ord-eff-accent">Efficiency</span></h3>
          <p class="ord-eff-sub">ORDER DISTRIBUTION</p>
        </div>

        <!-- Big donut ring -->
        <div class="ord-eff-donut-wrap">
          <svg class="ord-eff-donut" viewBox="0 0 200 200">
            <!-- Background ring -->
            <circle cx="100" cy="100" r="80" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="18"/>
            <!-- Delivered arc (dark red) -->
            <circle cx="100" cy="100" r="80" fill="none" stroke="#8B0000" stroke-width="18"
              stroke-linecap="round"
              [attr.stroke-dasharray]="getEffArc(deliveredCount(), totalElements() || orders().length, 80)"
              stroke-dashoffset="125.6"
              transform="rotate(-90 100 100)"
              class="ord-eff-arc"/>
            <!-- Pending arc (tan/beige) — offset after delivered -->
            <circle cx="100" cy="100" r="80" fill="none" stroke="#c8a97a" stroke-width="18"
              stroke-linecap="round"
              [attr.stroke-dasharray]="getEffArc(pendingCount(), totalElements() || orders().length, 80)"
              [attr.stroke-dashoffset]="getEffOffset(deliveredCount(), totalElements() || orders().length, 80)"
              transform="rotate(-90 100 100)"
              class="ord-eff-arc"/>
          </svg>
          <!-- Center text -->
          <div class="ord-eff-center">
            <span class="ord-eff-pct">{{ deliveryRate() }}%</span>
            <span class="ord-eff-pct-lbl">SUCCESS RATE</span>
          </div>
        </div>

        <!-- Legend rows -->
        <ul class="ord-eff-legend">
          <li class="ord-eff-row">
            <span class="ord-eff-dot" style="background:#8B0000; box-shadow:0 0 8px #8B0000"></span>
            <span class="ord-eff-row-lbl">DELIVERED</span>
            <span class="ord-eff-row-val">{{ getRingPct(deliveredCount(), totalElements() || orders().length) }}%</span>
          </li>
          <li class="ord-eff-row">
            <span class="ord-eff-dot" style="background:#c8a97a; box-shadow:0 0 8px #c8a97a"></span>
            <span class="ord-eff-row-lbl">ACTIVE / PENDING</span>
            <span class="ord-eff-row-val">{{ getRingPct(pendingCount(), totalElements() || orders().length) }}%</span>
          </li>
          <li class="ord-eff-row">
            <span class="ord-eff-dot" style="background:rgba(255,255,255,.25)"></span>
            <span class="ord-eff-row-lbl">OTHER</span>
            <span class="ord-eff-row-val">{{ getRingPct(cancelledCount(), totalElements() || orders().length) }}%</span>
          </li>
        </ul>

        <!-- Total orders badge -->
        <div class="ord-eff-total">
          <span class="ord-eff-total-num">{{ totalElements() || orders().length }}</span>
          <span class="ord-eff-total-lbl">Total Orders · {{ totalSpent() }} TND spent</span>
        </div>

      </div>

    </div>
  `,
  styles: [`
    :host { display: block; }

    .ord-root {
      display: grid;
      grid-template-columns: 1fr 240px;
      gap: 1.25rem;
      align-items: start;
    }

    /* ── Capture Efficiency dark card ── */
    .ord-eff {
      background: linear-gradient(160deg, #0d0000 0%, #1a0000 40%, #2d0505 100%);
      border-radius: 24px;
      padding: 1.5rem 1.25rem;
      position: relative;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,.5);
      border: 1px solid rgba(255,255,255,.06);
      align-self: start;

      /* Subtle radial glow */
      &::before {
        content: '';
        position: absolute;
        top: -40%; left: 50%;
        transform: translateX(-50%);
        width: 200px; height: 200px;
        background: radial-gradient(circle, rgba(139,0,0,.25) 0%, transparent 70%);
        pointer-events: none;
      }
    }

    .ord-eff-head { margin-bottom: 1.25rem; position: relative; z-index: 1; }
    .ord-eff-title {
      font-size: 1.1rem; font-weight: 900; color: #fff;
      margin: 0 0 .2rem; line-height: 1.2;
    }
    .ord-eff-accent { color: #8B0000; }
    .ord-eff-sub {
      font-size: .6rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: .15em;
      color: rgba(255,255,255,.35); margin: 0;
    }

    /* Donut */
    .ord-eff-donut-wrap {
      position: relative;
      display: flex; align-items: center; justify-content: center;
      margin: .5rem 0 1.25rem;
      z-index: 1;
    }
    .ord-eff-donut { width: 160px; height: 160px; }
    .ord-eff-arc { transition: stroke-dasharray 1.2s cubic-bezier(.34,1.56,.64,1); }

    .ord-eff-center {
      position: absolute;
      display: flex; flex-direction: column; align-items: center;
    }
    .ord-eff-pct {
      font-size: 2.2rem; font-weight: 900; color: #fff;
      line-height: 1; letter-spacing: -.04em;
      text-shadow: 0 0 20px rgba(139,0,0,.6);
    }
    .ord-eff-pct-lbl {
      font-size: .5rem; font-weight: 800;
      text-transform: uppercase; letter-spacing: .12em;
      color: #8B0000; margin-top: .15rem;
    }

    /* Legend */
    .ord-eff-legend {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: .65rem;
      border-top: 1px solid rgba(255,255,255,.07);
      padding-top: 1rem;
      position: relative; z-index: 1;
    }

    .ord-eff-row {
      display: flex; align-items: center; gap: .6rem;
      transition: opacity .2s;
      &:hover { opacity: .85; }
    }

    .ord-eff-dot {
      width: 7px; height: 7px; border-radius: 50%;
      flex-shrink: 0;
    }

    .ord-eff-row-lbl {
      flex: 1;
      font-size: .62rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: .1em;
      color: rgba(255,255,255,.45);
    }

    .ord-eff-row-val {
      font-size: .75rem; font-weight: 900; color: #fff;
    }

    /* Total badge */
    .ord-eff-total {
      margin-top: 1rem;
      padding: .65rem .85rem;
      background: rgba(255,255,255,.05);
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,.08);
      display: flex; flex-direction: column; gap: .1rem;
      position: relative; z-index: 1;
    }
    .ord-eff-total-num {
      font-size: 1.4rem; font-weight: 900; color: #fff;
      line-height: 1; letter-spacing: -.03em;
    }
    .ord-eff-total-lbl {
      font-size: .6rem; font-weight: 600;
      color: rgba(255,255,255,.35);
      text-transform: uppercase; letter-spacing: .08em;
    }

    /* ── 3 rings ── */
    .ord-rings {
      display: flex; justify-content: space-between; gap: .4rem;
      margin-bottom: .75rem;
    }
    .ord-ring-wrap {
      flex: 1; display: flex; flex-direction: column; align-items: center;
      cursor: default;
      transition: transform .3s cubic-bezier(.34,1.56,.64,1);
    }
    .ord-ring-wrap:hover { transform: translateY(-3px) scale(1.04); }
    .ord-ring-svg { width: 72px; height: 72px; overflow: visible; }
    .ord-ring-arc { transition: stroke-dasharray 1s cubic-bezier(.34,1.56,.64,1); }
    .ord-ring-center {
      display: flex; flex-direction: column; align-items: center;
      margin-top: .35rem; gap: .05rem;
    }
    .ord-ring-pct { font-size: 1rem; font-weight: 900; line-height: 1; letter-spacing: -.03em; }
    .ord-ring-lbl { font-size: .52rem; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #9ca3af; }
    .ord-ring-val { font-size: .65rem; font-weight: 600; color: #9ca3af; }

    .ord-divider { height: 1px; background: #f1f5f9; margin: .75rem 0; }

    /* ── Stat rows — same icon-box style as profile side stats ── */
    .ord-stat-rows { display: flex; flex-direction: column; gap: .5rem; }

    .ord-srow {
      display: flex; align-items: center; gap: .75rem;
      padding: .5rem .35rem; border-radius: 12px; cursor: default;
      transition: transform .3s cubic-bezier(.34,1.56,.64,1);
    }
    .ord-srow:hover {
      transform: translateX(-3px);
      .ord-srow-num { transform: scale(1.06); }
      .ord-srow-icon svg { transform: scale(1.12) rotate(-5deg); }
    }

    .ord-srow-icon {
      width: 38px; height: 38px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      svg { width: 17px; height: 17px; transition: transform .3s; }
    }

    .ord-srow-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .15rem; }

    .ord-srow-num {
      font-size: 1.3rem; font-weight: 900; color: #111;
      line-height: 1; letter-spacing: -.03em;
      transition: transform .3s cubic-bezier(.34,1.56,.64,1); display: inline-block;
    }

    .ord-srow-lbl {
      font-size: .58rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: .1em; color: #9ca3af;
    }

    .ord-srow-track {
      height: 3px; background: #c8b89a; border-radius: 2px; overflow: hidden;
    }
    .ord-srow-fill {
      height: 100%; border-radius: 2px;
      transition: width .9s cubic-bezier(.34,1.56,.64,1);
    }

    /* ── Orders list ── */
    .ord-list {
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 18px;
      padding: 1.25rem;
    }

    .ord-header {
      display: flex; align-items: center; gap: .75rem;
      margin-bottom: 1rem;
    }

    .ord-title {
      font-size: 1rem; font-weight: 900;
      color: var(--text-color, #111); margin: 0;
    }

    .ord-badge {
      padding: .2rem .65rem; border-radius: 20px;
      font-size: .7rem; font-weight: 800;
      background: rgba(128,0,0,.1); color: #800000;
    }

    .ord-empty {
      text-align: center; padding: 2.5rem 1rem;
      color: var(--muted, #9ca3af);
      display: flex; flex-direction: column; align-items: center; gap: .5rem;
    }

    .ord-empty-icon {
      width: 40px; height: 40px; opacity: .35; margin-bottom: .25rem;
    }

    .ord-cta {
      margin-top: .75rem; padding: .5rem 1.25rem;
      background: #800000; color: #fff;
      font-size: .8rem; font-weight: 800;
      border-radius: 10px; text-decoration: none;
      transition: background .2s;
    }
    .ord-cta:hover { background: #a52a2a; }

    .ord-spinner {
      width: 32px; height: 32px; border-radius: 50%;
      border: 3px solid var(--border, #e5e7eb);
      border-top-color: #800000;
      animation: spin .7s linear infinite;
      margin-bottom: .5rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .ord-items { display: flex; flex-direction: column; gap: .6rem; }

    .ord-card {
      padding: .85rem 1rem;
      border-radius: 12px;
      background: var(--subtle, #f9fafb);
      border: 1px solid var(--border, #e5e7eb);
      transition: box-shadow .25s ease, transform .25s ease;
    }
    .ord-card:hover {
      box-shadow: 0 4px 16px rgba(0,0,0,.08);
      transform: translateY(-1px);
    }

    .ord-card-head {
      display: flex; align-items: flex-start;
      justify-content: space-between; gap: .5rem;
      margin-bottom: .3rem;
    }

    .ord-num {
      font-size: .78rem; font-weight: 900;
      color: var(--text-color, #111);
      margin-right: .4rem;
    }

    .ord-status {
      font-size: .62rem; font-weight: 800;
      padding: .15rem .5rem; border-radius: 20px;
      text-transform: uppercase; letter-spacing: .06em;
    }

    .ord-pay {
      font-size: .62rem; font-weight: 800;
      padding: .15rem .5rem; border-radius: 20px;
      margin-left: .3rem;
    }
    .ord-pay-paid   { background: #dcfce7; color: #166534; }
    .ord-pay-pending { background: #fff7ed; color: #9a3412; }

    .ord-card-right {
      display: flex; align-items: center; gap: .5rem; flex-shrink: 0;
    }

    .ord-amount {
      font-size: .95rem; font-weight: 900; color: #800000;
    }

    .ord-cancel-btn {
      padding: .25rem .65rem; border-radius: 8px;
      background: #ef4444; color: #fff;
      font-size: .65rem; font-weight: 800;
      border: none; cursor: pointer;
      transition: background .2s;
    }
    .ord-cancel-btn:hover { background: #dc2626; }

    .ord-date {
      font-size: .7rem; color: var(--muted, #9ca3af);
      margin: 0 0 .5rem;
    }

    .ord-products {
      display: flex; flex-direction: column; gap: .2rem;
      padding-top: .5rem;
      border-top: 1px solid var(--border, #e5e7eb);
    }

    .ord-product-row {
      display: flex; justify-content: space-between;
      font-size: .72rem;
    }

    .ord-product-name {
      color: var(--text-color, #374151); font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 60%;
    }

    .ord-product-price { color: var(--muted, #9ca3af); }

    .ord-code-box {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: .6rem; padding: .5rem .75rem;
      background: #f0fdf4; border: 1px solid #bbf7d0;
      border-radius: 10px;
    }

    .ord-code-lbl {
      font-size: .65rem; font-weight: 700;
      text-transform: uppercase; color: #166534;
    }

    .ord-code {
      font-size: 1.1rem; font-weight: 900;
      letter-spacing: .2em; color: #166534;
    }

    .ord-note {
      font-size: .68rem; color: var(--muted, #9ca3af);
      margin: .4rem 0 0; font-style: italic;
    }

    /* Pagination */
    .ord-pagination {
      display: flex; align-items: center; justify-content: center;
      gap: .35rem; margin-top: .85rem;
      padding-top: .75rem;
      border-top: 1px solid var(--border, #e5e7eb);
    }

    .ord-page-btn {
      width: 32px; height: 32px; border-radius: 8px;
      font-size: .75rem; font-weight: 800;
      border: 1px solid var(--border, #e5e7eb);
      background: var(--subtle, #f9fafb);
      color: var(--text-color, #374151);
      cursor: pointer; transition: all .2s;
    }
    .ord-page-btn:hover:not(:disabled) { background: #800000; color: #fff; border-color: #800000; }
    .ord-page-btn:disabled { opacity: .35; cursor: not-allowed; }
    .ord-page-active { background: #800000 !important; color: #fff !important; border-color: #800000 !important; }

    /* ── Stats column ── */
    .ord-stats {
      display: flex; flex-direction: column; gap: .85rem;
      padding-top: .25rem;
    }

    .ord-stat-item {
      display: flex; align-items: center; gap: .75rem;
      padding: .5rem .4rem;
      border-radius: 12px;
      cursor: default;
      transition: transform .3s cubic-bezier(.34,1.56,.64,1), background .2s;
    }
    .ord-stat-item:hover {
      transform: translateX(-3px);
      background: rgba(0,0,0,.03);
      .ord-stat-fill { filter: brightness(1.15); }
      .ord-stat-num  { transform: scale(1.06); }
    }

    .ord-stat-icon {
      width: 36px; height: 36px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      svg { width: 16px; height: 16px; transition: transform .3s; }
    }
    .ord-stat-item:hover .ord-stat-icon svg { transform: scale(1.15) rotate(-5deg); }

    .ord-stat-icon-red    { background: rgba(185,28,28,.1);  svg { stroke: #b91c1c; } }
    .ord-stat-icon-green  { background: rgba(22,163,74,.1);  svg { stroke: #16a34a; } }
    .ord-stat-icon-yellow { background: rgba(202,138,4,.1);  svg { stroke: #ca8a04; } }
    .ord-stat-icon-blue   { background: rgba(37,99,235,.1);  svg { stroke: #2563eb; } }

    .ord-stat-body {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column; gap: .2rem;
    }

    .ord-stat-num {
      font-size: 1.35rem; font-weight: 900;
      color: var(--text-color, #111); line-height: 1;
      letter-spacing: -.03em;
      transition: transform .3s cubic-bezier(.34,1.56,.64,1);
      display: inline-block;
    }

    .ord-stat-lbl {
      font-size: .6rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: .1em;
      color: var(--muted, #9ca3af);
    }

    .ord-stat-track {
      height: 3px; background: var(--border, #e5e7eb);
      border-radius: 2px; overflow: hidden;
    }

    .ord-stat-fill {
      height: 100%; border-radius: 2px;
      transition: width .9s cubic-bezier(.34,1.56,.64,1), filter .3s;
    }

    .ord-fill-red    { background: linear-gradient(90deg, #b91c1c, #ef4444); }
    .ord-fill-green  { background: linear-gradient(90deg, #16a34a, #4ade80); }
    .ord-fill-yellow { background: linear-gradient(90deg, #ca8a04, #facc15); }
    .ord-fill-blue   { background: linear-gradient(90deg, #2563eb, #60a5fa); }

    @media (max-width: 640px) {
      .ord-root { grid-template-columns: 1fr; }
      .ord-stats { flex-direction: row; flex-wrap: wrap; }
      .ord-stat-item { flex: 1; min-width: 120px; }
    }
  `]
})
export class ProfileOrdersComponent implements OnInit {
  private orderService = inject(OrderService);
  private authService = inject(AuthService);

  orders = signal<OrderResponse[]>([]);
  isLoading = signal(false);
  cancelPermissions = signal<Map<string, boolean>>(new Map());
  
  // Pagination state
  currentPage = signal(0);
  totalPages = signal(0);
  totalElements = signal(0);
  pageSize = signal(5);

  // ── Stats ──────────────────────────────────────────────────────────────────
  deliveredCount  = computed(() => this.orders().filter(o => o.status === 'DELIVERED').length);
  pendingCount    = computed(() => this.orders().filter(o => o.status === 'PENDING' || o.status === 'CONFIRMED').length);
  cancelledCount  = computed(() => this.orders().filter(o => o.status === 'CANCELLED').length);
  totalSpentNum   = computed(() =>
    this.orders()
      .filter(o => o.status !== 'CANCELLED')
      .reduce((acc, o) => acc + (o.finalAmount || 0), 0)
  );
  totalSpent = computed(() => this.totalSpentNum().toFixed(0));

  // ── Dashboard helpers ──────────────────────────────────────────────────────
  hovStat = '';

  /** Returns SVG stroke-dasharray for a donut arc segment */
  getArc(value: number, total: number, radius: number): string {
    const circumference = 2 * Math.PI * radius;
    if (!total || total === 0) return `0 ${circumference}`;
    const filled = Math.min((value / total) * circumference, circumference);
    return `${filled} ${circumference}`;
  }

  /** Returns bar fill width as a percentage (0–100) */
  getBarWidth(value: number, total: number): number {
    if (!total || total === 0) return 8;
    return Math.max(8, Math.round((value / total) * 100));
  }

  /** Returns stroke-dasharray for individual ring (r=40, circumference≈251.3) */
  getRingDash(value: number, total: number, radius: number): string {
    const circ = 2 * Math.PI * radius;
    if (!total || total === 0) return `0 ${circ}`;
    const filled = Math.min((value / total) * circ, circ);
    return `${filled} ${circ}`;
  }

  /** Returns percentage string for ring center */
  getRingPct(value: number, total: number): number {
    if (!total || total === 0) return 0;
    return Math.round((value / total) * 100);
  }

  /** X coordinate of the dot at the arc end */
  getRingDotX(value: number, total: number, radius: number, cx: number): number {
    const pct = (!total || total === 0) ? 0 : Math.min(value / total, 1);
    const angle = pct * 2 * Math.PI - Math.PI / 2;
    return cx + radius * Math.cos(angle);
  }

  /** Y coordinate of the dot at the arc end */
  getRingDotY(value: number, total: number, radius: number, cy: number): number {
    const pct = (!total || total === 0) ? 0 : Math.min(value / total, 1);
    const angle = pct * 2 * Math.PI - Math.PI / 2;
    return cy + radius * Math.sin(angle);
  }

  ngOnInit(): void {
    this.loadOrders();
  }

  private loadOrders(): void {
    this.isLoading.set(true);
    this.orderService.getMyOrdersPaginated(this.currentPage(), this.pageSize()).subscribe({
      next: (response) => {
        this.orders.set(response.content);
        this.totalPages.set(response.totalPages);
        this.totalElements.set(response.totalElements);
        this.currentPage.set(response.number);
        this.loadCancelPermissions(response.content);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Failed to load orders:', error);
        this.isLoading.set(false);
      }
    });
  }

  private loadCancelPermissions(orders: OrderResponse[]): void {
    const pendingOrders = orders.filter(o => o.status === 'PENDING');
    const permissions = new Map<string, boolean>();
    
    if (pendingOrders.length === 0) {
      this.cancelPermissions.set(permissions);
      return;
    }
    
    let loadedCount = 0;
    
    // Load cancel permissions for all pending orders
    pendingOrders.forEach(order => {
      this.orderService.canClientCancelOrder(order.id).subscribe({
        next: (canCancel) => {
          permissions.set(order.id, canCancel);
          loadedCount++;
          
          // Update signal when all permissions are loaded
          if (loadedCount === pendingOrders.length) {
            this.cancelPermissions.set(new Map(permissions));
          }
        },
        error: (error) => {
          console.error(`Failed to check cancel permission for order ${order.id}:`, error);
          permissions.set(order.id, false);
          loadedCount++;
          
          // Update signal when all permissions are loaded
          if (loadedCount === pendingOrders.length) {
            this.cancelPermissions.set(new Map(permissions));
          }
        }
      });
    });
  }

  canCancelOrder(orderId: string): boolean {
    const canCancel = this.cancelPermissions().get(orderId) || false;
    console.log(`🔍 Can cancel order ${orderId}:`, canCancel);
    return canCancel;
  }

  cancelOrder(orderId: string): void {
    const order = this.orders().find(o => o.id === orderId);
    if (!order) {
      alert('Order not found');
      return;
    }
    
    // Check if order can be cancelled
    if (order.status !== 'PENDING' && order.status !== 'CONFIRMED') {
      alert(`Cannot cancel order with status: ${order.status}. Only PENDING or CONFIRMED orders can be cancelled.`);
      return;
    }
    
    if (!this.canCancelOrder(orderId)) {
      alert('This order cannot be cancelled. Orders can only be cancelled within 7 days of placement.');
      return;
    }
    
    const reason = prompt('Please provide a reason for cancellation:');
    if (!reason || reason.trim() === '') {
      return;
    }
    
    if (!confirm(`Cancel order ${order.orderNumber}?\n\nThis will:\n• Set order status to DECLINED\n• Restore product stock\n\nThis action cannot be undone.`)) {
      return;
    }
    
    this.orderService.declineOrder(orderId, reason).subscribe({
      next: (refundSummary) => {
        console.log('✅ Order cancelled:', refundSummary);
        // Refresh orders list
        this.loadOrders();
        alert(`Order cancelled successfully!\n\nOrder: ${order.orderNumber}\nStock has been restored.`);
      },
      error: (error) => {
        console.error('❌ Failed to cancel order:', error);
        const errorMsg = error.error?.message || 'Failed to cancel order. Please try again.';
        alert(`Error: ${errorMsg}`);
      }
    });
  }

  getStatusClass(status: string): string {
    const statusClasses: Record<string, string> = {
      'PENDING': 'bg-yellow-100 text-yellow-800',
      'CONFIRMED': 'bg-blue-100 text-blue-800',
      'CANCELLED': 'bg-red-100 text-red-800',
      'DELIVERED': 'bg-green-100 text-green-800',
      'RETURNED': 'bg-red-100 text-red-800',
      'RESTOCKED': 'bg-slate-100 text-slate-700'
    };
    return statusClasses[status] || 'bg-gray-100 text-gray-700';
  }

  formatDate(dateString: string): string {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  }

  getOrderAgeMessage(createdAt: string): string {
    const orderDate = new Date(createdAt);
    const now = new Date();
    const diffTime = now.getTime() - orderDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const remainingDays = 7 - diffDays;
    
    if (remainingDays > 0) {
      return `Can cancel for ${remainingDays} more day${remainingDays === 1 ? '' : 's'}`;
    } else {
      return 'Cancellation period expired';
    }
  }

  // Pagination methods
  goToPage(page: number): void {
    if (page >= 0 && page < this.totalPages()) {
      this.currentPage.set(page);
      this.loadOrders();
      this.scrollToTop();
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages() - 1) {
      this.goToPage(this.currentPage() + 1);
    }
  }

  previousPage(): void {
    if (this.currentPage() > 0) {
      this.goToPage(this.currentPage() - 1);
    }
  }

  getPageNumbers(): number[] {
    const total = this.totalPages();
    const current = this.currentPage();
    const pages: number[] = [];
    
    // Show max 5 page numbers
    let start = Math.max(0, current - 2);
    let end = Math.min(total, start + 5);
    
    // Adjust start if we're near the end
    if (end - start < 5) {
      start = Math.max(0, end - 5);
    }
    
    for (let i = start; i < end; i++) {
      pages.push(i);
    }
    
    return pages;
  }

  private scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** stroke-dasharray for the efficiency donut arcs */
  getEffArc(value: number, total: number, radius: number): string {
    const circumference = 2 * Math.PI * radius;
    if (!total || total === 0) return `0 ${circumference}`;
    const filled = Math.min((value / total) * circumference, circumference);
    return `${filled} ${circumference}`;
  }

  /** stroke-dashoffset so the pending arc starts right after the delivered arc */
  getEffOffset(deliveredValue: number, total: number, radius: number): number {
    const circumference = 2 * Math.PI * radius;
    if (!total || total === 0) return circumference;
    const deliveredArc = Math.min((deliveredValue / total) * circumference, circumference);
    // The SVG starts at the top (offset = circumference), so we subtract the delivered arc
    return circumference - deliveredArc;
  }

  /** Delivery success rate as a rounded percentage */
  deliveryRate = computed(() => {
    const total = this.totalElements() || this.orders().length;
    if (!total) return 0;
    return Math.round((this.deliveredCount() / total) * 100);
  });
}
