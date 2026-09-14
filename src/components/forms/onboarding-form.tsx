"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { createOrganisation } from "@/actions/organisations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function OnboardingForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;

    startTransition(async () => {
      const result = await createOrganisation({
        name,
        slug: `${slugify(name) || "workspace"}-${Date.now().toString(36).slice(-6)}`,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Workspace created");
      router.replace("/dashboard");
    });
  }

  return (
    <form action={onSubmit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          placeholder="Acme Inc."
          required
          maxLength={100}
          disabled={pending}
        />
      </div>

      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? <Loader2Icon className="animate-spin" /> : null}
        {pending ? "Creating workspace…" : "Create workspace"}
      </Button>
    </form>
  );
}
