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
  tone = "default",
}: LogoProps) {
  const sidebarTone = tone === "sidebar";

  const inner = (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
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
        <span className="font-heading text-[16px] font-bold tracking-tight text-white">
          SKELO
        </span>
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

