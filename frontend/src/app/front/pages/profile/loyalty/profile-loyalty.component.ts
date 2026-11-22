import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { LoyaltyService, LoyaltyDashboard } from '../../../core/loyalty.service';
import { LOYALTY_LEVELS } from '../../../models/loyalty.model';

@Component({
  selector: 'app-profile-loyalty',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="rounded-2xl p-6" style="background-color:var(--card-bg);border:1px solid var(--border)">
  <h2 class="text-xl font-black mb-5" style="color:var(--text-color)">🏆 Loyalty Program</h2>

  <!-- Loading -->
  @if (isLoading()) {
    <div class="text-center py-12" style="color:var(--muted)">
      <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto mb-3"></div>
      <p class="text-sm">Loading your loyalty data...</p>
    </div>
  }

  @if (!isLoading() && dashboard()) {

    <!-- ── Points card ── -->
    <div class="rounded-xl p-5 mb-5 bg-gradient-to-br from-primary to-primary-dark text-white relative overflow-hidden">
      <div class="absolute -top-6 -right-6 w-28 h-28 bg-white/10 rounded-full"></div>
      <div class="flex items-start justify-between relative z-10">
        <div>
          <p class="text-xs opacity-70 uppercase tracking-widest mb-1">Your Level</p>
          <p class="text-2xl font-black">{{ getLevelIcon(dashboard()!.loyaltyLevel) }} {{ dashboard()!.loyaltyLevel }}</p>
          @if (dashboard()!.dynamicBoost > 0) {
            <span class="text-[10px] mt-1 bg-white/20 rounded px-2 py-0.5 inline-block font-bold">
              🚀 {{ dashboard()!.boostTier }} Activity Boost: +{{ dashboard()!.dynamicBoost }}
            </span>
          }
        </div>
        <div class="text-right">
          <p class="text-xs opacity-70 uppercase tracking-widest mb-1">Points</p>
          <p class="text-4xl font-black leading-none">{{ dashboard()!.totalPoints }}</p>
          <p class="text-xs opacity-70 mt-1">{{ dashboard()!.currentMultiplier }}x multiplier</p>
        </div>
      </div>
      <!-- Progress bar -->
      <div class="mt-4 relative z-10">
        <div class="w-full bg-white/20 rounded-full h-1.5">
          <div class="bg-white rounded-full h-1.5 transition-all" [style.width.%]="loyaltyProgress()"></div>
        </div>
        @if (dashboard()!.pointsToNextReward) {
          <p class="text-[10px] mt-1 opacity-70">{{ dashboard()!.pointsToNextReward }} pts to next reward tier</p>
        }
      </div>
    </div>

    <!-- ── Stats ── -->
    <div class="grid grid-cols-2 gap-3 mb-5">
      <div class="rounded-xl p-4 text-center" style="background-color:var(--subtle);border:1px solid var(--border)">
        <p class="text-2xl font-black" style="color:var(--text-color)">{{ dashboard()!.ordersThisMonth }}</p>
        <p class="text-xs mt-1" style="color:var(--muted)">Orders This Month</p>
      </div>
      <div class="rounded-xl p-4 text-center" style="background-color:var(--subtle);border:1px solid var(--border)">
        <p class="text-2xl font-black" style="color:var(--text-color)">{{ dashboard()!.totalPointsEarned }}</p>
        <p class="text-xs mt-1" style="color:var(--muted)">Lifetime Points Earned</p>
      </div>
    </div>

    <!-- ── Top Shops with discount preview ── -->
    <div class="mb-5">
      <h3 class="font-black text-sm mb-1" style="color:var(--text-color)">🏪 Your Top Shops</h3>
      <p class="text-xs mb-3" style="color:var(--muted)">Rewards are valid in these shops based on your last 30 days of orders</p>

      @if (dashboard()!.topShops && dashboard()!.topShops.length > 0) {
        <div class="space-y-2">
          @for (shop of dashboard()!.topShops; track shop.shopId) {
            <div class="rounded-xl p-4" style="background-color:var(--subtle);border:1px solid var(--border)">
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <p class="font-bold text-sm truncate" style="color:var(--text-color)">{{ shop.shopName }}</p>
                  <p class="text-xs" style="color:var(--muted)">{{ shop.orderCount }} orders • {{ shop.totalSpent | number:'1.2-2' }} TND spent</p>
                </div>
                <!-- Discount badge -->
                @if (shop.discountPercentage && shop.discountPercentage > 0) {
                  <span class="flex-shrink-0 text-xs font-black px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
                    {{ shop.discountPercentage }}% OFF available
                  </span>
                } @else {
                  <span class="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                    ✅ Rewards Valid
                  </span>
                }
              </div>

              <!-- Example calculation + Shop Now button -->
              @if (shop.discountPercentage && shop.discountPercentage > 0 && shop.exampleOrderOriginal) {
                <div class="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                  <p class="text-[10px] font-bold uppercase tracking-widest mb-2" style="color:var(--muted)">
                    💡 Example on a {{ shop.exampleOrderOriginal | number:'1.0-0' }} TND order
                  </p>
                  <div class="flex items-center gap-2 flex-wrap mb-2">
                    <span class="text-sm font-bold line-through" style="color:var(--muted)">
                      {{ shop.exampleOrderOriginal | number:'1.0-0' }} TND
                    </span>
                    <svg class="w-3.5 h-3.5 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7-7 7"/>
                    </svg>
                    <span class="text-base font-black text-primary">
                      {{ shop.exampleOrderAfterDiscount | number:'1.0-0' }} TND
                    </span>
                    <span class="text-[10px] font-black px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                      Save {{ shop.maxDiscountTnd | number:'1.0-0' }} TND
                    </span>
                  </div>
                  <p class="text-[10px] mb-3" style="color:var(--muted)">
                    {{ shop.pointsFromShop }} of your {{ dashboard()!.totalPoints }} pts earned at this shop
                  </p>
                  <!-- Shop Now button -->
                  <button
                    (click)="goToShop(shop.shopId, shop.maxDiscountTnd)"
                    class="w-full py-2 rounded-lg text-xs font-black text-white transition-all
                           bg-gradient-to-r from-primary to-primary-dark
                           hover:-translate-y-0.5 hover:shadow-lg active:scale-95">
                    🛍️ Shop at {{ shop.shopName }} — Save {{ shop.maxDiscountTnd | number:'1.0-0' }} TND
                  </button>
                </div>
              }
            </div>
          }
        </div>
      } @else {
        <div class="p-4 rounded-xl text-center" style="background-color:var(--subtle)">
          <p class="text-sm" style="color:var(--muted)">🛍️ Make purchases to unlock shops where you can use your rewards!</p>
        </div>
      }
    </div>

    <!-- ── Convert Points Section ── -->
    <div class="mb-5">
      <h3 class="font-black text-sm mb-1" style="color:var(--text-color)">🎁 Convert Your Points</h3>
      <p class="text-xs mb-3" style="color:var(--muted)">Turn your points into discount coupons usable at your top shops</p>

      @if (dashboard()!.availableRewards && dashboard()!.availableRewards.length > 0) {
        <div class="grid grid-cols-1 gap-3">
          @for (reward of dashboard()!.availableRewards; track reward.id) {
            <div class="rounded-xl p-4 transition-all"
              [style]="canAfford(reward) ? 'background-color:var(--subtle);border:2px solid var(--primary-color,#800000)' : 'background-color:var(--subtle);border:1px solid var(--border);opacity:0.65'">

              <div class="flex items-start justify-between gap-3 mb-3">
                <div class="flex-1">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-base font-black" style="color:var(--text-color)">{{ reward.name }}</span>
                    <span class="text-xs font-black px-2 py-0.5 rounded-full bg-primary text-white">
                      {{ getRewardTypeDisplay(reward) }}
                    </span>
                  </div>
                  <p class="text-xs" style="color:var(--muted)">{{ reward.description }}</p>
                </div>
              </div>

              <!-- Details row -->
              <div class="flex flex-wrap gap-2 mb-3">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-primary/10 text-primary">
                  💎 {{ reward.pointsRequired }} pts required
                </span>
                @if (reward.maxDiscountAmount) {
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded" style="background-color:var(--border);color:var(--muted)">
                    🎯 Max {{ reward.maxDiscountAmount }} TND off
                  </span>
                }
                @if (reward.minOrderAmount) {
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded" style="background-color:var(--border);color:var(--muted)">
                    📦 Min order {{ reward.minOrderAmount }} TND
                  </span>
                }
                <span class="text-[10px] font-bold px-2 py-0.5 rounded" style="background-color:var(--border);color:var(--muted)">
                  ⏰ Valid {{ reward.validityDays }} days
                </span>
              </div>

              <!-- CTA -->
              @if (canAfford(reward)) {
                <button
                  (click)="openConvertModal(reward)"
                  [disabled]="converting()"
                  class="w-full py-2.5 rounded-xl text-sm font-black text-white bg-primary hover:bg-primary-dark disabled:opacity-50 transition-all">
                  @if (converting() && selectedReward()?.id === reward.id) {
                    Converting...
                  } @else {
                    ✅ Convert {{ reward.pointsRequired }} pts → {{ getRewardTypeDisplay(reward) }} Coupon
                  }
                </button>
              } @else {
                <div class="w-full py-2.5 rounded-xl text-sm font-semibold text-center" style="background-color:var(--border);color:var(--muted)">
                  🔒 Need {{ reward.pointsRequired - dashboard()!.totalPoints }} more points
                  <span class="block text-[10px] mt-0.5 opacity-70">Keep shopping to unlock this reward</span>
                </div>
              }
            </div>
          }
        </div>
      } @else {
        <!-- No rewards configured -->
        <div class="p-5 rounded-xl text-center" style="background-color:var(--subtle);border:1px solid var(--border)">
          <p class="text-2xl mb-2">🎁</p>
          <p class="font-bold text-sm" style="color:var(--text-color)">No rewards available yet</p>
          <p class="text-xs mt-1" style="color:var(--muted)">Keep earning points — rewards will appear here once configured!</p>
        </div>
      }
    </div>

    <!-- ── Active Coupons ── -->
    @if (dashboard()!.activeRewards && dashboard()!.activeRewards.length > 0) {
      <div class="mb-5">
        <h3 class="font-black text-sm mb-1" style="color:var(--text-color)">🎫 Your Active Coupons</h3>
        <p class="text-xs mb-3" style="color:var(--muted)">Use these codes at checkout in your top shops</p>
        <div class="space-y-3">
          @for (reward of dashboard()!.activeRewards; track reward.id) {
            <div class="rounded-xl p-4" style="background-color:var(--subtle);border:1px solid var(--border)">
              <div class="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p class="font-bold text-sm" style="color:var(--text-color)">{{ reward.rewardName }}</p>
                  <p class="text-xs" [style]="reward.daysUntilExpiry <= 3 ? 'color:#ef4444' : reward.daysUntilExpiry <= 7 ? 'color:#f97316' : 'color:var(--muted)'">
                    ⏰ Expires in {{ reward.daysUntilExpiry }} days
                  </p>
                </div>
                <span class="text-xs font-black px-2 py-1 rounded-full bg-primary text-white flex-shrink-0">
                  {{ reward.rewardValue }}{{ reward.rewardType === 'PERCENTAGE_DISCOUNT' ? '%' : ' TND' }} OFF
                </span>
              </div>

              <!-- Coupon code -->
              <div class="flex items-center gap-2 mt-2">
                <code class="flex-1 text-sm font-mono font-black px-3 py-2 rounded-lg text-center tracking-widest"
                  style="background-color:var(--card-bg);border:1px dashed var(--border);color:var(--text-color)">
                  {{ reward.couponCode }}
                </code>
                <button (click)="copyCouponCode(reward.couponCode)"
                  class="px-3 py-2 rounded-lg text-xs font-bold transition-all hover:bg-primary hover:text-white"
                  style="background-color:var(--border);color:var(--text-color)">
                  📋 Copy
                </button>
              </div>

              @if (reward.allowedShops && reward.allowedShops.length > 0) {
                <p class="text-[10px] mt-2" style="color:var(--muted)">
                  Valid in: <strong>{{ reward.allowedShops.map(s => s.shopName).join(', ') }}</strong>
                </p>
              }
            </div>
          }
        </div>
      </div>
    }

    <!-- ── Tier cards ── -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
      @for (tier of loyaltyTiers; track tier.level) {
        <div class="rounded-xl p-3 text-center transition-all"
          [class.ring-2]="dashboard()!.loyaltyLevel === tier.level"
          [class.ring-primary]="dashboard()!.loyaltyLevel === tier.level"
          style="background-color:var(--subtle);border:1px solid var(--border)">
          <p class="text-xl mb-1">{{ getLevelIcon(tier.level) }}</p>
          <p class="font-black text-xs" style="color:var(--text-color)">{{ tier.level }}</p>
          <p class="text-[10px]" style="color:var(--muted)">{{ tier.minPoints }}+ pts</p>
          <p class="text-xs font-black text-primary">{{ tier.multiplier }}x</p>
        </div>
      }
    </div>

  } @else if (!isLoading()) {
    <div class="text-center py-12" style="color:var(--muted)">
      <p class="text-4xl mb-3">🏆</p>
      <p class="font-semibold">No loyalty account found</p>
      <p class="text-sm mt-1">Start shopping to earn loyalty points!</p>
    </div>
  }
</div>

<!-- ── Convert Modal ── -->
@if (showModal() && selectedReward()) {
  <div class="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    (click)="closeModal()">
    <div class="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
      (click)="$event.stopPropagation()">

      <!-- Header -->
      <div class="bg-gradient-to-r from-primary to-primary-dark px-6 pt-6 pb-8 text-white relative overflow-hidden">
        <div class="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full"></div>
        <button (click)="closeModal()" class="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-xs">✕</button>
        <p class="text-xs opacity-70 uppercase tracking-widest mb-1">Convert Points</p>
        <h2 class="text-xl font-black">{{ selectedReward()!.name }}</h2>
        <p class="text-sm opacity-80 mt-1">{{ getRewardTypeDisplay(selectedReward()!) }} coupon for your top shops</p>
      </div>

      <!-- Body -->
      <div class="px-6 -mt-4 pb-6">
        <div class="bg-white rounded-xl shadow-lg p-4 mb-4 space-y-2">
          <div class="flex justify-between text-sm">
            <span class="text-gray-500">Points required</span>
            <span class="font-black text-primary">{{ selectedReward()!.pointsRequired }} pts</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-gray-500">Your current points</span>
            <span class="font-bold">{{ dashboard()!.totalPoints }} pts</span>
          </div>
          <div class="border-t pt-2 flex justify-between text-sm">
            <span class="text-gray-500">Points after conversion</span>
            <span class="font-black text-green-600">{{ dashboard()!.totalPoints - selectedReward()!.pointsRequired }} pts</span>
          </div>
        </div>

        <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-xs text-amber-800">
          ℹ️ This coupon will only work in your top 3 most-shopped stores.
          @if (selectedReward()!.minOrderAmount) {
            Minimum order: <strong>{{ selectedReward()!.minOrderAmount }} TND</strong>.
          }
          Valid for <strong>{{ selectedReward()!.validityDays }} days</strong>.
        </div>

        <div class="flex gap-3">
          <button (click)="closeModal()" class="flex-1 py-3 rounded-xl text-sm font-bold border-2 border-gray-200 text-gray-500 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button (click)="confirmConvert()" [disabled]="converting()"
            class="flex-1 py-3 rounded-xl text-sm font-black text-white bg-primary hover:bg-primary-dark disabled:opacity-50 transition-all">
            @if (converting()) { Converting... } @else { ✅ Confirm }
          </button>
        </div>
      </div>
    </div>
  </div>
}

<!-- ── Success toast ── -->
@if (successMsg()) {
  <div class="fixed bottom-6 right-6 z-[9999] bg-green-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-bold animate-[slideUp_.3s_ease]">
    {{ successMsg() }}
  </div>
}
  `,
  styles: [`:host { display: block; }`]
})
export class ProfileLoyaltyComponent implements OnInit {
  private loyaltyService = inject(LoyaltyService);
  private router = inject(Router);

  dashboard = signal<LoyaltyDashboard | null>(null);
  isLoading = signal(false);
  converting = signal(false);
  showModal = signal(false);
  selectedReward = signal<any>(null);
  successMsg = signal<string>('');
  private successTimer: any = null;

  loyaltyTiers = LOYALTY_LEVELS;

  loyaltyProgress = computed(() => {
    const dash = this.dashboard();
    if (!dash) return 0;
    const current = LOYALTY_LEVELS.find(l => l.level === dash.loyaltyLevel);
    const next = LOYALTY_LEVELS.find(l => l.minPoints > (current?.minPoints || 0));
    if (!current || !next) return 100;
    return Math.min(100, Math.max(0,
      ((dash.totalPoints - current.minPoints) / (next.minPoints - current.minPoints)) * 100));
  });

  ngOnInit(): void { this.loadLoyaltyData(); }

  private loadLoyaltyData(): void {
    this.isLoading.set(true);
    this.loyaltyService.getDashboard().subscribe({
      next: (d) => { this.dashboard.set(d); this.isLoading.set(false); },
      error: () => this.isLoading.set(false)
    });
  }

  canAfford(reward: any): boolean {
    return !!this.dashboard() && this.dashboard()!.totalPoints >= reward.pointsRequired;
  }

  goToShop(shopId: string, discountTnd?: number): void {
    // Navigate to the shop's product listing, passing the discount as a query param
    // so the shop page can display a banner "You have X TND discount available here!"
    this.router.navigate(['/products'], {
      queryParams: {
        shopId,
        loyaltyDiscount: discountTnd ? discountTnd.toFixed(2) : undefined
      }
    });
  }

  goToCartWithDiscount(discountTnd: number): void {
    this.router.navigate(['/cart'], {
      queryParams: { loyaltyDiscount: discountTnd.toFixed(2) }
    });
  }

  openConvertModal(reward: any): void {
    this.selectedReward.set(reward);
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.selectedReward.set(null);
  }

  confirmConvert(): void {
    const reward = this.selectedReward();
    if (!reward || this.converting()) return;
    this.converting.set(true);

    this.loyaltyService.convertPointsToReward(reward.id).subscribe({
      next: (userReward: any) => {
        this.converting.set(false);
        this.closeModal();
        this.loadLoyaltyData();
        this.showSuccess(`✅ Coupon created! Code: ${userReward.couponCode} — valid ${userReward.daysUntilExpiry} days`);
      },
      error: (err: any) => {
        this.converting.set(false);
        this.showSuccess('❌ ' + (err.error?.message || 'Conversion failed. Please try again.'));
      }
    });
  }

  private showSuccess(msg: string): void {
    this.successMsg.set(msg);
    if (this.successTimer) clearTimeout(this.successTimer);
    this.successTimer = setTimeout(() => this.successMsg.set(''), 5000);
  }

  copyCouponCode(code: string): void {
    navigator.clipboard.writeText(code).then(() => {
      this.showSuccess('📋 Coupon code copied to clipboard!');
    });
  }

  getLevelIcon(level: string): string {
    return ({ BRONZE: '🥉', SILVER: '🥈', GOLD: '🥇', PLATINUM: '💎' } as any)[level] || '⭐';
  }

  getRewardTypeDisplay(reward: any): string {
    return reward.rewardType === 'PERCENTAGE_DISCOUNT'
      ? `${reward.rewardValue}% OFF`
      : `${reward.rewardValue} TND OFF`;
  }
}
