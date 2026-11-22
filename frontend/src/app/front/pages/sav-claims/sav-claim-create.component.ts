import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { SavClaimService, SavClaim } from '../../core/sav-claim.service';
import { OrderService } from '../../core/order.service';
import { UserService } from '../../core/user.service';
import { User, UserRole } from '../../models/user.model';
import { OrderResponse, OrderItemResponse } from '../../models/order.model';

/** Flat item shown in the order-item picker */
export interface OrderItemDisplay {
  /** The order item ID — sent as cartItemId in the claim */
  id: string;
  productName: string;
  quantity: number;
  subtotal: number;
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
}

const PAGE_SIZE = 4;

@Component({
  selector: 'app-sav-claim-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './sav-claim-create.component.html',
  styleUrls: ['./sav-claim-create.component.css']
})
export class SavClaimCreateComponent implements OnInit {
  private fb          = inject(FormBuilder);
  private savService  = inject(SavClaimService);
  private orderService = inject(OrderService);
  private userService = inject(UserService);
  private router      = inject(Router);
  private route       = inject(ActivatedRoute);

  form = this.fb.group({
    targetType:      ['PRODUCT', Validators.required],
    cartItemId:      ['', Validators.required],
    deliveryAgentId: [''],
    reason:          ['', Validators.required],
    problemNature:   ['', Validators.required],
    desiredSolution: ['', Validators.required],
    priority:        ['MEDIUM'],
    message:         ['', Validators.required],
    rating:          [0]
  });

  // ── Order items ────────────────────────────────────────────────────────────
  /** All flattened order items from the user's orders */
  allOrderItems   = signal<OrderItemDisplay[]>([]);
  isLoadingItems  = signal(false);
  itemsError      = signal('');

  /** Current page index (0-based) */
  itemPage        = signal(0);

  /** Items visible on the current page */
  readonly visibleItems = computed(() => {
    const start = this.itemPage() * PAGE_SIZE;
    return this.allOrderItems().slice(start, start + PAGE_SIZE);
  });

  readonly totalPages = computed(() =>
    Math.ceil(this.allOrderItems().length / PAGE_SIZE)
  );

  readonly canPrev = computed(() => this.itemPage() > 0);
  readonly canNext = computed(() => this.itemPage() < this.totalPages() - 1);

  // ── Other state ────────────────────────────────────────────────────────────
  deliveryAgents      = signal<User[]>([]);
  selectedImages      = signal<any[]>([]);
  isSubmitting        = signal(false);
  isDeliveryAgentMode = signal(false);

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit(): void {
    const deliveryMode = this.route.snapshot.queryParamMap.get('target') === 'delivery';
    this.isDeliveryAgentMode.set(deliveryMode);

    if (deliveryMode) {
      this.form.patchValue({ targetType: 'DELIVERY_AGENT', desiredSolution: 'investigate_agent' });
    } else {
      this.loadOrderItems();
    }

    this.loadDeliveryAgents();
    this.syncTargetValidators();

    const cartItemId = this.route.snapshot.queryParamMap.get('cartItemId');
    if (cartItemId) this.form.patchValue({ cartItemId });
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  loadOrderItems(): void {
    this.isLoadingItems.set(true);
    this.itemsError.set('');

    this.orderService.getMyOrders().subscribe({
      next: (orders: OrderResponse[]) => {
        // Flatten all order items into a single selectable list
        const items: OrderItemDisplay[] = [];
        for (const order of orders) {
          if (!order.items?.length) continue;
          for (const item of order.items) {
            if (item.status === 'CANCELLED') continue;   // skip cancelled items
            items.push({
              id:          item.id,
              productName: item.productName,
              quantity:    item.quantity,
              subtotal:    item.subtotal,
              orderNumber: order.orderNumber,
              orderDate:   order.createdAt,
              orderStatus: order.status,
            });
          }
        }
        this.allOrderItems.set(items);
        this.itemPage.set(0);
        this.isLoadingItems.set(false);

        if (items.length === 0) {
          this.itemsError.set('No order items found. Place an order first.');
        }
      },
      error: (err: any) => {
        console.error('Error loading orders:', err);
        this.itemsError.set('Could not load your orders. Please try again.');
        this.isLoadingItems.set(false);
      }
    });
  }

  loadDeliveryAgents(): void {
    this.userService.getAllUsers({ role: UserRole.DELIVERY, limit: 500 }).subscribe({
      next: (res: any) => {
        const users = res.content || res.users || (Array.isArray(res) ? res : []);
        this.deliveryAgents.set(users.filter((u: any) =>
          Array.isArray(u.roles) ? u.roles.includes(UserRole.DELIVERY) : u.role === UserRole.DELIVERY
        ));
      },
      error: () => this.deliveryAgents.set([])
    });
  }

  // ── Pagination ─────────────────────────────────────────────────────────────

  prevPage(): void { if (this.canPrev()) this.itemPage.update(p => p - 1); }
  nextPage(): void { if (this.canNext()) this.itemPage.update(p => p + 1); }

  selectItem(item: OrderItemDisplay): void {
    this.form.patchValue({ cartItemId: item.id });
  }

  isSelected(item: OrderItemDisplay): boolean {
    return this.form.value.cartItemId === item.id;
  }

  selectedItemLabel(): string {
    const id = this.form.value.cartItemId;
    if (!id) return '';
    const found = this.allOrderItems().find(i => i.id === id);
    return found ? `${found.productName} (${found.orderNumber})` : id;
  }

  // ── Form helpers ───────────────────────────────────────────────────────────

  private syncTargetValidators(): void {
    const apply = () => {
      const cartCtrl  = this.form.get('cartItemId');
      const agentCtrl = this.form.get('deliveryAgentId');
      if (this.form.value.targetType === 'DELIVERY_AGENT') {
        agentCtrl?.setValidators([Validators.required]);
        cartCtrl?.clearValidators();
        cartCtrl?.setValue('');
      } else {
        cartCtrl?.setValidators([Validators.required]);
        agentCtrl?.clearValidators();
        agentCtrl?.setValue('');
      }
      cartCtrl?.updateValueAndValidity();
      agentCtrl?.updateValueAndValidity();
    };
    apply();
    this.form.get('targetType')?.valueChanges.subscribe(apply);
  }

  onFilesSelected(event: any): void {
    const files = event.target.files;
    if (!files) return;
    const newImages = Array.from(files).map((file: any) => ({
      file,
      name:    file.name,
      preview: URL.createObjectURL(file)
    }));
    this.selectedImages.set([...this.selectedImages(), ...newImages]);
  }

  removeImage(name: string): void {
    this.selectedImages.set(this.selectedImages().filter(img => img.name !== name));
  }

  setRating(rating: number): void {
    this.form.patchValue({ rating });
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.isSubmitting.set(true);
    const files: File[] = this.selectedImages().map(img => img.file);

    this.savService.uploadImages(files).subscribe({
      next: (imageUrls) => {
        const claim: SavClaim = { type: 'SAV', ...(this.form.value as any), imageUrls };
        this.savService.createSavClaim(claim).subscribe({
          next: () => {
            alert(this.form.value.targetType === 'DELIVERY_AGENT'
              ? 'Your delivery agent claim has been submitted successfully'
              : 'Your return request has been submitted successfully');
            this.router.navigate(
              this.form.value.targetType === 'DELIVERY_AGENT' ? ['/sav'] : ['/sav/claims']
            );
          },
          error: (err) => {
            console.error('Error creating claim:', err);
            alert('Failed to submit return request');
            this.isSubmitting.set(false);
          }
        });
      },
      error: (err) => {
        console.error('Error uploading images:', err);
        alert('Failed to upload images. Please try again.');
        this.isSubmitting.set(false);
      }
    });
  }

  cancel(): void {
    this.router.navigate(this.form.value.targetType === 'DELIVERY_AGENT' ? ['/sav'] : ['/sav/claims']);
  }
}
