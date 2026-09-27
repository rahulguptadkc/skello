"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2Icon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { deleteWorkflow } from "@/actions/workflows";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Workflow } from "@/types/workflow";

export function WorkflowRowActions({
  workflow,
  organisationId,
}: {
  workflow: Workflow;
  organisationId: string;
}) {
  const router = useRouter();

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [isDeleting, startDeleting] = React.useTransition();

  function handleDelete() {
    startDeleting(async () => {
      const res = await deleteWorkflow(workflow.id);
      if (!res.success) {
        toast.error("Failed to delete workflow", { description: res.error });
        return;
      }

      toast.success("Workflow deleted");
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8 text-xs font-medium"
          render={<Link href={`/workflows/${workflow.id}`} />}
        >
          <PencilIcon className="size-3.5" />
          Edit
        </Button>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setDeleteOpen(true)}
          className="size-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          aria-label="Delete workflow"
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2Icon className="size-4" />
              Delete Workflow
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong className="text-foreground font-semibold">"{workflow.name}"</strong>? This will
              remove all configured multi-agent retry branches and routing ladder rules.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
              className="gap-1.5"
            >
              {isDeleting && <Loader2Icon className="size-4 animate-spin" />}
              Delete Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
