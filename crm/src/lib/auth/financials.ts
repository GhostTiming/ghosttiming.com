export const BOOKING_FINANCIAL_FIELDS = [
  "expectedRevenue",
  "actualRevenue",
  "amountPaid",
  "paymentDueAt",
  "paymentAt",
  "expected_revenue",
  "actual_revenue",
  "amount_paid",
  "payment_due_at",
  "payment_at",
  "payment_due_local",
  "payment_local",
] as const;

export type BookingFinancialField = (typeof BOOKING_FINANCIAL_FIELDS)[number];

export function redactBookingFinancials<T extends object>(
  record: T,
  canView: boolean,
): T {
  if (canView) return record;
  const next = { ...record };
  for (const field of BOOKING_FINANCIAL_FIELDS) {
    if (field in next) {
      (next as Record<string, unknown>)[field] = null;
    }
  }
  return next;
}
