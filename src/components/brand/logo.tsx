import Link from "next/link";

import { cn } from "@/lib/utils";
import type { OrganisationIndustry } from "@/types/organisation";

interface LogoProps {
  href?: string;
  className?: string;
  showWordmark?: boolean;
  industry?: OrganisationIndustry;
  showSubtitle?: boolean;
  // The sidebar is deep teal in BOTH themes, so `bg-primary` (also teal) would
  // sit almost invisibly on it. The sidebar tone inverts the mark instead —
  // white tile, teal letter — which is also how the reference brand renders it.
  tone?: "default" | "sidebar";
}

export function Logo({
  href = "/",
  className,
  showWordmark = true,
  industry,
  showSubtitle = false,
  tone = "default",
}: LogoProps) {
  const sidebarTone = tone === "sidebar";

  const industryTag =
    industry === "ecommerce"
      ? "Ecom"
      : industry === "real_estate"
      ? "Estate"
      : null;

  const subtitle =
    industry === "ecommerce"
      ? "Voice AI for e-commerce sales"
      : industry === "real_estate"
      ? "Voice AI for real estate sales"
      : null;

  const inner = (
    <div className={cn("inline-flex flex-col gap-1", className)}>
      <div className="inline-flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "relative grid size-7 place-items-center rounded-lg shadow-xs",
            sidebarTone
              ? "bg-white text-[#164e52]"
              : "bg-primary text-primary-foreground",
          )}
        >
          {sidebarTone ? null : (
            <span className="absolute inset-0 rounded-lg bg-linear-to-br from-primary to-primary/70" />
          )}
          <span className="relative font-heading text-[14px] font-bold leading-none lowercase">
            s
          </span>
        </span>
        {showWordmark ? (
          <div className="flex items-center gap-1.5 font-heading text-[16px] font-bold tracking-tight text-white">
            <span>SKELO</span>
            {industryTag ? (
              <span className="font-bold text-white">{industryTag}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      {showSubtitle && subtitle && showWordmark ? (
        <p className="text-[11px] leading-tight text-sidebar-muted-foreground">
          {subtitle}
        </p>
      ) : null}
    </div>
  );

  if (!href) return inner;
  return (
    <Link href={href} className="inline-block transition-opacity hover:opacity-90">
      {inner}
    </Link>
  );
}

