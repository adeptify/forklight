import unittest

from checkout import calculate_total


class CalculateTotalTests(unittest.TestCase):
    def test_coupon_is_applied_before_tax(self):
        self.assertEqual(
            calculate_total(1_000, coupon_percent=20, tax_rate=0.10),
            880,
        )

    def test_loyalty_credit_reduces_taxable_amount(self):
        self.assertEqual(
            calculate_total(1_000, loyalty_cents=200, tax_rate=0.10),
            880,
        )

    def test_discounts_cannot_create_negative_taxable_amount(self):
        self.assertEqual(
            calculate_total(500, coupon_percent=50, loyalty_cents=400, tax_rate=0.10),
            0,
        )

    def test_validation_contract_is_preserved(self):
        with self.assertRaises(ValueError):
            calculate_total(-1)
        with self.assertRaises(ValueError):
            calculate_total(100, coupon_percent=101)


if __name__ == "__main__":
    unittest.main()
