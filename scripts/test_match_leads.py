#!/usr/bin/env python3
"""
Unit tests for Bangalore Real Estate Lead Matcher & Deduplicator
(scripts/match_leads.py) based on matching_rules.md specification.
"""

import unittest
from datetime import datetime, timezone, timedelta
from match_leads import (
    PropertyListing,
    LeadDeduplicator,
    LeadMatcher,
    normalize_text_layer1,
    clean_phone_number,
    process_raw_records_pipeline,
    format_inr,
    format_price_display,
    format_contact_display,
    format_location_display,
    format_code_display,
)

class TestLeadMatcher(unittest.TestCase):
    def setUp(self):
        self.dedup = LeadDeduplicator()
        self.matcher = LeadMatcher()

    def test_layer1_exact_repost_deduplication(self):
        """Layer 1: Exact repost before LLM saves cost."""
        sender = "+91 98450 12345"
        text1 = "Looking for 3 BHK in Cooke Town! Budget: 1.5 Cr."
        text2 = "looking for 3 bhk in cooke town! budget: 1.5 cr."

        listing1 = PropertyListing(
            message_id="m1",
            sent_at="2026-11-04T10:00:00Z",
            group="Group A",
            sender_number=sender,
            raw_message_text=text1,
            code="WBA",
        )
        self.dedup.record_layer1_listing(sender, text1, listing1)

        # Checking repost with text2 from same sender in a different group
        repost = self.dedup.is_layer1_exact_repost(sender, text2, "Group B")
        self.assertIsNotNone(repost)
        self.assertEqual(len(repost), 1)
        self.assertIn("Group B", repost[0].posted_in)

    def test_layer2_broker_union_find(self):
        """Layer 2: Broker identity graph unions sender and contact numbers."""
        l1 = PropertyListing(
            message_id="m1",
            sent_at="2026-11-04T10:00:00Z",
            group="G1",
            sender_number="9591292090",
            contact_numbers=["9845007923"],
            code="WRA",
        )
        l2 = PropertyListing(
            message_id="m2",
            sent_at="2026-11-04T10:05:00Z",
            group="G2",
            sender_number="9845007923",
            contact_numbers=["9900011111"],
            code="ARA",
        )
        self.dedup.build_broker_graph([l1, l2])
        self.assertEqual(l1.broker_id, l2.broker_id)

    def test_layer3_same_listing_different_wording_merge(self):
        """Layer 3: Same broker, same code, overlapping locality, BHK/Size/Price within 10%."""
        l1 = PropertyListing(
            message_id="m1",
            sent_at="2026-11-04T10:00:00Z",
            group="Group 1",
            sender_number="917042846062",
            code="WBL",
            localities=["Sadarahalli", "Chikkajala"],
            land_sqft_min=65340,
            land_sqft_max=87120,
        )
        l2 = PropertyListing(
            message_id="m2",
            sent_at="2026-11-04T11:00:00Z",
            group="Group 2",
            sender_number="917042846062",
            code="WBL",
            localities=["Sadarahalli"],
            land_sqft_min=65340,
            land_sqft_max=87120,
            price_max=150000000,
        )
        merged = self.dedup.deduplicate_listings([l1, l2])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].price_max, 150000000)
        self.assertIn("Group 1", merged[0].posted_in)
        self.assertIn("Group 2", merged[0].posted_in)

    def test_expiry_rules(self):
        """Expiry: Rent 30d, Sale 60d, Land 90d, or passed deadline."""
        ref = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
        # Rent listing 35 days old -> expired
        rent_old = PropertyListing(
            message_id="r1",
            sent_at=(ref - timedelta(days=35)).isoformat(),
            group="G",
            sender_number="123",
            code="ARA",
        )
        self.assertTrue(self.dedup.is_expired(rent_old, ref))

        # Rent listing 20 days old -> active
        rent_fresh = PropertyListing(
            message_id="r2",
            sent_at=(ref - timedelta(days=20)).isoformat(),
            group="G",
            sender_number="123",
            code="ARA",
        )
        self.assertFalse(self.dedup.is_expired(rent_fresh, ref))

        # Land listing 80 days old -> active (under 90 days)
        land_80d = PropertyListing(
            message_id="l1",
            sent_at=(ref - timedelta(days=80)).isoformat(),
            group="G",
            sender_number="123",
            code="ASL",
        )
        self.assertFalse(self.dedup.is_expired(land_80d, ref))

        # Land listing 95 days old -> expired
        land_95d = PropertyListing(
            message_id="l2",
            sent_at=(ref - timedelta(days=95)).isoformat(),
            group="G",
            sender_number="123",
            code="ASL",
        )
        self.assertTrue(self.dedup.is_expired(land_95d, ref))

    def test_section7_case1_koramangala_type_and_project_check(self):
        """Row 1 (Koramangala 4 BHK vs Autumn Leaves plot): blocked by type (A vs L) and project."""
        demand = PropertyListing(
            message_id="d1",
            sent_at="2026-11-04T10:00:00Z",
            group="G",
            sender_number="9845011111",
            code="WBA",
            property_type="A",
            bhk_min=4,
            bhk_max=4,
            project_name="Raheja Vivarea",
            project_strict=True,
            city="Bangalore",
            localities=["Koramangala"],
        )
        supply = PropertyListing(
            message_id="s1",
            sent_at="2026-11-04T10:05:00Z",
            group="G",
            sender_number="9845022222",
            code="ASL",
            property_type="L",
            project_name="Prestige Autumn Leaves",
            city="Bangalore",
            localities=["Koramangala"],
        )
        passes, reason = self.matcher.passes_section2_compatibility_gates(demand, supply)
        self.assertFalse(passes)
        self.assertIn("Property type mismatch", reason)

    def test_section7_case2_same_broker_and_price_tolerance(self):
        """Row 2 (Cooke Town 2 BHK vs Wheeler Road 3 BHK): blocked by same broker check.
        If from different broker, 60K vs 40K budget fails (> 10% over).
        """
        # Part A: Same broker
        demand = PropertyListing(
            message_id="d2",
            sent_at="2026-11-04T10:00:00Z",
            group="G",
            sender_number="9591292090",
            contact_numbers=["9845007923"],
            broker_id="broker_x",
            code="WRA",
            bhk_min=2,
            bhk_max=2,
            price_max=40000,
            localities=["Cooke Town"],
        )
        supply_same_broker = PropertyListing(
            message_id="s2",
            sent_at="2026-11-04T10:05:00Z",
            group="G",
            sender_number="9845007923",
            contact_numbers=["9591292090"],
            broker_id="broker_x",
            code="ARA",
            bhk_min=3,
            bhk_max=3,
            price_max=60000,
            localities=["Wheeler Road"],
        )
        passes, reason = self.matcher.passes_section2_compatibility_gates(demand, supply_same_broker)
        self.assertFalse(passes)
        self.assertIn("Same broker identity", reason)

        # Part B: Different broker, but 60K vs 40K budget fails price tolerance
        supply_diff_broker = PropertyListing(
            message_id="s3",
            sent_at="2026-11-04T10:05:00Z",
            group="G",
            sender_number="9111122222",
            broker_id="broker_y",
            code="ARA",
            bhk_min=3,
            bhk_max=3,
            price_max=60000,
            localities=["Wheeler Road"],
        )
        price_status, price_reason = self.matcher.evaluate_price(demand, supply_diff_broker)
        self.assertEqual(price_status, "Fail")
        self.assertIn("exceeds budget by 50.0%", price_reason)

    def test_section7_case4_jd_jv_development_matching(self):
        """JD / JV supply only pairs with demand whose purpose_or_use mentions development/apartments."""
        demand_generic = PropertyListing(
            message_id="d3",
            sent_at="2026-11-04T10:00:00Z",
            group="G",
            sender_number="9111100000",
            broker_id="b1",
            code="WBL",
            property_type="L",
            purpose_or_use="personal investment",
            localities=["Devanahalli"],
        )
        supply_jd = PropertyListing(
            message_id="s4",
            sent_at="2026-11-04T10:05:00Z",
            group="G",
            sender_number="9222200000",
            broker_id="b2",
            code="ASL",
            property_type="L",
            deal_type="JD",
            localities=["Devanahalli"],
        )
        passes, reason = self.matcher.passes_section2_compatibility_gates(demand_generic, supply_jd)
        self.assertFalse(passes)
        self.assertIn("does not mention development or apartments", reason)

        # When purpose mentions apartments development
        demand_dev = PropertyListing(
            message_id="d4",
            sent_at="2026-11-04T10:00:00Z",
            group="G",
            sender_number="9111100000",
            broker_id="b1",
            code="WBL",
            property_type="L",
            purpose_or_use="development for apartments",
            localities=["Devanahalli"],
        )
        passes_dev, _ = self.matcher.passes_section2_compatibility_gates(demand_dev, supply_jd)
        self.assertTrue(passes_dev)

if __name__ == "__main__":
    unittest.main()
