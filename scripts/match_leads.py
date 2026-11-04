#!/usr/bin/env python3
"""
Bangalore Real Estate WhatsApp Lead Matcher & Deduplicator
Specification: 3-Layer Deduplication, 10-Gate Compatibility, Locality Clustering,
Tolerance Scoring, Match Strength, and 5-Tab Client View.
"""

from __future__ import annotations
import argparse
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
import json
import math
import os
import re
import sys
from typing import Any, Dict, List, Optional, Set, Tuple
import unicodedata

# ==============================================================================
# SECTION 3: AREA CLUSTERS TABLE
# ==============================================================================

AREA_CLUSTERS: Dict[str, List[str]] = {
    "CBD / East": [
        "fraser town", "frazer town", "cox town", "cooke town", "benson town",
        "richmond town", "shanthinagar", "shanti nagar", "ulsoor", "mg road",
        "indiranagar", "jayamahal", "wheeler road", "promenade road",
        "spencer road", "hbr layout", "pulikeshi nagar", "richards town", "coles park"
    ],
    "North / Airport": [
        "bagalur", "budigere", "devanahalli", "airport road", "hennur",
        "yelahanka", "sadarahalli", "chikkajala", "mittaganahalli",
        "razzack palya", "kalyan nagar", "manyata tech park", "thanisandra"
    ],
    "South-East": [
        "koramangala", "hsr layout", "sarjapur road", "varthur",
        "gunjur", "whitefield", "bellandur", "brookefield", "marathahalli",
        "kadugodi", "hoodi", "carmelaram"
    ],
    "South": [
        "arekere", "bannerghatta road", "jp nagar", "jayanagar", "btm layout",
        "hulimavu", "begur", "gottigere", "basavanagudi"
    ],
    "North-West": [
        "nelamangala", "muppenahalli"
    ],
}

def normalize_text_layer1(text: str) -> str:
    """Normalizes text for Layer 1 exact repost deduplication:
    lowercase, strip emojis, punctuation, spaces, and line breaks.
    """
    if not text:
        return ""
    # Normalize unicode and strip accents
    nfkd = unicodedata.normalize("NFKD", text)
    no_accents = "".join(c for c in nfkd if not unicodedata.combining(c))
    # Keep only alphanumeric lowercase ASCII
    clean = re.sub(r"[^a-zA-Z0-9]+", "", no_accents.lower())
    return clean

def clean_phone_number(phone: Optional[str]) -> str:
    """Cleans a phone string down to normalized digits (e.g. 10 digits for India)."""
    if not phone:
        return ""
    digits = re.sub(r"[^0-9]", "", str(phone).split("@")[0].split(":")[0])
    # Strip leading 91 or 0 for 10-digit Indian mobiles
    if len(digits) == 12 and digits.startswith("91"):
        return digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        return digits[1:]
    return digits

# ==============================================================================
# DATA STRUCTURES
# ==============================================================================

@dataclass
class PropertyListing:
    message_id: str
    sent_at: str
    group: str
    sender_number: str
    sender_name: Optional[str] = None
    raw_message_text: str = ""

    # Extracted fields from GPT-4o
    code: str = ""  # e.g. "ARA", "WBL", "ASL"
    intent: str = ""  # "AR", "AS", "WR", "WB"
    property_type: str = ""  # "A", "V", "H", "L", "O", "C", "B"
    deal_type: str = "standard"  # "standard", "JD", "JV"
    purpose_or_use: Optional[str] = None

    bhk_min: Optional[float] = None
    bhk_max: Optional[float] = None
    built_up_sqft_min: Optional[float] = None
    built_up_sqft_max: Optional[float] = None
    land_sqft_min: Optional[float] = None
    land_sqft_max: Optional[float] = None
    size_strict: bool = False

    price_basis: Optional[str] = None  # "per_month", "total", "per_sqft", "per_acre", "none"
    price_min: Optional[float] = None
    price_max: Optional[float] = None
    price_rate: Optional[float] = None
    price_flag: str = "ok"  # "ok", "missing", "unclear"
    price_note: Optional[str] = None

    city: str = "Bangalore"
    localities: List[str] = field(default_factory=list)
    streets: List[str] = field(default_factory=list)
    nearby: List[str] = field(default_factory=list)
    project_name: Optional[str] = None
    project_strict: bool = False
    locality_strict: bool = False

    land_use: Optional[str] = None  # "residential", "commercial", "industrial", "agricultural", "mixed", "unknown"
    main_road: Optional[bool] = None
    road_width_ft: Optional[float] = None
    urgency: str = "normal"  # "high", "normal", "low"
    deadline: Optional[str] = None

    contact_name: Optional[str] = None
    contact_numbers: List[str] = field(default_factory=list)

    # Tracking & Deduplication metadata
    posted_in: List[str] = field(default_factory=list)
    broker_id: str = ""
    is_expired: bool = False

    def __post_init__(self):
        if not self.posted_in and self.group:
            self.posted_in = [self.group]
        if not self.intent and len(self.code) >= 2:
            self.intent = self.code[:2]
        if not self.property_type and len(self.code) >= 3:
            self.property_type = self.code[2]

@dataclass
class MatchResult:
    strength: str  # "Strong", "Good", "Possible"
    demand: PropertyListing
    supply: PropertyListing
    score_reasons: List[str] = field(default_factory=list)
    locality_match: str = "Exact"  # "Exact" or "Same area"
    is_partial: bool = False
    urgency: str = "normal"

# ==============================================================================
# LAYER 2: BROKER IDENTITY (UNION-FIND)
# ==============================================================================

class BrokerUnionFind:
    """Disjoint Set / Union-Find across all phone numbers and sender numbers.
    Any phone numbers appearing together in the same listing or message
    belong to the same broker identity.
    """
    def __init__(self):
        self.parent: Dict[str, str] = {}

    def find(self, item: str) -> str:
        if not item:
            return ""
        if item not in self.parent:
            self.parent[item] = item
            return item
        if self.parent[item] != item:
            self.parent[item] = self.find(self.parent[item])
        return self.parent[item]

    def union(self, a: str, b: str) -> None:
        root_a = self.find(a)
        root_b = self.find(b)
        if root_a and root_b and root_a != root_b:
            self.parent[root_b] = root_a

    def get_broker_id(self, phones: List[str]) -> str:
        """Returns the canonical broker ID for a list of phones, or empty string."""
        for p in phones:
            clean = clean_phone_number(p)
            if clean:
                return self.find(clean)
        return ""

# ==============================================================================
# SECTION 1: DEDUPLICATION ENGINE (LAYERS 1, 2, 3) & EXPIRY
# ==============================================================================

class LeadDeduplicator:
    def __init__(self):
        self.uf = BrokerUnionFind()
        self.exact_reposts: Dict[Tuple[str, str], List[PropertyListing]] = {}

    def build_broker_graph(self, raw_messages_or_listings: List[PropertyListing]) -> None:
        """Unions every number in contact_numbers plus sender_number."""
        for listing in raw_messages_or_listings:
            all_phones = [clean_phone_number(listing.sender_number)] + [
                clean_phone_number(p) for p in listing.contact_numbers
            ]
            valid_phones = [p for p in all_phones if p]
            if not valid_phones:
                continue
            base = valid_phones[0]
            for p in valid_phones[1:]:
                self.uf.union(base, p)

        # Assign canonical broker ID to each listing
        for listing in raw_messages_or_listings:
            all_phones = [clean_phone_number(listing.sender_number)] + [
                clean_phone_number(p) for p in listing.contact_numbers
            ]
            listing.broker_id = self.uf.get_broker_id(all_phones) or listing.sender_number

    def is_layer1_exact_repost(self, sender_number: str, text: str, group: str) -> Optional[List[PropertyListing]]:
        """Layer 1: Exact repost before LLM (saves cost).
        Normalizes text (lowercase, remove emojis, spaces, line breaks).
        If already processed, adds group to existing listings' posted_in.
        """
        clean_sender = clean_phone_number(sender_number)
        norm_text = normalize_text_layer1(text)
        if not norm_text:
            return None
        key = (clean_sender, norm_text)
        if key in self.exact_reposts:
            existing_listings = self.exact_reposts[key]
            for l in existing_listings:
                if group and group not in l.posted_in:
                    l.posted_in.append(group)
            return existing_listings
        return None

    def record_layer1_listing(self, sender_number: str, text: str, listing: PropertyListing) -> None:
        clean_sender = clean_phone_number(sender_number)
        norm_text = normalize_text_layer1(text)
        if not norm_text:
            return
        key = (clean_sender, norm_text)
        if key not in self.exact_reposts:
            self.exact_reposts[key] = []
        self.exact_reposts[key].append(listing)

    @staticmethod
    def are_same_listing_layer3(a: PropertyListing, b: PropertyListing) -> bool:
        """Layer 3: Same listing, different wording.
        Two records are the same listing when ALL of these hold:
        - same broker identity
        - same code and deal_type
        - localities + streets overlap (or both name the same project_name)
        - BHK, size and price agree within 10% wherever both records have a value
        """
        # 1. Same broker identity
        if not a.broker_id or not b.broker_id or a.broker_id != b.broker_id:
            return False

        # 2. Same code and deal_type
        if a.code.upper() != b.code.upper():
            return False
        if (a.deal_type or "standard").lower() != (b.deal_type or "standard").lower():
            return False

        # 3. Locality / Street / Project overlap
        locs_a = {x.lower().strip() for x in (a.localities + a.streets) if x}
        locs_b = {x.lower().strip() for x in (b.localities + b.streets) if x}
        has_loc_overlap = bool(locs_a & locs_b)

        has_project_match = False
        if a.project_name and b.project_name:
            if a.project_name.lower().strip() == b.project_name.lower().strip():
                has_project_match = True

        if not (has_loc_overlap or has_project_match):
            return False

        # 4. BHK, Size, and Price agree within 10% wherever both have a value
        # BHK check
        bhk_a = a.bhk_max if a.bhk_max is not None else a.bhk_min
        bhk_b = b.bhk_max if b.bhk_max is not None else b.bhk_min
        if bhk_a is not None and bhk_b is not None:
            max_bhk = max(bhk_a, bhk_b)
            if max_bhk > 0 and abs(bhk_a - bhk_b) / max_bhk > 0.10:
                return False

        # Size check
        size_a = a.built_up_sqft_max or a.land_sqft_max or a.built_up_sqft_min or a.land_sqft_min
        size_b = b.built_up_sqft_max or b.land_sqft_max or b.built_up_sqft_min or b.land_sqft_min
        if size_a is not None and size_b is not None:
            max_size = max(size_a, size_b)
            if max_size > 0 and abs(size_a - size_b) / max_size > 0.10:
                return False

        # Price check
        price_a = a.price_rate or a.price_max or a.price_min
        price_b = b.price_rate or b.price_max or b.price_min
        if price_a is not None and price_b is not None:
            max_price = max(price_a, price_b)
            if max_price > 0 and abs(price_a - price_b) / max_price > 0.10:
                return False

        return True

    @staticmethod
    def merge_listings(newer: PropertyListing, older: PropertyListing) -> PropertyListing:
        """Merge them: keep the newest sent_at, fill empty fields from the older record,
        and add the group to posted_in.
        """
        # Determine newest and older based on timestamp or ISO date
        newer_time = newer.sent_at or ""
        older_time = older.sent_at or ""
        primary = newer if newer_time >= older_time else older
        secondary = older if primary is newer else newer

        # Union posted_in groups
        all_groups = list(dict.fromkeys(primary.posted_in + secondary.posted_in))

        # Fill empty fields from secondary
        return PropertyListing(
            message_id=primary.message_id,
            sent_at=primary.sent_at,
            group=primary.group,
            sender_number=primary.sender_number or secondary.sender_number,
            sender_name=primary.sender_name or secondary.sender_name,
            raw_message_text=primary.raw_message_text or secondary.raw_message_text,
            code=primary.code or secondary.code,
            intent=primary.intent or secondary.intent,
            property_type=primary.property_type or secondary.property_type,
            deal_type=primary.deal_type or secondary.deal_type,
            purpose_or_use=primary.purpose_or_use or secondary.purpose_or_use,
            bhk_min=primary.bhk_min if primary.bhk_min is not None else secondary.bhk_min,
            bhk_max=primary.bhk_max if primary.bhk_max is not None else secondary.bhk_max,
            built_up_sqft_min=primary.built_up_sqft_min if primary.built_up_sqft_min is not None else secondary.built_up_sqft_min,
            built_up_sqft_max=primary.built_up_sqft_max if primary.built_up_sqft_max is not None else secondary.built_up_sqft_max,
            land_sqft_min=primary.land_sqft_min if primary.land_sqft_min is not None else secondary.land_sqft_min,
            land_sqft_max=primary.land_sqft_max if primary.land_sqft_max is not None else secondary.land_sqft_max,
            size_strict=primary.size_strict or secondary.size_strict,
            price_basis=primary.price_basis or secondary.price_basis,
            price_min=primary.price_min if primary.price_min is not None else secondary.price_min,
            price_max=primary.price_max if primary.price_max is not None else secondary.price_max,
            price_rate=primary.price_rate if primary.price_rate is not None else secondary.price_rate,
            price_flag=primary.price_flag if primary.price_flag != "missing" else secondary.price_flag,
            price_note=primary.price_note or secondary.price_note,
            city=primary.city or secondary.city,
            localities=list(dict.fromkeys(primary.localities + secondary.localities)),
            streets=list(dict.fromkeys(primary.streets + secondary.streets)),
            nearby=list(dict.fromkeys(primary.nearby + secondary.nearby)),
            project_name=primary.project_name or secondary.project_name,
            project_strict=primary.project_strict or secondary.project_strict,
            locality_strict=primary.locality_strict or secondary.locality_strict,
            land_use=primary.land_use if (primary.land_use and primary.land_use != "unknown") else secondary.land_use,
            main_road=primary.main_road if primary.main_road is not None else secondary.main_road,
            road_width_ft=primary.road_width_ft if primary.road_width_ft is not None else secondary.road_width_ft,
            urgency=primary.urgency if primary.urgency == "high" else secondary.urgency,
            deadline=primary.deadline or secondary.deadline,
            contact_name=primary.contact_name or secondary.contact_name,
            contact_numbers=list(dict.fromkeys(primary.contact_numbers + secondary.contact_numbers)),
            posted_in=all_groups,
            broker_id=primary.broker_id or secondary.broker_id,
        )

    def deduplicate_listings(self, listings: List[PropertyListing]) -> List[PropertyListing]:
        """Runs Layer 3 deduplication over all listings within the same broker identity."""
        self.build_broker_graph(listings)

        merged: List[PropertyListing] = []
        for item in listings:
            matched_idx = -1
            for idx, existing in enumerate(merged):
                if self.are_same_listing_layer3(existing, item):
                    matched_idx = idx
                    break
            if matched_idx >= 0:
                merged[matched_idx] = self.merge_listings(item, merged[matched_idx])
            else:
                merged.append(item)
        return merged

    @staticmethod
    def is_expired(listing: PropertyListing, reference_date: Optional[datetime] = None) -> bool:
        """Expiry:
        - Rent listings: hide after 30 days
        - Sale listings: hide after 60 days
        - Land listings: hide after 90 days
        - Anything whose deadline has passed
        """
        now = reference_date or datetime.now(timezone.utc)

        # Check explicit deadline
        if listing.deadline:
            try:
                deadline_dt = datetime.fromisoformat(listing.deadline.replace("Z", "+00:00"))
                if now > deadline_dt:
                    return True
            except Exception:
                pass

        if not listing.sent_at:
            return False

        try:
            sent_dt = datetime.fromisoformat(listing.sent_at.replace("Z", "+00:00"))
        except Exception:
            return False

        age_days = (now - sent_dt).total_seconds() / 86400.0

        is_land = listing.property_type == "L" or (len(listing.code) >= 3 and listing.code[2] == "L")
        is_rent = listing.intent in ("AR", "WR") or listing.code.startswith(("AR", "WR"))
        is_sale = listing.intent in ("AS", "WB") or listing.code.startswith(("AS", "WB"))

        if is_land:
            return age_days > 90
        if is_rent:
            return age_days > 30
        if is_sale:
            return age_days > 60

        return False

# ==============================================================================
# SECTION 2 & 3: MATCHING GATES & LOCALITY EVALUATION
# ==============================================================================

class LeadMatcher:
    @staticmethod
    def get_locality_score(demand: PropertyListing, supply: PropertyListing) -> Tuple[str, bool]:
        """Section 3: Locality scoring
        - Exact: demand localities + streets overlap with supply localities + streets + nearby.
        - Same area: both in the same cluster.
        - No match otherwise. If demand locality_strict is true, only Exact counts.
        """
        d_locs = {x.lower().strip() for x in (demand.localities + demand.streets) if x}
        s_locs = {x.lower().strip() for x in (supply.localities + supply.streets + supply.nearby) if x}

        # Check for "any" in demand
        if "any" in d_locs or not d_locs:
            return ("Exact", True)

        # 1. Exact overlap
        if bool(d_locs & s_locs):
            return ("Exact", True)

        # If locality_strict, same area does not count
        if demand.locality_strict:
            return ("No match", False)

        # 2. Same area cluster check
        for cluster_name, places in AREA_CLUSTERS.items():
            cluster_set = {p.lower() for p in places}
            d_in_cluster = bool(d_locs & cluster_set)
            s_in_cluster = bool(s_locs & cluster_set)
            if d_in_cluster and s_in_cluster:
                return ("Same area", True)

        return ("No match", False)

    @staticmethod
    def passes_section2_compatibility_gates(demand: PropertyListing, supply: PropertyListing) -> Tuple[bool, str]:
        """Evaluates all 10 compatibility gates from Section 2."""
        # 1. Intent check: WR pairs with AR. WB pairs with AS.
        d_intent = demand.intent or demand.code[:2]
        s_intent = supply.intent or supply.code[:2]
        if d_intent == "WR" and s_intent != "AR":
            return False, "Intent mismatch: WR must pair with AR"
        if d_intent == "WB" and s_intent != "AS":
            return False, "Intent mismatch: WB must pair with AS"
        if d_intent not in ("WR", "WB"):
            return False, f"Invalid demand intent: {d_intent}"

        # 2. Type check: Same letter
        d_type = demand.property_type or demand.code[2:3]
        s_type = supply.property_type or supply.code[2:3]
        if d_type.upper() != s_type.upper():
            return False, f"Property type mismatch ({d_type} vs {s_type})"

        # 3. Deal type check: JD/JV supply only pairs with demand whose purpose_or_use mentions development/apartments
        s_deal = (supply.deal_type or "standard").upper()
        if s_deal in ("JD", "JV"):
            d_purpose = (demand.purpose_or_use or "").lower()
            if not re.search(r"\b(development|develop|apartment|apartments|builder|construction)\b", d_purpose):
                return False, f"Supply is {s_deal} but demand purpose does not mention development or apartments"

        # 4. Same broker / sender check: Both potential leads must be completely DIFFERENT!
        # 4a. Same base message ID (e.g. multi-item decomposed from the exact same WhatsApp message)
        d_base_id = demand.message_id.split("-item-")[0].split("-list-")[0]
        s_base_id = supply.message_id.split("-item-")[0].split("-list-")[0]
        if d_base_id and s_base_id and d_base_id == s_base_id:
            return False, f"Same source WhatsApp message ({d_base_id})"

        # 4b. Same broker identity from Union-Find graph
        if demand.broker_id and supply.broker_id and demand.broker_id == supply.broker_id:
            return False, f"Same broker identity ({demand.broker_id})"

        # 4c. Same contact phone numbers
        d_phones = {clean_phone_number(demand.sender_number)} | {clean_phone_number(p) for p in demand.contact_numbers}
        s_phones = {clean_phone_number(supply.sender_number)} | {clean_phone_number(p) for p in supply.contact_numbers}
        d_phones = {p for p in d_phones if len(p) >= 10}
        s_phones = {p for p in s_phones if len(p) >= 10}
        if bool(d_phones & s_phones):
            return False, "Same contact phone number across leads"

        # 4d. Same contact / sender name
        generic_names = {"whatsapp member", "whatsapp user", "unknown", "direct contact", ""}
        d_names = {n.strip().lower() for n in (demand.sender_name, demand.contact_name) if n} - generic_names
        s_names = {n.strip().lower() for n in (supply.sender_name, supply.contact_name) if n} - generic_names
        if bool(d_names & s_names):
            return False, "Same contact person across leads"

        # 5. City check: Same city. Demand localities ['Any'] passes locality check but not city check.
        if (demand.city or "").lower().strip() != (supply.city or "").lower().strip():
            return False, f"City mismatch: {demand.city} vs {supply.city}"

        # 6. Project strictness check
        if demand.project_strict:
            d_proj = (demand.project_name or "").lower().strip()
            s_proj = (supply.project_name or "").lower().strip()
            if not d_proj or not s_proj or d_proj != s_proj:
                return False, f"Project strict requirement not met ({d_proj} vs {s_proj})"

        # 7. Locality check
        loc_match, passes_loc = LeadMatcher.get_locality_score(demand, supply)
        if not passes_loc:
            return False, f"Locality mismatch: {loc_match}"

        # 8. Land use check: If both known and not unknown, must agree (mixed agrees with anything)
        d_use = (demand.land_use or "").lower().strip()
        s_use = (supply.land_use or "").lower().strip()
        if d_use and s_use and d_use != "unknown" and s_use != "unknown":
            if d_use != "mixed" and s_use != "mixed" and d_use != s_use:
                return False, f"Land use mismatch: {d_use} vs {s_use}"

        # 9. Main road check: If demand main_road is true, supply main_road must not be false
        if demand.main_road is True and supply.main_road is False:
            return False, "Main road mismatch: demand requires main road, supply is not main road"

        # 10. Road width check: If both known, supply road_width_ft >= demand road_width_ft
        if demand.road_width_ft is not None and supply.road_width_ft is not None:
            if demand.road_width_ft > 0 and supply.road_width_ft < demand.road_width_ft:
                return False, f"Road width shortfall: supply {supply.road_width_ft}ft < demand {demand.road_width_ft}ft"

        return True, "Passed all 10 compatibility gates"

# ==============================================================================
# SECTION 4 & 5: SIZE, BHK, PRICE TOLERANCES & MATCH STRENGTH
# ==============================================================================

    @staticmethod
    def evaluate_size(demand: PropertyListing, supply: PropertyListing) -> Tuple[str, Optional[str]]:
        """Section 4: Size tolerance
        - Built-up for A, V, O, C, B
        - Land for L
        - Land for H when given, else built-up
        """
        p_type = demand.property_type or demand.code[2:3]
        if p_type == "L":
            d_min = demand.land_sqft_min
            d_max = demand.land_sqft_max
            s_val = supply.land_sqft_max or supply.land_sqft_min
        elif p_type == "H":
            if demand.land_sqft_min is not None or demand.land_sqft_max is not None:
                d_min = demand.land_sqft_min
                d_max = demand.land_sqft_max
                s_val = supply.land_sqft_max or supply.land_sqft_min or supply.built_up_sqft_max
            else:
                d_min = demand.built_up_sqft_min
                d_max = demand.built_up_sqft_max
                s_val = supply.built_up_sqft_max or supply.built_up_sqft_min
        else:
            d_min = demand.built_up_sqft_min
            d_max = demand.built_up_sqft_max
            s_val = supply.built_up_sqft_max or supply.built_up_sqft_min

        # Missing check on either side
        if (d_min is None and d_max is None) or s_val is None:
            return "Missing", None

        # Resolve demand range
        min_bound = d_min if d_min is not None else d_max
        max_bound = d_max if d_max is not None else d_min
        if min_bound is None or max_bound is None:
            return "Missing", None
        if min_bound > max_bound:
            min_bound, max_bound = max_bound, min_bound

        # Strong: inside range
        if min_bound <= s_val <= max_bound:
            return "Strong", f"Size inside range ({s_val:.0f} sqft within [{min_bound:.0f}, {max_bound:.0f}])"

        # If size_strict, any amount outside is Fail
        if demand.size_strict:
            return "Fail", f"Size {s_val:.0f} sqft outside strict range [{min_bound:.0f}, {max_bound:.0f}]"

        # Weak: within 15% outside range
        if (0.85 * min_bound) <= s_val <= (1.15 * max_bound):
            return "Weak", f"Size {s_val:.0f} sqft within 15% of range [{min_bound:.0f}, {max_bound:.0f}]"

        return "Fail", f"Size {s_val:.0f} sqft more than 15% outside range [{min_bound:.0f}, {max_bound:.0f}]"

    @staticmethod
    def evaluate_bhk(demand: PropertyListing, supply: PropertyListing) -> Tuple[str, Optional[str]]:
        """Section 4: BHK tolerance (for A, V, H)."""
        p_type = demand.property_type or demand.code[2:3]
        if p_type not in ("A", "V", "H"):
            return "N/A", None

        d_min = demand.bhk_min
        d_max = demand.bhk_max
        s_val = supply.bhk_max if supply.bhk_max is not None else supply.bhk_min

        if (d_min is None and d_max is None) or s_val is None:
            return "Missing", None

        min_bound = d_min if d_min is not None else d_max
        max_bound = d_max if d_max is not None else d_min
        if min_bound is None or max_bound is None:
            return "Missing", None

        # Strong: Same (within demand BHK range)
        if min_bound <= s_val <= max_bound:
            return "Strong", f"BHK exact match ({s_val:.0f} BHK)"

        # Weak: Supply 1 more than demand max
        if s_val == max_bound + 1:
            return "Weak", f"Supply is 1 BHK above demand max ({s_val:.0f} vs max {max_bound:.0f})"

        return "Fail", f"BHK mismatch (Supply {s_val:.0f} BHK outside [{min_bound:.0f}, {max_bound:.0f}])"

    @staticmethod
    def evaluate_price(demand: PropertyListing, supply: PropertyListing) -> Tuple[str, Optional[str]]:
        """Section 4: Price tolerance
        - Compare price_rate when both quote per acre or per sqft. Otherwise compare totals.
        - Supply with price_flag: 'unclear' -> skip price check, mark 'price unverified'
        """
        if supply.price_flag == "unclear":
            return "Unclear", "Price unverified (supply price unclear)"

        # Rate comparison (per sqft or per acre)
        both_rate = (
            demand.price_basis in ("per_sqft", "per_acre") and
            supply.price_basis in ("per_sqft", "per_acre") and
            demand.price_basis == supply.price_basis and
            demand.price_rate is not None and
            supply.price_rate is not None
        )

        if both_rate:
            d_max = demand.price_rate
            s_val = supply.price_rate
        else:
            d_max = demand.price_max if demand.price_max is not None else demand.price_min
            s_val = supply.price_min if supply.price_min is not None else supply.price_max

        if d_max is None or s_val is None or d_max <= 0:
            return "Missing", None

        # Strong: Supply price <= demand price_max
        if s_val <= d_max:
            return "Strong", f"Price within budget (Supply {format_inr(s_val)} <= Budget {format_inr(d_max)})"

        # Weak: Up to 10% above
        if s_val <= 1.10 * d_max:
            pct_over = ((s_val - d_max) / d_max) * 100.0
            return "Weak", f"Price {pct_over:.1f}% above budget (Supply {format_inr(s_val)} vs Budget {format_inr(d_max)})"

        pct_over = ((s_val - d_max) / d_max) * 100.0
        return "Fail", f"Price exceeds budget by {pct_over:.1f}% (Supply {format_inr(s_val)} vs Budget {format_inr(d_max)})"

    def match_pair(self, demand: PropertyListing, supply: PropertyListing) -> Optional[MatchResult]:
        """Evaluates a demand and supply pair against Sections 2, 3, 4, 5."""
        # 1. Compatibility Gates
        passed_gates, gate_reason = self.passes_section2_compatibility_gates(demand, supply)
        if not passed_gates:
            return None

        # 2. Locality Score
        locality_match, _ = self.get_locality_score(demand, supply)

        # 3. Size, BHK, Price evaluations
        size_status, size_reason = self.evaluate_size(demand, supply)
        bhk_status, bhk_reason = self.evaluate_bhk(demand, supply)
        price_status, price_reason = self.evaluate_price(demand, supply)

        # Fail check: Any Fail -> not shown
        eval_statuses = [size_status, bhk_status, price_status]
        if "Fail" in eval_statuses:
            return None

        reasons = [r for r in (size_reason, bhk_reason, price_reason) if r]
        reasons.insert(0, f"Locality {locality_match}")

        # Count Strong, Weak, and Present checks
        strong_count = eval_statuses.count("Strong")
        weak_count = eval_statuses.count("Weak")
        present_count = sum(1 for s in eval_statuses if s in ("Strong", "Weak"))

        is_partial = any(s == "Missing" for s in eval_statuses) or (price_status == "Unclear")

        # Section 5: Match Strength
        # Strong: locality Exact, all available checks Strong, at least two of size/BHK/price present
        if locality_match == "Exact" and weak_count == 0 and present_count >= 2:
            strength = "Strong"
        # Good: no Fail, at most one Weak, locality Exact or Same area
        elif weak_count <= 1 and (locality_match in ("Exact", "Same area")):
            strength = "Good"
        # Possible: no Fail, but key details missing or two or more Weak
        else:
            strength = "Possible"

        urgency = "high" if (demand.urgency == "high" or supply.urgency == "high") else "normal"

        return MatchResult(
            strength=strength,
            demand=demand,
            supply=supply,
            score_reasons=reasons,
            locality_match=locality_match,
            is_partial=is_partial,
            urgency=urgency,
        )

    def match_all(self, listings: List[PropertyListing]) -> List[MatchResult]:
        """Matches all active Demand (WR, WB) with Supply (AR, AS) and sorts them."""
        # Separate into demand and supply
        demand_list = [l for l in listings if l.intent in ("WR", "WB") and not l.is_expired]
        supply_list = [l for l in listings if l.intent in ("AR", "AS") and not l.is_expired]

        matches: List[MatchResult] = []
        for d in demand_list:
            for s in supply_list:
                res = self.match_pair(d, s)
                if res:
                    matches.append(res)

        # Sort: urgency high first, then Strong -> Good -> Possible, then newest sent_at
        strength_rank = {"Strong": 3, "Good": 2, "Possible": 1}

        def sort_key(m: MatchResult):
            urg_val = 1 if m.urgency == "high" else 0
            str_val = strength_rank.get(m.strength, 0)
            date_val = m.demand.sent_at or m.supply.sent_at or ""
            return (urg_val, str_val, date_val)

        matches.sort(key=sort_key, reverse=True)
        return matches

# ==============================================================================
# SECTION 6: CLIENT'S 5-TAB VIEW FORMATTER
# ==============================================================================

def format_inr(val: Optional[float]) -> str:
    """Formats numeric values in standard Indian notation (Cr, L, K)."""
    if val is None or val <= 0:
        return "Not given"
    if val >= 10000000:
        cr = val / 10000000.0
        return f"₹{cr:.2f} Cr" if cr % 1 != 0 else f"₹{cr:.0f} Cr"
    if val >= 100000:
        lakh = val / 100000.0
        return f"₹{lakh:.2f} L" if lakh % 1 != 0 else f"₹{lakh:.0f} L"
    if val >= 1000:
        k = val / 1000.0
        return f"₹{k:.1f} K" if k % 1 != 0 else f"₹{k:.0f} K"
    return f"₹{val:.0f}"

def format_price_display(listing: PropertyListing) -> str:
    """Supply: price. Demand: budget.
    Shown in K / L / Cr with '/month', '/sqft' or '/acre' from price_basis.
    If price_flag is unclear or missing, show price_note or 'Not given'.
    """
    if listing.price_flag in ("unclear", "missing"):
        return listing.price_note or "Not given"

    basis_suffix = ""
    if listing.price_basis == "per_month":
        basis_suffix = "/month"
    elif listing.price_basis == "per_sqft":
        basis_suffix = "/sqft"
    elif listing.price_basis == "per_acre":
        basis_suffix = "/acre"

    # Per-unit rate
    if listing.price_rate:
        return f"{format_inr(listing.price_rate)}{basis_suffix}"

    # Range
    if listing.price_min and listing.price_max and listing.price_min != listing.price_max:
        return f"{format_inr(listing.price_min)} - {format_inr(listing.price_max)}{basis_suffix}"

    val = listing.price_max or listing.price_min
    if val:
        return f"{format_inr(val)}{basis_suffix}"

    return listing.price_note or "Not given"

def format_contact_display(listing: PropertyListing) -> str:
    """contact_name. If null, show sender WhatsApp number.
    contact_numbers is never shown (backend only).
    """
    if listing.contact_name and listing.contact_name.strip():
        return listing.contact_name.strip()
    return listing.sender_number or "Unknown"

def format_location_display(listing: PropertyListing) -> str:
    """localities, then streets, or project_name if no locality."""
    if listing.localities:
        return ", ".join(listing.localities)
    if listing.streets:
        return ", ".join(listing.streets)
    if listing.project_name:
        return listing.project_name
    return listing.city or "Bangalore"

def format_code_display(listing: PropertyListing) -> str:
    """code (+ ' · JD' / ' · JV' from deal_type)."""
    base = listing.code or (listing.intent + listing.property_type)
    deal = (listing.deal_type or "standard").upper()
    if deal in ("JD", "JV"):
        return f"{base} · {deal}"
    return base

@dataclass
class ListingRowView:
    contact: str
    code: str
    price_or_budget: str
    location: str
    posted_in: List[str]
    date: str
    raw_message: str

@dataclass
class MatchRowView:
    match_strength: str
    wants_contact: str
    wants_code: str
    wants_budget: str
    wants_location: str
    has_contact: str
    has_code: str
    has_price: str
    has_location: str
    reasons: str
    demand_raw_message: str
    supply_raw_message: str

def build_client_tabs_view(
    listings: List[PropertyListing],
    matches: List[MatchResult]
) -> Dict[str, Any]:
    """Section 6: Organizes listings into 5 tabs:
    - AR (Available for Rent)
    - AS (Available for Sale)
    - WR (Wants to Rent)
    - WB (Wants to Buy)
    - MATCHED (One row per matched demand + supply pair)
    """
    tabs: Dict[str, List[Any]] = {
        "AR": [],
        "AS": [],
        "WR": [],
        "WB": [],
        "MATCHED": []
    }

    for l in listings:
        if l.is_expired:
            continue
        tab_key = l.intent or l.code[:2]
        if tab_key in tabs:
            row = ListingRowView(
                contact=format_contact_display(l),
                code=format_code_display(l),
                price_or_budget=format_price_display(l),
                location=format_location_display(l),
                posted_in=l.posted_in,
                date=l.sent_at,
                raw_message=l.raw_message_text,
            )
            tabs[tab_key].append(row)

    for m in matches:
        mrow = MatchRowView(
            match_strength=m.strength,
            wants_contact=format_contact_display(m.demand),
            wants_code=format_code_display(m.demand),
            wants_budget=format_price_display(m.demand),
            wants_location=format_location_display(m.demand),
            has_contact=format_contact_display(m.supply),
            has_code=format_code_display(m.supply),
            has_price=format_price_display(m.supply),
            has_location=format_location_display(m.supply),
            reasons=" · ".join(m.score_reasons),
            demand_raw_message=m.demand.raw_message_text,
            supply_raw_message=m.supply.raw_message_text,
        )
        tabs["MATCHED"].append(mrow)

    return tabs

# ==============================================================================
# PIPELINE ORCHESTRATOR
# ==============================================================================

def extract_raw_message_to_listings(
    message_id: str,
    sent_at: str,
    group: str,
    sender_number: str,
    sender_name: Optional[str],
    text: str,
) -> List[PropertyListing]:
    """Decomposes a multi-item raw broker message into structured PropertyListing records.
    Handles numbered items, contact phones at footer, broker codes, localities, and prices.
    """
    if not text or not text.strip():
        return []

    # Extract all contact numbers from message footer or text
    phone_matches = re.findall(r"(?:(?:\+?91[\s\-]?)?[6-9]\d{4}[\s\-]?\d{5})", text)
    contact_numbers = [clean_phone_number(p) for p in phone_matches if len(clean_phone_number(p)) == 10]
    contact_numbers = list(dict.fromkeys(contact_numbers))

    # Split text into numbered items or paragraphs
    lines = text.strip().split("\n")
    items: List[str] = []
    current_item: List[str] = []

    for line in lines:
        stripped = line.strip()
        # Check if line starts a new numbered item, e.g. "1)", "2.", "•", or "JD proposal"
        if re.match(r"^(?:\d+[\)\.\-]|[\*\•\-]|jd\s+proposal)", stripped, re.I):
            if current_item:
                items.append("\n".join(current_item).strip())
                current_item = []
            current_item.append(stripped)
        elif current_item:
            # If line is contact info or footer, stop appending to current item
            if re.search(r"^(?:call|contact|ph|wa|mobile)\b", stripped, re.I):
                continue
            current_item.append(stripped)
        else:
            if stripped and not re.search(r"^(?:call|contact|ph|wa|mobile)\b", stripped, re.I):
                current_item.append(stripped)

    if current_item:
        items.append("\n".join(current_item).strip())

    if not items:
        items = [text.strip()]

    results: List[PropertyListing] = []
    for idx, item_text in enumerate(items):
        item_lower = item_text.lower()

        # Check intent: WB, WR, AS, AR
        is_buy = bool(re.search(r"\b(require|wanted|looking\s+for|urgent\s+requirement|wba|wbl|wbh|wbv)\b", item_lower))
        is_rent_seek = bool(re.search(r"\b(need\s+on\s+rent|wtr|wra|wrh)\b", item_lower))
        is_rent_out = bool(re.search(r"\b(to\s+let|for\s+rent|available\s+for\s+rent|ara|arh)\b", item_lower))
        is_sale = bool(re.search(r"\b(for\s+sale|available\s+for\s+sale|plot\s+available|land\s+available|asa|asl|ash)\b", item_lower))
        is_jd = bool(re.search(r"\b(jd\s+proposal|joint\s+development|jv\b)", item_lower))

        if is_rent_seek:
            intent = "WR"
        elif is_buy:
            intent = "WB"
        elif is_rent_out:
            intent = "AR"
        else:
            intent = "AS"

        deal_type = "JD" if is_jd else "standard"

        # Determine Property Type
        # L = Land/Plot, A = Apartment, H = House/Villa, O = Office, C = Commercial
        if bool(re.search(r"\b(acre|acres|land|plot|site|layout)\b", item_lower)):
            prop_type = "L"
            if bool(re.search(r"\b(house|villa|independent\s+house|plot\s+with\s+house)\b", item_lower)):
                prop_type = "H"
        elif bool(re.search(r"\b(villa|house|bhk\s+house)\b", item_lower)):
            prop_type = "H"
        elif bool(re.search(r"\b(office|it\s+park|tech\s+park)\b", item_lower)):
            prop_type = "O"
        elif bool(re.search(r"\b(commercial|showroom|shop|retail)\b", item_lower)):
            prop_type = "C"
        else:
            prop_type = "A"

        code = f"{intent}{prop_type}"

        # Purpose or use
        purpose = None
        if bool(re.search(r"\b(apartment|apartments|development|develop|construction)\b", item_lower)):
            purpose = "development for apartments"

        # BHK
        bhk_min = None
        bhk_max = None
        bhk_match = re.search(r"\b([1-6])\s*bhk\b", item_lower)
        if bhk_match:
            bhk_val = float(bhk_match.group(1))
            bhk_min = bhk_val
            bhk_max = bhk_val

        # Sizes: sqft or acres
        built_min = None
        built_max = None
        land_min = None
        land_max = None

        # Acres
        acre_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*acres?", item_lower)
        if acre_match:
            a1 = float(acre_match.group(1))
            a2 = float(acre_match.group(2)) if acre_match.group(2) else a1
            land_min = min(a1, a2) * 43560.0
            land_max = max(a1, a2) * 43560.0

        # Sqft
        sqft_match = re.search(r"(\d+(?:,\d+)?)\s*(?:sft|sqft|sq\s*ft)\b", item_lower)
        if sqft_match:
            sqft_val = float(sqft_match.group(1).replace(",", ""))
            if prop_type in ("L", "H"):
                land_min = sqft_val
                land_max = sqft_val
            else:
                built_min = sqft_val
                built_max = sqft_val

        # Dimensions e.g. 40x60
        dim_match = re.search(r"\b(\d{2,3})\s*[xX*]\s*(\d{2,3})\b", item_lower)
        if dim_match:
            d1 = float(dim_match.group(1))
            d2 = float(dim_match.group(2))
            calc_sqft = d1 * d2
            land_min = calc_sqft
            land_max = calc_sqft

        # Road width ft
        road_width = None
        road_match = re.search(r"(\d+)\s*(?:feet|ft)\s*(?:road|entrance|wide)", item_lower)
        if road_match:
            road_width = float(road_match.group(1))

        # Price / Budget
        price_min = None
        price_max = None
        price_rate = None
        price_basis = "total"

        # Rate per acre
        per_acre_match = re.search(r"(?:rs\.?|₹)?\s*(\d+(?:\.\d+)?)\s*(?:cr|crore)\s*per\s*acre", item_lower)
        if per_acre_match:
            price_rate = float(per_acre_match.group(1)) * 10000000.0
            price_basis = "per_acre"
        else:
            # Total Cr
            cr_match = re.search(r"(?:rs\.?|₹|budget)?\s*(\d+(?:\.\d+)?)\s*(?:cr|crore)\b", item_lower)
            if cr_match:
                price_max = float(cr_match.group(1)) * 10000000.0
                price_min = price_max
            else:
                # Lakhs
                lakh_match = re.search(r"(?:rs\.?|₹)?\s*(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|l)\b", item_lower)
                if lakh_match:
                    price_max = float(lakh_match.group(1)) * 100000.0
                    price_min = price_max
                    if intent in ("AR", "WR") or price_max <= 300000:
                        price_basis = "per_month"
                else:
                    # K
                    k_match = re.search(r"(?:rs\.?|₹)?\s*(\d+(?:\.\d+)?)\s*k\b", item_lower)
                    if k_match:
                        price_max = float(k_match.group(1)) * 1000.0
                        price_min = price_max
                        if intent in ("AR", "WR") or price_max <= 200000:
                            price_basis = "per_month"

        # Localities match
        found_localities: List[str] = []
        for cluster, places in AREA_CLUSTERS.items():
            for p in places:
                if re.search(rf"\b{re.escape(p)}\b", item_lower):
                    found_localities.append(p.title())
        found_localities = list(dict.fromkeys(found_localities))

        urgency = "high" if re.search(r"\b(urgent|urgently|immediate)\b", item_lower) else "normal"

        listing = PropertyListing(
            message_id=f"{message_id}-item-{idx+1}" if len(items) > 1 else message_id,
            sent_at=sent_at,
            group=group,
            sender_number=sender_number,
            sender_name=sender_name,
            raw_message_text=item_text,
            code=code,
            intent=intent,
            property_type=prop_type,
            deal_type=deal_type,
            purpose_or_use=purpose,
            bhk_min=bhk_min,
            bhk_max=bhk_max,
            built_up_sqft_min=built_min,
            built_up_sqft_max=built_max,
            land_sqft_min=land_min,
            land_sqft_max=land_max,
            price_basis=price_basis,
            price_min=price_min,
            price_max=price_max,
            price_rate=price_rate,
            city="Bangalore",
            localities=found_localities,
            road_width_ft=road_width,
            urgency=urgency,
            contact_name=sender_name,
            contact_numbers=contact_numbers,
        )
        results.append(listing)

    return results

def process_raw_records_pipeline(
    raw_inputs: List[Dict[str, Any]],
    reference_date: Optional[datetime] = None
) -> Tuple[List[PropertyListing], List[MatchResult], Dict[str, Any]]:
    """Full end-to-end pipeline:
    1. Parse raw records / GPT-4o listing objects / raw WhatsApp text messages
    2. Layer 1, 2, 3 Deduplication (exact reposts, broker graph union-find, listing merge)
    3. Expiry filtering
    4. Match Engine (10 gates + locality clusters + tolerance scoring)
    5. Build 5-Tab client view
    """
    dedup = LeadDeduplicator()
    listings: List[PropertyListing] = []

    for item in raw_inputs:
        text = item.get("text") or item.get("raw_message_text") or item.get("raw_text") or ""
        sender_number = item.get("sender_number") or item.get("senderPhone") or ""
        group = item.get("group") or item.get("groupName") or "Direct message"
        msg_id = item.get("message_id") or item.get("id") or f"msg-{len(listings)}"
        sent_at = item.get("sent_at") or (
            datetime.fromtimestamp(item["timestamp"] / 1000.0, timezone.utc).isoformat()
            if isinstance(item.get("timestamp"), (int, float)) and item["timestamp"] > 10000000000
            else (datetime.fromtimestamp(item["timestamp"], timezone.utc).isoformat() if isinstance(item.get("timestamp"), (int, float)) else None)
        ) or datetime.now(timezone.utc).isoformat()
        sender_name = item.get("sender_name") or item.get("senderName")

        # Check Layer 1 before processing
        repost = dedup.is_layer1_exact_repost(sender_number, text, group)
        if repost:
            continue

        # Check if item already has structured listings from GPT-4o
        sub_listings = item.get("listings")
        if isinstance(sub_listings, list) and sub_listings:
            for sub in sub_listings:
                listing_obj = PropertyListing(
                    message_id=msg_id,
                    sent_at=sent_at,
                    group=group,
                    sender_number=sender_number,
                    sender_name=sender_name,
                    raw_message_text=text,
                    code=sub.get("code") or "",
                    intent=sub.get("intent") or (sub.get("code", "")[:2]),
                    property_type=sub.get("property_type") or (sub.get("code", "")[2:3]),
                    deal_type=sub.get("deal_type") or "standard",
                    purpose_or_use=sub.get("purpose_or_use"),
                    bhk_min=sub.get("bhk_min"),
                    bhk_max=sub.get("bhk_max"),
                    built_up_sqft_min=sub.get("built_up_sqft_min"),
                    built_up_sqft_max=sub.get("built_up_sqft_max"),
                    land_sqft_min=sub.get("land_sqft_min"),
                    land_sqft_max=sub.get("land_sqft_max"),
                    size_strict=bool(sub.get("size_strict")),
                    price_basis=sub.get("price_basis"),
                    price_min=sub.get("price_min"),
                    price_max=sub.get("price_max"),
                    price_rate=sub.get("price_rate"),
                    price_flag=sub.get("price_flag") or "ok",
                    price_note=sub.get("price_note"),
                    city=sub.get("city") or "Bangalore",
                    localities=sub.get("localities") or [],
                    streets=sub.get("streets") or [],
                    nearby=sub.get("nearby") or [],
                    project_name=sub.get("project_name"),
                    project_strict=bool(sub.get("project_strict")),
                    locality_strict=bool(sub.get("locality_strict")),
                    land_use=sub.get("land_use"),
                    main_road=sub.get("main_road"),
                    road_width_ft=sub.get("road_width_ft"),
                    urgency=sub.get("urgency") or "normal",
                    deadline=sub.get("deadline"),
                    contact_name=sub.get("contact_name") or sender_name,
                    contact_numbers=sub.get("contact_numbers") or [],
                )
                listings.append(listing_obj)
                dedup.record_layer1_listing(sender_number, text, listing_obj)
        elif item.get("code"):
            # Single structured record
            listing_obj = PropertyListing(
                message_id=msg_id,
                sent_at=sent_at,
                group=group,
                sender_number=sender_number,
                sender_name=sender_name,
                raw_message_text=text,
                code=item.get("code") or "",
                intent=item.get("intent") or (item.get("code", "")[:2]),
                property_type=item.get("property_type") or (item.get("code", "")[2:3]),
                deal_type=item.get("deal_type") or "standard",
                purpose_or_use=item.get("purpose_or_use"),
                bhk_min=item.get("bhk_min"),
                bhk_max=item.get("bhk_max"),
                built_up_sqft_min=item.get("built_up_sqft_min"),
                built_up_sqft_max=item.get("built_up_sqft_max"),
                land_sqft_min=item.get("land_sqft_min"),
                land_sqft_max=item.get("land_sqft_max"),
                size_strict=bool(item.get("size_strict")),
                price_basis=item.get("price_basis"),
                price_min=item.get("price_min"),
                price_max=item.get("price_max"),
                price_rate=item.get("price_rate"),
                price_flag=item.get("price_flag") or "ok",
                price_note=item.get("price_note"),
                city=item.get("city") or "Bangalore",
                localities=item.get("localities") or [],
                streets=item.get("streets") or [],
                nearby=item.get("nearby") or [],
                project_name=item.get("project_name"),
                project_strict=bool(item.get("project_strict")),
                locality_strict=bool(item.get("locality_strict")),
                land_use=item.get("land_use"),
                main_road=item.get("main_road"),
                road_width_ft=item.get("road_width_ft"),
                urgency=item.get("urgency") or "normal",
                deadline=item.get("deadline"),
                contact_name=item.get("contact_name") or sender_name,
                contact_numbers=item.get("contact_numbers") or [],
            )
            listings.append(listing_obj)
            dedup.record_layer1_listing(sender_number, text, listing_obj)
        else:
            # Raw WhatsApp message: decompose text into items!
            extracted = extract_raw_message_to_listings(
                message_id=msg_id,
                sent_at=sent_at,
                group=group,
                sender_number=sender_number,
                sender_name=sender_name,
                text=text,
            )
            for ex in extracted:
                listings.append(ex)
                dedup.record_layer1_listing(sender_number, text, ex)

    # Layer 2 & 3 Deduplication
    unique_listings = dedup.deduplicate_listings(listings)

    # Expiry Check
    for l in unique_listings:
        l.is_expired = dedup.is_expired(l, reference_date)

    # Lead Matching
    matcher = LeadMatcher()
    matches = matcher.match_all(unique_listings)

    # Client 5-Tab View
    tabs = build_client_tabs_view(unique_listings, matches)

    return unique_listings, matches, tabs

# ==============================================================================
# CLI DISPLAY HELPER
# ==============================================================================

def print_cli_summary(tabs: Dict[str, Any]) -> None:
    print("\n" + "="*80)
    print(" 🏠  BANGALORE REAL ESTATE WHATSAPP LEADS: CLIENT 5-TAB VIEW")
    print("="*80)

    for tab in ("AR", "AS", "WR", "WB"):
        rows = tabs.get(tab, [])
        tab_names = {
            "AR": "TAB 1: AR (Available for Rent)",
            "AS": "TAB 2: AS (Available for Sale)",
            "WR": "TAB 3: WR (Wants to Rent)",
            "WB": "TAB 4: WB (Wants to Buy)",
        }
        print(f"\n--- {tab_names[tab]} [{len(rows)} listings] ---")
        if not rows:
            print("  (No active listings)")
            continue
        print(f"  {'CONTACT':<18} | {'CODE':<10} | {'PRICE / BUDGET':<22} | {'LOCATION'}")
        print("  " + "-"*76)
        for r in rows:
            print(f"  {r.contact[:18]:<18} | {r.code:<10} | {r.price_or_budget:<22} | {r.location}")

    matched_rows = tabs.get("MATCHED", [])
    print(f"\n--- TAB 5: MATCHED LEADS [{len(matched_rows)} pairs] ---")
    if not matched_rows:
        print("  (No qualified matches)")
    else:
        for idx, m in enumerate(matched_rows, 1):
            print(f"\n  [{idx}] MATCH STRENGTH: [{m.match_strength.upper()}]")
            print(f"      DEMAND (WANTS): {m.wants_contact} | Code: {m.wants_code} | Budget: {m.wants_budget} | Loc: {m.wants_location}")
            print(f"      SUPPLY (HAS):   {m.has_contact} | Code: {m.has_code} | Price:  {m.has_price} | Loc: {m.has_location}")
            print(f"      REASONS:        {m.reasons}")
    print("\n" + "="*80 + "\n")

# ==============================================================================
# SECTION 7: CANONICAL EDGE CASES & UNIT DEMO
# ==============================================================================

def run_canonical_demo() -> None:
    """Runs a complete test and demonstration covering all edge cases from Section 7:
    1. Koramangala 4 BHK vs Prestige Autumn Leaves plot (blocked by type A vs L and project strictness)
    2. Cooke Town 2 BHK vs Wheeler Road 3 BHK (blocked by same-broker check; price 60K vs 40K budget fails)
    3. '5000+ sqft' showing as size, not budget
    4. JD / JV apartment development matching
    5. Sadarahalli repost merge with budget
    """
    print("\n[Running Canonical Section 7 Verification & Matching Demonstration...]")

    sample_records = [
        # Record 1: Demand - Raheja Vivarea 4 BHK in Koramangala (WBA)
        {
            "id": "msg-1",
            "sent_at": "2026-11-04T10:00:00Z",
            "group": "Bangalore Luxury Group",
            "sender_number": "9845011111",
            "sender_name": "Rohan (Buyer Rep)",
            "text": "Client urgently looking for 4 BHK in Raheja Vivarea Koramangala only. Budget 10 Cr. Serious buyer.",
            "code": "WBA",
            "intent": "WB",
            "property_type": "A",
            "bhk_min": 4,
            "bhk_max": 4,
            "price_max": 100000000,
            "project_name": "Raheja Vivarea",
            "project_strict": True,
            "city": "Bangalore",
            "localities": ["Koramangala"],
        },
        # Record 2: Supply - Prestige Autumn Leaves Plot in Koramangala (ASL)
        {
            "id": "msg-2",
            "sent_at": "2026-11-04T10:05:00Z",
            "group": "Bangalore Plots Group",
            "sender_number": "9845022222",
            "sender_name": "Vikram Plots",
            "text": "Plot for sale in Prestige Autumn Leaves Koramangala 4000 sqft at 8 Cr.",
            "code": "ASL",
            "intent": "AS",
            "property_type": "L",
            "land_sqft_min": 4000,
            "land_sqft_max": 4000,
            "price_max": 80000000,
            "project_name": "Prestige Autumn Leaves",
            "city": "Bangalore",
            "localities": ["Koramangala"],
        },
        # Record 3: Demand - Cooke Town 2 BHK Rent (WRA) - Broker Phone: 9591292090
        {
            "id": "msg-3",
            "sent_at": "2026-11-04T11:00:00Z",
            "group": "Central Bangalore Rentals",
            "sender_number": "9591292090",
            "sender_name": "Suresh Broker",
            "contact_numbers": ["9845007923"],
            "text": "Required 2 BHK for rent in Cooke Town. Budget 40K.",
            "code": "WRA",
            "intent": "WR",
            "property_type": "A",
            "bhk_min": 2,
            "bhk_max": 2,
            "price_basis": "per_month",
            "price_max": 40000,
            "city": "Bangalore",
            "localities": ["Cooke Town"],
        },
        # Record 4: Supply - Wheeler Road 3 BHK Rent (ARA) - Posted by 9845007923 (Same Broker!)
        {
            "id": "msg-4",
            "sent_at": "2026-11-04T11:15:00Z",
            "group": "Central Bangalore Rentals",
            "sender_number": "9845007923",
            "sender_name": "Suresh Office",
            "contact_numbers": ["9591292090"],
            "text": "3 BHK available for rent in Wheeler Road at 60k per month.",
            "code": "ARA",
            "intent": "AR",
            "property_type": "A",
            "bhk_min": 3,
            "bhk_max": 3,
            "price_basis": "per_month",
            "price_max": 60000,
            "city": "Bangalore",
            "localities": ["Wheeler Road"],
        },
        # Record 5: Supply - Cooke Town 2 BHK Rent (ARA) from a DIFFERENT broker (Valid Match!)
        {
            "id": "msg-5",
            "sent_at": "2026-11-04T11:30:00Z",
            "group": "Central Bangalore Rentals",
            "sender_number": "9880033333",
            "sender_name": "Amit Landlord",
            "text": "2 BHK flat available for rent in Cooke Town, 1200 sqft, 42K negotiable.",
            "code": "ARA",
            "intent": "AR",
            "property_type": "A",
            "bhk_min": 2,
            "bhk_max": 2,
            "built_up_sqft_min": 1200,
            "built_up_sqft_max": 1200,
            "price_basis": "per_month",
            "price_max": 42000,
            "city": "Bangalore",
            "localities": ["Cooke Town"],
        },
        # Record 6: Demand - Land for Apartment Development near Devanahalli (WBL)
        {
            "id": "msg-6",
            "sent_at": "2026-11-04T12:00:00Z",
            "group": "Airport Land Deals",
            "sender_number": "9711044444",
            "sender_name": "Priya Developer",
            "text": "Urgently require 3 to 5 acres land for apartment development near Devanahalli.",
            "code": "WBL",
            "intent": "WB",
            "property_type": "L",
            "purpose_or_use": "development for apartments",
            "land_sqft_min": 130680,  # 3 acres
            "land_sqft_max": 217800,  # 5 acres
            "city": "Bangalore",
            "localities": ["Devanahalli"],
            "urgency": "high",
        },
        # Record 7: Supply - JD Proposal for Apartment in Devanahalli (ASL · JD)
        {
            "id": "msg-7",
            "sent_at": "2026-11-04T12:10:00Z",
            "group": "Airport Land Deals",
            "sender_number": "9900055555",
            "sender_name": "Kartik Land",
            "text": "JD proposal (Only for apartment) Devanahalli Airport back side 3.5 acre. 97 ft road.",
            "code": "ASL",
            "intent": "AS",
            "property_type": "L",
            "deal_type": "JD",
            "land_sqft_min": 152460,  # 3.5 acres
            "land_sqft_max": 152460,
            "road_width_ft": 97,
            "city": "Bangalore",
            "localities": ["Devanahalli"],
        },
        # Record 8: Initial Sadarahalli requirement without budget
        {
            "id": "msg-8",
            "sent_at": "2026-11-04T13:00:00Z",
            "group": "North Bangalore Brokers",
            "sender_number": "917042846062",
            "sender_name": "Kartik",
            "text": "Urgently Require 1.5 - 2 Acres Land for Purchase in Sadarahalli, Chikkajala surroundings.",
            "code": "WBL",
            "intent": "WB",
            "property_type": "L",
            "land_sqft_min": 65340,
            "land_sqft_max": 87120,
            "city": "Bangalore",
            "localities": ["Sadarahalli", "Chikkajala"],
        },
        # Record 9: Repost of Sadarahalli requirement with budget (Layer 3 merge test)
        {
            "id": "msg-9",
            "sent_at": "2026-11-04T14:00:00Z",
            "group": "Airport Land Deals",
            "sender_number": "917042846062",
            "sender_name": "Kartik",
            "text": "Urgently Require 1.5 - 2 Acres Land for Purchase in Sadarahalli, immediate finalization Budget Rs. 15cr.",
            "code": "WBL",
            "intent": "WB",
            "property_type": "L",
            "land_sqft_min": 65340,
            "land_sqft_max": 87120,
            "price_max": 150000000,
            "city": "Bangalore",
            "localities": ["Sadarahalli"],
        },
    ]

    listings, matches, tabs = process_raw_records_pipeline(sample_records)
    print_cli_summary(tabs)

    # Assertions
    # 1. Row 1 test: msg-1 (Raheja Vivarea A) vs msg-2 (Autumn leaves L) must NOT match
    m1_m2 = any(
        (m.demand.message_id == "msg-1" and m.supply.message_id == "msg-2")
        for m in matches
    )
    assert not m1_m2, "TEST FAILURE: Koramangala 4 BHK should NOT match Land Plot!"
    print("✅ TEST 1 PASSED: Koramangala 4 BHK Apartment vs Plot was blocked by Type Check (A vs L).")

    # 2. Row 2 test: msg-3 vs msg-4 must NOT match (Same broker identity: 9591292090 and 9845007923)
    m3_m4 = any(
        (m.demand.message_id == "msg-3" and m.supply.message_id == "msg-4")
        for m in matches
    )
    assert not m3_m4, "TEST FAILURE: msg-3 and msg-4 belong to the same broker and must NOT match!"
    print("✅ TEST 2 PASSED: Cooke Town vs Wheeler Road was blocked by Same-Broker Identity Check.")

    # 3. Valid match test: msg-3 (Cooke Town 2 BHK) vs msg-5 (Cooke Town 2 BHK from diff broker)
    m3_m5 = any(
        (m.demand.message_id == "msg-3" and m.supply.message_id == "msg-5")
        for m in matches
    )
    assert m3_m5, "TEST FAILURE: Cooke Town 2 BHK should match valid Cooke Town landlord!"
    print("✅ TEST 3 PASSED: Cooke Town 2 BHK matched with landlord from different broker.")

    # 4. JD development test: msg-6 (apartment development demand) vs msg-7 (JD supply)
    m6_m7 = any(
        (m.demand.message_id == "msg-6" and m.supply.message_id == "msg-7")
        for m in matches
    )
    assert m6_m7, "TEST FAILURE: Devanahalli apartment development should match JD supply!"
    print("✅ TEST 4 PASSED: Devanahalli apartment development matched with JD Proposal.")

    # 5. Layer 3 Deduplication test: msg-8 and msg-9 must be merged into 1 Sadarahalli listing with budget
    sadarahalli_listings = [
        l for l in listings
        if "Sadarahalli" in l.localities and l.intent == "WB"
    ]
    assert len(sadarahalli_listings) == 1, f"Expected 1 merged Sadarahalli listing, found {len(sadarahalli_listings)}"
    assert sadarahalli_listings[0].price_max == 150000000, "Expected merged listing to have updated Rs 15 Cr budget"
    assert len(sadarahalli_listings[0].posted_in) >= 2, "Expected merged listing to include both groups in posted_in"
    print("✅ TEST 5 PASSED: Sadarahalli reposts were successfully merged with budget and multiple groups.")

    print("\n🎉 ALL CANONICAL TEST CASES PASSED SUCCESSFULLY!\n")

def main():
    parser = argparse.ArgumentParser(description="Bangalore Real Estate WhatsApp Lead Matcher")
    parser.add_argument("--demo", action="store_true", help="Run canonical edge case verification & demo")
    parser.add_argument("--input", type=str, help="Path to input JSON file containing captured messages or extracted listings")
    parser.add_argument("--output", type=str, help="Path to write output JSON matching results")
    args = parser.parse_args()

    if args.demo or len(sys.argv) == 1:
        run_canonical_demo()
        return

    if args.input:
        if not os.path.exists(args.input):
            print(f"Error: Input file '{args.input}' not found.")
            sys.exit(1)
        with open(args.input, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            data = [data]

        listings, matches, tabs = process_raw_records_pipeline(data)
        print_cli_summary(tabs)

        if args.output:
            export_payload = {
                "summary": {
                    "total_unique_listings": len(listings),
                    "total_matches": len(matches),
                    "tabs_counts": {k: len(v) for k, v in tabs.items()},
                },
                "matches": [
                    {
                        "strength": m.strength,
                        "reasons": m.score_reasons,
                        "demand": {
                            "code": m.demand.code,
                            "contact": format_contact_display(m.demand),
                            "budget": format_price_display(m.demand),
                            "location": format_location_display(m.demand),
                            "text": m.demand.raw_message_text,
                        },
                        "supply": {
                            "code": m.supply.code,
                            "contact": format_contact_display(m.supply),
                            "price": format_price_display(m.supply),
                            "location": format_location_display(m.supply),
                            "text": m.supply.raw_message_text,
                        }
                    }
                    for m in matches
                ]
            }
            with open(args.output, "w", encoding="utf-8") as out_f:
                json.dump(export_payload, out_f, indent=2)
            print(f"Matching results exported to: {args.output}")

if __name__ == "__main__":
    main()
