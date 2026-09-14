import { describe, expect, it } from "vitest";

import {
  NAV_SECTIONS,
  activeNavHref,
  breadcrumbsFor,
  flattenNav,
  getNavSections,
  getOutreachSection,
  isNavActive,
  isNavBranchActive,
} from "./nav";

const leads = NAV_SECTIONS.flatMap((s) => s.items).find(
  (i) => i.href === "/leads",
)!;

describe("getOutreachSection / vertical separation", () => {
  it("renders Real Estate outreach tabs and excludes E-Commerce tabs", () => {
    const section = getOutreachSection("real_estate");
    const labels = section.items.map((i) => i.label);
    const hrefs = section.items.map((i) => i.href);

    expect(labels).toEqual(["Pre-Sales", "Reactivate", "Tranche Recovery"]);
    expect(hrefs).toEqual([
      "/campaigns/templates/pre-sales",
      "/campaigns",
      "/campaigns/templates/tranche-recovery",
    ]);
    expect(labels).not.toContain("Cart Recovery");
    expect(labels).not.toContain("COD Confirmation");
  });

  it("renders E-Commerce outreach tabs and excludes Real Estate tabs", () => {
    const section = getOutreachSection("ecommerce");
    const labels = section.items.map((i) => i.label);
    const hrefs = section.items.map((i) => i.href);

    expect(labels).toEqual(["Campaigns", "Cart Recovery", "COD Confirmation"]);
    expect(hrefs).toEqual([
      "/campaigns",
      "/campaigns/templates/cart-recovery",
      "/campaigns/templates/cod-confirmation",
    ]);
    expect(labels).not.toContain("Pre-Sales");
    expect(labels).not.toContain("Tranche Recovery");
  });
});

describe("activeNavHref", () => {
  it("resolves an exact match", () => {
    expect(activeNavHref("/leads")).toBe("/leads");
  });

  it("resolves a child route to its nav parent", () => {
    expect(activeNavHref("/campaigns/9f3a")).toBe("/campaigns");
  });

  it("prefers the deepest match over the parent for Real Estate", () => {
    const reSections = getNavSections("real_estate");
    expect(activeNavHref("/campaigns/templates/pre-sales", reSections)).toBe(
      "/campaigns/templates/pre-sales",
    );
    expect(activeNavHref("/campaigns/templates/tranche-recovery", reSections)).toBe(
      "/campaigns/templates/tranche-recovery",
    );
  });

  it("prefers the deepest match over the parent for E-Commerce", () => {
    const ecomSections = getNavSections("ecommerce");
    expect(activeNavHref("/campaigns/templates/cart-recovery", ecomSections)).toBe(
      "/campaigns/templates/cart-recovery",
    );
  });

  it("requires a path boundary, not a bare prefix", () => {
    expect(activeNavHref("/leads-archive")).toBeNull();
  });

  it("returns null for a route that is not in the nav", () => {
    expect(activeNavHref("/pulse")).toBeNull();
  });
});

describe("isNavActive", () => {
  it("lights exactly one entry on a Real Estate sub-item route", () => {
    const path = "/campaigns/templates/pre-sales";
    const reSections = getNavSections("real_estate");
    const lit = flattenNav(reSections).filter((i) => isNavActive(path, i.href, reSections));
    expect(lit.map((i) => i.href)).toEqual([path]);
  });

  it("lights exactly one entry on an E-Com sub-item route", () => {
    const path = "/campaigns/templates/cart-recovery";
    const ecomSections = getNavSections("ecommerce");
    const lit = flattenNav(ecomSections).filter((i) => isNavActive(path, i.href, ecomSections));
    expect(lit.map((i) => i.href)).toEqual([path]);
  });
});

describe("isNavBranchActive", () => {
  const ecomSections = getNavSections("ecommerce");
  const ecomCampaigns = ecomSections.flatMap((s) => s.items).find((i) => i.href === "/campaigns")!;

  const nested = [
    {
      label: "Outreach",
      items: [
        {
          href: "/campaigns",
          label: "Campaigns",
          icon: ecomCampaigns.icon,
          children: [
            {
              href: "/campaigns/templates/cart-recovery",
              label: "Cart Recovery",
              icon: ecomCampaigns.icon,
            },
          ],
        },
      ],
    },
  ];

  it("is true for the parent when a child is active", () => {
    expect(
      isNavBranchActive(
        "/campaigns/templates/cart-recovery",
        nested[0].items[0],
        nested,
      ),
    ).toBe(true);
  });

  it("is false for an unrelated branch", () => {
    expect(isNavBranchActive("/campaigns/templates/cart-recovery", leads, ecomSections)).toBe(
      false,
    );
  });

  // Flat nav: a sibling must not light up its neighbour.
  it("does not treat a sibling as part of the branch in flat nav", () => {
    expect(
      isNavBranchActive("/campaigns/templates/cart-recovery", ecomCampaigns, ecomSections),
    ).toBe(false);
  });
});

describe("breadcrumbsFor", () => {
  it("returns one crumb for a top-level page", () => {
    expect(breadcrumbsFor("/leads")).toEqual([
      { label: "Leads", href: "/leads" },
    ]);
  });

  it("gives a URL-nested but nav-top-level page a single crumb", () => {
    const reSections = getNavSections("real_estate");
    expect(breadcrumbsFor("/campaigns/templates/pre-sales", reSections)).toEqual([
      { label: "Pre-Sales", href: "/campaigns/templates/pre-sales" },
    ]);
  });

  it("is empty off-nav, so the topbar renders nothing", () => {
    expect(breadcrumbsFor("/pulse")).toEqual([]);
  });
});
