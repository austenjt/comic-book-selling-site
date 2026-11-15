package org.example.functions.util;

import org.example.functions.model.ShippingEstimate;

/**
 * Estimates shipping costs using a linear formula: $8.00 base + $0.15 per book.
 * Sets count as their individual member books (set containers are excluded by the caller).
 * Free-shipping discounts (FREE_SHIPPING_OVER_X_BOOKS) are handled separately by DiscountService
 * and override this estimate via the cart's {@code freeShippingApplied} flag.
 */
public final class ShippingCalculator {

    private ShippingCalculator() {}

    private static final double BASE_RATE     = 8.00;
    private static final double PER_BOOK_RATE = 0.15;

    public static ShippingEstimate estimate(int bookCount) {
        if (bookCount <= 0) {
            return ShippingEstimate.builder()
                .bookCount(0).packagingTier("NONE")
                .estimatedCost(0).isFree(false)
                .notes("No items in cart.")
                .build();
        }

        double cost = Math.round((BASE_RATE + PER_BOOK_RATE * bookCount) * 100.0) / 100.0;
        String notes = String.format("$%.2f base + $%.2f × %d book%s.",
            BASE_RATE, PER_BOOK_RATE, bookCount, bookCount == 1 ? "" : "s");
        return ShippingEstimate.builder()
            .bookCount(bookCount)
            .packagingTier("FLAT_RATE")
            .estimatedCost(cost)
            .isFree(false)
            .notes(notes)
            .build();
    }
}
