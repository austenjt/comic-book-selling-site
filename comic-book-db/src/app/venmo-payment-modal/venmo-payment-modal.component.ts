import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { CartService } from '../cart.service';
import { Cart } from '../cart';

const VENMO_HANDLE = 'John-Doe';

@Component({
  selector: 'app-venmo-payment-modal',
  templateUrl: './venmo-payment-modal.component.html',
  styleUrls: ['./venmo-payment-modal.component.css'],
  standalone: false
})
export class VenmoPaymentModalComponent {
  @Input() amountDollars = 0;
  @Input() invoiceNumber = '';
  @Output() sent = new EventEmitter<Cart>();
  @Output() closed = new EventEmitter<void>();

  sending = false;
  error = '';
  readonly venmoHandle = VENMO_HANDLE;

  constructor(private cartService: CartService) {}

  get venmoDeepLink(): string {
    const note = encodeURIComponent(`Order #${this.invoiceNumber}`);
    const amount = this.amountDollars.toFixed(2);
    return `venmo://paycharge?txn=pay&recipients=${VENMO_HANDLE}&amount=${amount}&note=${note}`;
  }

  get venmoWebLink(): string {
    return `https://venmo.com/${VENMO_HANDLE}`;
  }

  onSent() {
    this.sending = true;
    this.error = '';
    this.cartService.notifyVenmoPayment().subscribe({
      next: cart => {
        this.sending = false;
        this.sent.emit(cart);
      },
      error: () => {
        this.sending = false;
        this.error = 'Could not record payment. Please try again.';
      }
    });
  }

  close() {
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.close();
  }
}
