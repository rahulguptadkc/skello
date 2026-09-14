"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2Icon, Loader2Icon, ShoppingCartIcon } from "lucide-react";
import { toast } from "sonner";

import { updateOrganisationAdmin } from "@/actions/admin/organisations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Organisation, OrganisationIndustry } from "@/types/organisation";
import { cn } from "@/lib/utils";

interface Props {
  organisation: Organisation;
}

/**
 * Slug edits propagate to `leads.org_slug` via the FK's ON UPDATE CASCADE.
 * We render it read-only by default and let admins unlock it with an explicit
 * confirmation — renaming a slug affects every lead row under the org.
 */
export function OrgInfoForm({ organisation }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(organisation.name);
  const [slug, setSlug] = React.useState(organisation.slug);
  const [slugUnlocked, setSlugUnlocked] = React.useState(false);
  const [industry, setIndustry] = React.useState<OrganisationIndustry>(
    organisation.industry ?? "real_estate",
  );

  const initialIndustry = organisation.industry ?? "real_estate";
  const dirty =
    name.trim() !== organisation.name ||
    slug.trim() !== organisation.slug ||
    industry !== initialIndustry;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dirty) {
      toast.info("No changes to save");
      return;
    }
    const patch: {
      id: string;
      name?: string;
      slug?: string;
      industry?: OrganisationIndustry;
    } = {
      id: organisation.id,
    };
    if (name.trim() !== organisation.name) patch.name = name.trim();
    if (slug.trim() !== organisation.slug) patch.slug = slug.trim();
    if (industry !== initialIndustry) patch.industry = industry;

    startTransition(async () => {
      const result = await updateOrganisationAdmin(patch);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Organisation updated");
      setSlugUnlocked(false);
      router.refresh();
    });
  }

  function onUnlockSlug() {
    if (
      confirm(
        "Editing the slug renames the org's FK on every lead row. Continue?",
      )
    ) {
      setSlugUnlocked(true);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="admin-org-name">Name</Label>
        <Input
          id="admin-org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          maxLength={100}
          required
        />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="admin-org-slug">Slug</Label>
          {!slugUnlocked ? (
            <button
              type="button"
              onClick={onUnlockSlug}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              Edit slug
            </button>
          ) : null}
        </div>
        <Input
          id="admin-org-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          disabled={pending || !slugUnlocked}
          maxLength={63}
          pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
          required
        />
        <p className="text-[11px] text-muted-foreground">
          Lowercase, numbers, hyphens. Cascades to every lead row.
        </p>
      </div>

      {/* Business Type / Industry Selector */}
      <div className="grid gap-2">
        <Label className="text-sm font-medium">Business Type</Label>
        <p className="text-xs text-muted-foreground">
          Determines the available campaign templates and outreach workflows for this tenant.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setIndustry("real_estate")}
            disabled={pending}
            className={cn(
              "flex flex-col items-start rounded-xl border p-3.5 text-left transition-all",
              industry === "real_estate"
                ? "border-2 border-[#164e52] bg-primary/5 shadow-xs dark:border-teal-500"
                : "border-border/80 bg-background text-muted-foreground hover:border-border hover:bg-muted/30 hover:text-foreground",
            )}
          >
            <div className="flex items-center gap-2">
              <Building2Icon className={cn("size-4", industry === "real_estate" ? "text-[#164e52] dark:text-teal-400" : "text-muted-foreground")} />
              <span className={cn("text-sm font-semibold", industry === "real_estate" ? "text-foreground" : "text-muted-foreground")}>
                Real Estate
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Pre-sales, site visits & tranche recovery
            </p>
          </button>

          <button
            type="button"
            onClick={() => setIndustry("ecommerce")}
            disabled={pending}
            className={cn(
              "flex flex-col items-start rounded-xl border p-3.5 text-left transition-all",
              industry === "ecommerce"
                ? "border-2 border-[#164e52] bg-primary/5 shadow-xs dark:border-teal-500"
                : "border-border/80 bg-background text-muted-foreground hover:border-border hover:bg-muted/30 hover:text-foreground",
            )}
          >
            <div className="flex items-center gap-2">
              <ShoppingCartIcon className={cn("size-4", industry === "ecommerce" ? "text-[#164e52] dark:text-teal-400" : "text-muted-foreground")} />
              <span className={cn("text-sm font-semibold", industry === "ecommerce" ? "text-foreground" : "text-muted-foreground")}>
                E-Commerce
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Cart recovery, COD orders & Shopify
            </p>
          </button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? <Loader2Icon className="animate-spin" /> : null}
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
