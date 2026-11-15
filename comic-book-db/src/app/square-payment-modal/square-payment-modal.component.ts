import { Component, Input, Output, EventEmitter, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { environment } from '../../environments/environment';

declare const Square: any;

const SQUARE_APP_ID = '<YOUR_SQUARE_APP_ID>';
const SQUARE_LOCATION_ID = '<YOUR_SQUARE_LOCATION_ID>';

@Component({
  selector: 'app-square-payment-modal',
  templateUrl: './square-payment-modal.component.html',
  styleUrls: ['./square-payment-modal.component.css'],
  standalone: false
})
export class SquarePaymentModalComponent implements AfterViewInit, OnDestroy {
  @Input() amountDollars = 0;
  @Output() paid = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  paying = false;
  sdkError = '';
  payError = '';
  private card: any;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  async ngAfterViewInit() {
    try {
      const payments = Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
      this.card = await payments.card();
      await this.card.attach('#sq-card-container');
    } catch {
      this.sdkError = 'Failed to load payment form. Please refresh and try again.';
      this.cdr.markForCheck();
    }
  }

  async ngOnDestroy() {
    try { await this.card?.destroy(); } catch { /* ignore */ }
  }

  async pay() {
    if (this.paying || !this.card) return;
    this.paying = true;
    this.payError = '';

    let token: string;
    try {
      const result = await this.card.tokenize();
      if (result.status !== 'OK') {
        this.payError = result.errors?.[0]?.message ?? 'Could not read card details.';
        this.paying = false;
        this.cdr.markForCheck();
        return;
      }
      token = result.token;
    } catch {
      this.payError = 'Unexpected error reading card. Please try again.';
      this.paying = false;
      this.cdr.markForCheck();
      return;
    }

    // The server always recomputes the charge amount from the user's own active cart rather
    // than trusting a client-supplied amount, so only the payment nonce needs to be sent here.
    this.http.post<{ success: boolean; error?: string }>(`${environment.apiBase}/payment`, {
      nonce: token
    }).subscribe({
      next: resp => {
        if (resp.success) {
          this.paid.emit();
        } else {
          this.payError = resp.error ?? 'Payment was declined.';
          this.paying = false;
        }
      },
      error: () => {
        this.payError = 'Payment request failed. Please try again.';
        this.paying = false;
      }
    });
  }

  close() {
    this.closed.emit();
  }
}
