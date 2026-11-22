import {
  Component, OnInit, AfterViewInit, OnDestroy,
  signal, inject, ViewChild, ElementRef, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { WheelOfFortuneService, RewardDTO, SpinResultDTO } from '../../../core/services/wheel-of-fortune.service';

@Component({
  selector: 'app-wheel-of-fortune',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './wheel-of-fortune.html',
  styleUrl: './wheel-of-fortune.scss'
})
export class WheelOfFortune implements OnInit, AfterViewInit, OnDestroy {
  private svc = inject(WheelOfFortuneService);
  private zone = inject(NgZone);

  @ViewChild('wheelCanvas') wheelCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('confettiCanvas') confettiCanvas!: ElementRef<HTMLCanvasElement>;

  rewards = signal<RewardDTO[]>([]);
  canSpin = signal(true);
  isSpinning = signal(false);
  showModal = signal(false);
  spinResult = signal<SpinResultDTO | null>(null);
  tickerAngle = signal(0);
  winningIndex = signal(-1); // highlights the winning segment after spin

  // Toast popup state
  toast = signal<{ msg: string; type: 'success' | 'error' | 'info' | 'warn' } | null>(null);
  private toastTimer: any = null;

  private ctx!: CanvasRenderingContext2D;
  private rot = 0;   // current rotation degrees
  private targetRot = 0;
  private rafId = 0;
  private bulbFrame = 0;   // for blinking bulbs
  private bulbRafId = 0;
  private lastTickSegment = -1;

  // 11 vivid game-show colours (alternating light/dark per reference)
  private readonly COLORS = [
    '#E8192C', '#2ECC40', '#0074D9', '#FFDC00',
    '#FF69B4', '#01FF70', '#FF851B', '#B10DC9',
    '#7FDBFF', '#F012BE', '#3D9970'
  ];

  ngOnInit(): void {
    this.svc.getRewards().subscribe({
      next: r => { this.rewards.set(r); this.zone.runOutsideAngular(() => this.drawFrame()); },
      error: () => this.showToast('⚠️ Could not load rewards. Please refresh.', 'error')
    });
    this.svc.canSpin().subscribe({
      next: r => {
        this.canSpin.set(r.canSpin);
        if (!r.canSpin) {
          this.showToast('🕐 You already spun today! Come back tomorrow for your next chance.', 'info');
        }
      },
      error: () => { }
    });
  }

  ngAfterViewInit(): void {
    this.initCanvas();
    // Animate bulbs independently
    this.zone.runOutsideAngular(() => this.animateBulbs());
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
    cancelAnimationFrame(this.bulbRafId);
  }

  // ── Canvas setup ──────────────────────────────────────────────────────────
  private initCanvas(): void {
    const el = this.wheelCanvas.nativeElement;
    const size = Math.min(window.innerWidth * 0.92, 600);
    el.width = el.height = size;
    this.ctx = el.getContext('2d')!;
    this.zone.runOutsideAngular(() => this.drawFrame());
  }

  // ── Bulb blink loop (runs outside Angular) ────────────────────────────────
  private animateBulbs(): void {
    this.bulbFrame++;
    this.drawFrame();
    this.bulbRafId = requestAnimationFrame(() => this.animateBulbs());
  }

  // ── Master draw ───────────────────────────────────────────────────────────
  private drawFrame(): void {
    const el = this.wheelCanvas?.nativeElement;
    if (!el || !this.ctx) return;
    const rewards = this.rewards();
    if (!rewards.length) return;

    const W = el.width, H = el.height;
    const cx = W / 2, cy = H / 2;

    // Radii
    const outerR = cx - 6;   // chrome outer rim
    const ringW = outerR * 0.095;
    const wheelR = outerR - ringW;
    const hubR = outerR * 0.115;

    this.ctx.clearRect(0, 0, W, H);

    // ── 1. Outer shadow / glow ─────────────────────────────────────────────
    const shadowGrad = this.ctx.createRadialGradient(cx, cy, wheelR * 0.85, cx, cy, outerR + 12);
    shadowGrad.addColorStop(0, 'rgba(0,0,0,0)');
    shadowGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, outerR + 12, 0, Math.PI * 2);
    this.ctx.fillStyle = shadowGrad;
    this.ctx.fill();

    // ── 2. Spinning segments ───────────────────────────────────────────────
    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.rotate(this.rot * Math.PI / 180);
    this.ctx.translate(-cx, -cy);

    const n = rewards.length;
    const seg = (Math.PI * 2) / n;

    rewards.forEach((r, i) => {
      const a0 = i * seg - Math.PI / 2;
      const a1 = a0 + seg;
      const am = a0 + seg / 2;
      const col = this.COLORS[i % this.COLORS.length];

      // Segment
      this.ctx.beginPath();
      this.ctx.moveTo(cx, cy);
      this.ctx.arc(cx, cy, wheelR, a0, a1);
      this.ctx.closePath();

      // Radial gradient per segment for 3-D depth
      const gx = cx + Math.cos(am) * wheelR * 0.5;
      const gy = cy + Math.sin(am) * wheelR * 0.5;
      const sg = this.ctx.createRadialGradient(gx, gy, 0, cx, cy, wheelR);
      sg.addColorStop(0, this.lighten(col, 40));
      sg.addColorStop(0.55, col);
      sg.addColorStop(1, this.darken(col, 30));
      this.ctx.fillStyle = sg;
      this.ctx.fill();

      // Divider line
      this.ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      this.ctx.lineWidth = 2.5;
      this.ctx.stroke();

      // ── Text ──────────────────────────────────────────────────────────
      this.ctx.save();
      this.ctx.translate(cx, cy);
      this.ctx.rotate(am);

      // Icon
      const iconSize = Math.max(16, wheelR * 0.085);
      this.ctx.font = `${iconSize}px Arial`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(r.icon, wheelR * 0.55, 0);

      // Label — rotated 90° to read outward
      this.ctx.save();
      this.ctx.translate(wheelR * 0.78, 0);
      this.ctx.rotate(Math.PI / 2);
      const fs = Math.max(10, wheelR * 0.062);
      this.ctx.font = `900 ${fs}px Inter,sans-serif`;
      this.ctx.fillStyle = '#fff';
      this.ctx.shadowColor = 'rgba(0,0,0,0.7)';
      this.ctx.shadowBlur = 4;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(r.label, 0, 0);
      this.ctx.restore();

      this.ctx.restore();
    });

    // ── 3. Winning segment highlight ──────────────────────────────────────
    const wi = this.winningIndex();
    if (wi >= 0) {
      const wa0 = wi * seg - Math.PI / 2;
      const wa1 = wa0 + seg;
      this.ctx.beginPath();
      this.ctx.moveTo(cx, cy);
      this.ctx.arc(cx, cy, wheelR, wa0, wa1);
      this.ctx.closePath();
      this.ctx.fillStyle = 'rgba(255,255,255,0.22)';
      this.ctx.fill();
    }

    // ── 4. Inner bevel ring ────────────────────────────────────────────────
    const bevel = this.ctx.createRadialGradient(cx, cy, wheelR - 8, cx, cy, wheelR + 2);
    bevel.addColorStop(0, 'rgba(255,255,255,0.15)');
    bevel.addColorStop(1, 'rgba(0,0,0,0.25)');
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, wheelR, 0, Math.PI * 2);
    this.ctx.strokeStyle = bevel;
    this.ctx.lineWidth = 8;
    this.ctx.stroke();

    // ── 4. Hub ────────────────────────────────────────────────────────────
    this.drawHub(cx, cy, hubR);

    this.ctx.restore(); // end spin rotation

    // ── 5. Chrome outer rim (static) ──────────────────────────────────────
    this.drawRim(cx, cy, outerR, wheelR, ringW);

    // ── 6. Blinking bulbs (static) ────────────────────────────────────────
    this.drawBulbs(cx, cy, outerR, ringW);

    // ── 7. Pointer (static) ───────────────────────────────────────────────
    this.drawPointer(cx, cy, outerR);
  }

  // ── Hub ───────────────────────────────────────────────────────────────────
  private drawHub(cx: number, cy: number, r: number): void {
    // Outer gold ring
    const g1 = this.ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.05, cx, cy, r);
    g1.addColorStop(0, '#fff9c4');
    g1.addColorStop(0.35, '#FFD700');
    g1.addColorStop(0.7, '#FFA000');
    g1.addColorStop(1, '#7B4F00');
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.ctx.fillStyle = g1;
    this.ctx.fill();

    // Inner maroon dome
    const g2 = this.ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.05, cx, cy, r * 0.72);
    g2.addColorStop(0, '#ff6060');
    g2.addColorStop(0.5, '#8B0000');
    g2.addColorStop(1, '#3d0000');
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
    this.ctx.fillStyle = g2;
    this.ctx.fill();

    // Shine
    this.ctx.beginPath();
    this.ctx.arc(cx - r * 0.22, cy - r * 0.22, r * 0.28, 0, Math.PI * 2);
    this.ctx.fillStyle = 'rgba(255,255,255,0.18)';
    this.ctx.fill();

    // Gold border
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.ctx.strokeStyle = '#B8860B';
    this.ctx.lineWidth = 2.5;
    this.ctx.stroke();
  }

  // ── Chrome rim ────────────────────────────────────────────────────────────
  private drawRim(cx: number, cy: number, outerR: number, wheelR: number, ringW: number): void {
    // Main chrome gradient
    const g = this.ctx.createLinearGradient(cx - outerR, cy, cx + outerR, cy);
    g.addColorStop(0, '#555');
    g.addColorStop(0.15, '#ddd');
    g.addColorStop(0.35, '#fff');
    g.addColorStop(0.5, '#bbb');
    g.addColorStop(0.65, '#fff');
    g.addColorStop(0.85, '#ddd');
    g.addColorStop(1, '#555');

    this.ctx.beginPath();
    this.ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    this.ctx.arc(cx, cy, wheelR, 0, Math.PI * 2, true);
    this.ctx.fillStyle = g;
    this.ctx.fill();

    // Outer edge stroke
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    this.ctx.strokeStyle = '#888';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Inner edge stroke
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, wheelR + 1, 0, Math.PI * 2);
    this.ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
  }

  // ── Blinking bulbs ────────────────────────────────────────────────────────
  private drawBulbs(cx: number, cy: number, outerR: number, ringW: number): void {
    const count = 20;
    const bulbR = outerR - ringW * 0.5;
    const radius = ringW * 0.28;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const bx = cx + Math.cos(angle) * bulbR;
      const by = cy + Math.sin(angle) * bulbR;

      // Alternate blink: even/odd groups flash at different rates
      const phase = Math.floor(this.bulbFrame / 18) % 2;
      const isOn = (i % 2 === phase);
      const isGold = i % 5 === 0;

      const onColor = isGold ? '#FFD700' : '#FFFFFF';
      const offColor = isGold ? '#7B5800' : '#888888';
      const color = isOn ? onColor : offColor;

      // Glow when on
      if (isOn) {
        const glow = this.ctx.createRadialGradient(bx, by, 0, bx, by, radius * 2.8);
        glow.addColorStop(0, isGold ? 'rgba(255,215,0,0.55)' : 'rgba(255,255,255,0.45)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        this.ctx.beginPath();
        this.ctx.arc(bx, by, radius * 2.8, 0, Math.PI * 2);
        this.ctx.fillStyle = glow;
        this.ctx.fill();
      }

      // Bulb body
      const bg = this.ctx.createRadialGradient(bx - radius * 0.3, by - radius * 0.3, radius * 0.05, bx, by, radius);
      bg.addColorStop(0, isOn ? (isGold ? '#fffde7' : '#ffffff') : (isGold ? '#c8a000' : '#cccccc'));
      bg.addColorStop(1, color);
      this.ctx.beginPath();
      this.ctx.arc(bx, by, radius, 0, Math.PI * 2);
      this.ctx.fillStyle = bg;
      this.ctx.fill();
      this.ctx.strokeStyle = isGold ? '#B8860B' : '#666';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }
  }

  // ── Pointer / ticker ──────────────────────────────────────────────────────
  private drawPointer(cx: number, cy: number, outerR: number): void {
    const tipY = cy - outerR - 2;
    const h = outerR * 0.14;
    const w = outerR * 0.065;

    this.ctx.save();

    // Shadow
    this.ctx.shadowColor = 'rgba(0,0,0,0.5)';
    this.ctx.shadowBlur = 8;
    this.ctx.shadowOffsetY = 3;

    // Arrow body
    this.ctx.beginPath();
    this.ctx.moveTo(cx, tipY + h);          // tip pointing down into wheel
    this.ctx.lineTo(cx - w, tipY);
    this.ctx.lineTo(cx - w * 0.6, tipY - h * 0.5);
    this.ctx.lineTo(cx + w * 0.6, tipY - h * 0.5);
    this.ctx.lineTo(cx + w, tipY);
    this.ctx.closePath();

    const pg = this.ctx.createLinearGradient(cx - w, tipY - h * 0.5, cx + w, tipY + h);
    pg.addColorStop(0, '#ff4444');
    pg.addColorStop(0.5, '#cc0000');
    pg.addColorStop(1, '#880000');
    this.ctx.fillStyle = pg;
    this.ctx.fill();
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    // Tip highlight
    this.ctx.beginPath();
    this.ctx.moveTo(cx, tipY + h - 2);
    this.ctx.lineTo(cx - w * 0.3, tipY + 2);
    this.ctx.lineTo(cx, tipY + h * 0.4);
    this.ctx.closePath();
    this.ctx.fillStyle = 'rgba(255,255,255,0.35)';
    this.ctx.fill();

    this.ctx.restore();
  }

  // ── Spin ──────────────────────────────────────────────────────────────────
  spin(): void {
    if (!this.canSpin() || this.isSpinning()) {
      if (!this.canSpin()) {
        this.showToast('🕐 You already used your spin today! Come back tomorrow 🌙', 'warn');
      }
      return;
    }
    this.zone.run(() => this.isSpinning.set(true));

    this.svc.spin().subscribe({
      next: result => {
        this.zone.run(() => this.spinResult.set(result));

        // ── Calculate rotation so the winning segment lands under the pointer ──
        // The wheel draws segment i starting at: i * segAngle - 90° (top = 0°)
        // Segment i center in wheel-local degrees: i * segAngle - 90 + segAngle/2
        // The pointer is at the top (screen 0° = 12 o'clock).
        // We need: (currentRot + addedRot + segCenter) ≡ -90° (mod 360)
        // So: addedRot = -90 - segCenter - (currentRot % 360) + 360*k
        const rewards = this.rewards();
        const localIndex = rewards.findIndex(r => r.id === result.reward.id);
        const n = rewards.length;

        let rotationDegrees: number;
        if (localIndex >= 0 && n > 0) {
          const segAngle = 360 / n;
          // Center of winning segment in wheel-local space (degrees from 12 o'clock)
          const segCenterLocal = localIndex * segAngle - 90 + segAngle / 2;
          // Current wheel rotation normalised to [0, 360)
          const currentNorm = ((this.rot % 360) + 360) % 360;
          // How much more to rotate so segCenterLocal ends up at -90° (top pointer)
          // We want: (currentNorm + delta + segCenterLocal) ≡ -90 (mod 360)
          // => delta = -90 - segCenterLocal - currentNorm (mod 360)
          let delta = ((-90 - segCenterLocal - currentNorm) % 360 + 360) % 360;
          // Ensure at least 5 full rotations for drama
          const fullRotations = 5 + Math.floor(Math.random() * 3);
          rotationDegrees = fullRotations * 360 + delta;
        } else {
          rotationDegrees = result.rotationDegrees;
        }

        this.targetRot = this.rot + rotationDegrees;
        this.zone.runOutsideAngular(() => this.animateSpin());
      },
      error: err => {
        const msg = err.error?.message || 'Something went wrong. Please try again.';
        this.zone.run(() => {
          this.isSpinning.set(false);
          if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('tomorrow')) {
            this.canSpin.set(false);
            this.showToast('🕐 You already spun today! Come back tomorrow for another chance 🌙', 'warn');
          } else {
            this.showToast('❌ ' + msg, 'error');
          }
        });
      }
    });
  }

  private animateSpin(): void {
    const duration = 6000;
    const start = Date.now();
    const startRot = this.rot;
    const totalRot = this.targetRot - startRot;
    const n = this.rewards().length;
    const segDeg = 360 / n;

    const tick = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(elapsed / duration, 1);
      // Custom easing: fast start, dramatic slow-down at end
      const eased = t < 0.7
        ? t / 0.7 * 0.85                          // linear fast phase
        : 0.85 + (1 - Math.pow(1 - (t - 0.7) / 0.3, 5)) * 0.15; // quintic ease-out

      this.rot = startRot + totalRot * eased;
      this.drawFrame();

      // Ticker bounce: detect segment crossing
      const seg = Math.floor(((this.rot % 360) + 360) % 360 / segDeg);
      if (seg !== this.lastTickSegment) {
        this.lastTickSegment = seg;
        this.zone.run(() => this.tickerAngle.set(this.tickerAngle() + 1));
      }

      if (t < 1) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rot = this.targetRot;
        this.drawFrame();
        this.zone.run(() => {
          this.isSpinning.set(false);
          this.canSpin.set(false);
          // Highlight the winning segment
          const r = this.rewards();
          const res = this.spinResult();
          if (res) {
            const wi = r.findIndex(rw => rw.id === res.reward.id);
            this.winningIndex.set(wi);
          }
        });
        this.launchConfetti();
        setTimeout(() => this.zone.run(() => this.showModal.set(true)), 700);
      }
    };
    tick();
  }

  // ── Confetti ──────────────────────────────────────────────────────────────
  private launchConfetti(): void {
    const el = this.confettiCanvas?.nativeElement;
    if (!el) return;
    el.width = window.innerWidth;
    el.height = window.innerHeight;
    const ctx = el.getContext('2d')!;
    const cols = ['#E8192C', '#FFD700', '#2ECC40', '#0074D9', '#FF69B4', '#FF851B', '#B10DC9'];

    const particles = Array.from({ length: 220 }, () => ({
      x: Math.random() * el.width,
      y: -20 - Math.random() * 100,
      w: Math.random() * 10 + 5,
      h: Math.random() * 5 + 3,
      color: cols[Math.floor(Math.random() * cols.length)],
      vy: Math.random() * 5 + 3,
      vx: Math.random() * 6 - 3,
      rot: Math.random() * 360,
      vr: Math.random() * 14 - 7,
      opacity: 1
    }));

    const loop = () => {
      ctx.clearRect(0, 0, el.width, el.height);
      let alive = false;
      particles.forEach(p => {
        if (p.y > el.height + 20) return;
        alive = true;
        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
        p.y += p.vy; p.x += p.vx; p.rot += p.vr;
        if (p.y > el.height * 0.7) p.opacity -= 0.012;
      });
      if (alive) requestAnimationFrame(loop);
    };
    loop();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  closeModal(): void { 
    this.zone.run(() => { 
      this.showModal.set(false); 
      this.winningIndex.set(-1); // clear highlight
    }); 
  }

  showToast(msg: string, type: 'success' | 'error' | 'info' | 'warn'): void {
    this.zone.run(() => {
      this.toast.set({ msg, type });
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => this.zone.run(() => this.toast.set(null)), 4500);
    });
  }

  dismissToast(): void { this.zone.run(() => this.toast.set(null)); }

  rewardBorderColor(type: string): string {
    return ({
      DISCOUNT: '#E8192C', FREE_SHIPPING: '#FFD700', POINTS: '#2ECC40',
      COUPON: '#0074D9', NO_LUCK: '#888'
    } as any)[type] ?? '#800000';
  }

  private lighten(hex: string, pct: number): string {
    return this.adjustColor(hex, pct);
  }
  private darken(hex: string, pct: number): string {
    return this.adjustColor(hex, -pct);
  }
  private adjustColor(hex: string, pct: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (n >> 16) + pct));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + pct));
    const b = Math.min(255, Math.max(0, (n & 0xff) + pct));
    return `rgb(${r},${g},${b})`;
  }
}
