import {
  Building2Icon,
  CodeIcon,
  CreditCardIcon,
  LayoutGridIcon,
  MessageCircleIcon,
  PackageCheckIcon,
  PlugZapIcon,
  RadioIcon,
  ReceiptIcon,
  SettingsIcon,
  ShoppingCartIcon,
  UserCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import type { OrganisationIndustry } from "@/types/organisation";

/**
 * The single description of the app's navigation.
 *
 * Four surfaces need this now — the sidebar, the mobile drawer, the topbar
 * breadcrumb and the ⌘K palette — and a nav duplicated four ways drifts within
 * a release. Everything below is data; the components only decide how to draw
 * it.
 */

export type NavBadgeKey = "unique_leads";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: NavBadgeKey;
  /** Extra terms the ⌘K palette should match on. Never rendered. */
  keywords?: readonly string[];
  children?: readonly NavItem[];
}

export interface NavSection {
  label: string;
  items: readonly NavItem[];
}

const OVERVIEW_SECTION: NavSection = {
  label: "Overview",
  items: [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutGridIcon,
      keywords: ["home", "overview", "stats"],
    },
  ],
};

const LEADS_SECTION: NavSection = {
  label: "Leads",
  items: [
    {
      href: "/leads",
      label: "Leads",
      icon: UsersIcon,
      badgeKey: "unique_leads",
      keywords: ["contacts", "people", "customers", "crm"],
    },
    {
      href: "/conversations",
      label: "Conversations",
      icon: MessageCircleIcon,
      keywords: ["calls", "transcripts", "history"],
    },
  ],
};

const SYSTEM_SECTION: NavSection = {
  label: "System",
  items: [
    {
      href: "/integrations",
      label: "Integrations",
      icon: PlugZapIcon,
      keywords: [
        "google ads",
        "whatsapp",
        "99acres",
        "webhook",
        "lead capture",
        "sources",
        "shopify",
        "connect",
      ],
    },
    {
      href: "/settings",
      label: "Settings",
      icon: SettingsIcon,
      keywords: ["preferences", "workspace", "account", "team", "members", "roles"],
    },
    {
      href: "/developer",
      label: "Developer",
      icon: CodeIcon,
      keywords: ["api", "webhooks", "keys"],
    },
    {
      href: "/billing",
      label: "Billing",
      icon: CreditCardIcon,
      keywords: ["invoice", "plan", "subscription"],
    },
  ],
};

/** Build outreach nav items tailored to the tenant's industry */
export function getOutreachSection(industry: OrganisationIndustry = "real_estate"): NavSection {
  if (industry === "ecommerce") {
    return {
      label: "Outreach",
      items: [
        {
          href: "/campaigns",
          label: "Campaigns",
          icon: RadioIcon,
          keywords: ["outreach", "dial", "broadcast"],
        },
        {
          href: "/campaigns/templates/cart-recovery",
          label: "Cart Recovery",
          icon: ShoppingCartIcon,
          keywords: ["abandoned", "checkout", "shopify", "whatsapp"],
        },
        {
          href: "/campaigns/templates/cod-confirmation",
          label: "COD Confirmation",
          icon: PackageCheckIcon,
          keywords: ["cash on delivery", "orders", "confirm"],
        },
      ],
    };
  }

  if (industry === "general") {
    return {
      label: "Outreach",
      items: [
        {
          href: "/campaigns",
          label: "Campaigns",
          icon: RadioIcon,
          keywords: ["outreach", "dial", "broadcast"],
        },
      ],
    };
  }

  // Default: Real Estate
  return {
    label: "Outreach",
    items: [
      {
        href: "/campaigns/templates/pre-sales",
        label: "Pre-Sales",
        icon: UserCheckIcon,
        keywords: ["site visit", "qualification", "booking", "inbound leads"],
      },
      {
        href: "/campaigns",
        label: "Reactivate",
        icon: RadioIcon,
        keywords: ["outreach", "dial", "broadcast", "campaigns", "cold leads", "reactivation"],
      },
      {
        href: "/campaigns/templates/tranche-recovery",
        label: "Tranche Recovery",
        icon: ReceiptIcon,
        keywords: ["milestones", "overdue", "installments", "collections", "payment", "post sales"],
      },
    ],
  };
}

/** Dynamic navigation builder based on the organisation's industry */
export function getNavSections(industry: OrganisationIndustry = "real_estate"): readonly NavSection[] {
  return [
    OVERVIEW_SECTION,
    LEADS_SECTION,
    getOutreachSection(industry),
    SYSTEM_SECTION,
  ];
}

/** Default fallback for backwards compatibility */
export const NAV_SECTIONS: readonly NavSection[] = getNavSections("real_estate");

/**
 * The admin console's nav.
 */
export const ADMIN_NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "Admin",
    items: [
      { href: "/admin", label: "Overview", icon: LayoutGridIcon },
      {
        href: "/admin/organisations",
        label: "Organisations",
        icon: Building2Icon,
      },
      { href: "/admin/users", label: "Users", icon: UsersIcon },
    ],
  },
];

/** Depth-first, parents before their children. */
export function flattenNav(
  sections: readonly NavSection[] = NAV_SECTIONS,
): NavItem[] {
  const out: NavItem[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      out.push(item);
      if (item.children) out.push(...item.children);
    }
  }
  return out;
}

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The one nav entry a path belongs to — longest match wins.
 */
export function activeNavHref(
  pathname: string,
  sections: readonly NavSection[] = NAV_SECTIONS,
): string | null {
  let best: string | null = null;
  for (const item of flattenNav(sections)) {
    if (!matches(pathname, item.href)) continue;
    if (best === null || item.href.length > best.length) best = item.href;
  }
  return best;
}

/** True only for the single deepest match — what a nav link highlights on. */
export function isNavActive(
  pathname: string,
  href: string,
  sections: readonly NavSection[] = NAV_SECTIONS,
): boolean {
  return activeNavHref(pathname, sections) === href;
}

/**
 * True for the item or any of its children.
 */
export function isNavBranchActive(
  pathname: string,
  item: NavItem,
  sections: readonly NavSection[] = NAV_SECTIONS,
): boolean {
  const active = activeNavHref(pathname, sections);
  if (active === null) return false;
  if (active === item.href) return true;
  return (item.children ?? []).some((child) => child.href === active);
}

export interface Crumb {
  label: string;
  href: string;
}

/**
 * The nav ancestry of a path, root-first.
 */
export function breadcrumbsFor(
  pathname: string,
  sections: readonly NavSection[] = NAV_SECTIONS,
): Crumb[] {
  const active = activeNavHref(pathname, sections);
  if (!active) return [];

  for (const section of sections) {
    for (const item of section.items) {
      if (item.href === active) return [{ label: item.label, href: item.href }];
      const child = (item.children ?? []).find((c) => c.href === active);
      if (child) {
        return [
          { label: item.label, href: item.href },
          { label: child.label, href: child.href },
        ];
      }
    }
  }
  return [];
}
