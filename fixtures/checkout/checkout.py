def calculate_total(
    subtotal_cents: int,
    coupon_percent: int = 0,
    loyalty_cents: int = 0,
    tax_rate: float = 0.0,
) -> int:
    if subtotal_cents < 0:
        raise ValueError("subtotal_cents must be non-negative")
    if not 0 <= coupon_percent <= 100:
        raise ValueError("coupon_percent must be between 0 and 100")
    if loyalty_cents < 0:
        raise ValueError("loyalty_cents must be non-negative")
    if tax_rate < 0:
        raise ValueError("tax_rate must be non-negative")

    after_coupon = round(subtotal_cents * (100 - coupon_percent) / 100)
    tax = round(after_coupon * tax_rate)
    return max(0, after_coupon + tax - loyalty_cents)
