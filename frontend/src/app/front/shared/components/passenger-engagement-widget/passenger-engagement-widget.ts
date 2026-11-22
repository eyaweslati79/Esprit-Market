import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CarpoolingService, PassengerEngagementDTO } from '../../../core/carpooling.service';

@Component({
  selector: 'app-passenger-engagement-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './passenger-engagement-widget.html',
  styleUrl: './passenger-engagement-widget.scss',
})
export class PassengerEngagementWidget implements OnInit {
  private readonly carpoolingService = inject(CarpoolingService);

  engagement = signal<PassengerEngagementDTO | null>(null);
  isLoading   = signal(true);
  hasNoProfile = signal(false);
  isExpanded  = signal(false);

  // ── Tier configuration ────────────────────────────────────────────────────
  readonly tierConfig: Record<string, { label: string; color: string; bg: string }> = {
    NONE:     { label: 'Explorer', color: '#9CA3AF', bg: 'rgba(156,163,175,0.08)' },
    BRONZE:   { label: 'Bronze',   color: '#CD7F32', bg: 'rgba(205,127,50,0.08)'  },
    SILVER:   { label: 'Silver',   color: '#6B7280', bg: 'rgba(107,114,128,0.08)' },
    GOLD:     { label: 'Gold',     color: '#800000', bg: 'rgba(128,0,0,0.08)'     },
    PLATINUM: { label: 'Platinum', color: '#8B0000', bg: 'rgba(139,0,0,0.08)'     },
  };

  readonly tierOrder = ['NONE', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];

  /** Points required to reach each tier */
  readonly tierThresholds: Record<string, number> = {
    BRONZE: 50, SILVER: 150, GOLD: 300, PLATINUM: 600,
  };

  // ── Earn actions (static, with SVG path data) ─────────────────────────────
  readonly earnActions = [
    {
      label: 'Book a ride',
      pts: 10,
      icon: 'M3 11l19-9-9 19-2-8-8-2z',
    },
    {
      label: 'Request a ride',
      pts: 5,
      icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    },
    {
      label: 'Leave feedback',
      pts: 15,
      icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    },
  ];

  // ── Computed ──────────────────────────────────────────────────────────────
  currentTierConfig = computed(() => {
    const tier = this.engagement()?.engagementTier ?? 'NONE';
    return this.tierConfig[tier] ?? this.tierConfig['NONE'];
  });

  /** Live stats built from real API data */
  liveStats = computed(() => {
    const e = this.engagement();
    if (!e) return [];
    return [
      { label: 'Bookings',  value: e.bookedRidesCount,  hint: 'Total rides booked' },
      { label: 'Requests',  value: e.rideRequestCount,  hint: 'Ride requests posted' },
      { label: 'Reviews',   value: e.feedbackCount,     hint: 'Feedback submitted' },
    ];
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.carpoolingService.getPassengerEngagement().subscribe({
      next: (data) => {
        this.engagement.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.hasNoProfile.set(true);
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  getTierIndex(tier: string): number {
    return this.tierOrder.indexOf(tier);
  }

  isTierUnlocked(tier: string): boolean {
    const current = this.engagement()?.engagementTier ?? 'NONE';
    return this.getTierIndex(tier) <= this.getTierIndex(current);
  }

  isTierCurrent(tier: string): boolean {
    return this.engagement()?.engagementTier === tier;
  }

  toggleExpanded(): void {
    this.isExpanded.set(!this.isExpanded());
  }
}
