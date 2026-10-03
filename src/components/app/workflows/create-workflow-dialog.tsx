"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { GitForkIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { createWorkflow } from "@/actions/workflows";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CreateWorkflowDialog({ organisationId }: { organisationId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a workflow name");
      return;
    }

    startTransition(async () => {
      const res = await createWorkflow(
        organisationId,
        name.trim(),
        description.trim() || undefined,
      );
      if (!res.success) {
        toast.error("Failed to create workflow", { description: res.error });
        return;
      }

      toast.success("Custom workflow created");
      setOpen(false);
      setName("");
      setDescription("");
      router.push(`/workflows/${res.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-1.5" size="sm" />}>
        <PlusIcon className="size-4" /> New Workflow
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitForkIcon className="size-5 text-emerald-500" />
              Create Custom Workflow
            </DialogTitle>
            <DialogDescription>
              Configure custom call outcome variables, multi-agent retries, and actions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">Workflow Name</Label>
              <Input
                id="wf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Loan lead qualification"
                required
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wf-desc">Description (Optional)</Label>
              <Textarea
                id="wf-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief summary of the target campaign or routing objective..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="gap-1.5">
              {isPending && <Loader2Icon className="size-4 animate-spin" />}
              Create & Configure
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
