import Link from "next/link";
import {
  GitForkIcon,
  PlusIcon,
} from "lucide-react";

import { listWorkflows } from "@/actions/workflows";
import { DataTableCard, DataTableHead } from "@/components/app/data-table";
import { CreateWorkflowDialog } from "@/components/app/workflows/create-workflow-dialog";
import { WorkflowRowActions } from "@/components/app/workflows/workflow-row-actions";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Workflows · Skelo" };

export default async function WorkflowsPage() {
  const session = await requireSession();
  const res = await listWorkflows(session.organisation.id);
  const workflows = res.success ? res.data : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Workflows
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Multi-agent ladders, call outcome decision trees, and automated retries.
          </p>
        </div>
        <CreateWorkflowDialog organisationId={session.organisation.id} />
      </div>

      {workflows.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border/80 bg-muted/20 py-12">
          <EmptyHeader>
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <GitForkIcon className="size-6" />
            </div>
            <EmptyTitle>No workflows configured</EmptyTitle>
            <EmptyDescription>
              Create your first multi-agent workflow to automate call outcome branching and retries.
            </EmptyDescription>
          </EmptyHeader>
          <div className="mt-2 flex justify-center">
            <CreateWorkflowDialog organisationId={session.organisation.id} />
          </div>
        </Empty>
      ) : (
        <DataTableCard>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <DataTableHead>
                <th className="px-5 py-3 font-medium">Workflow Name</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created At</th>
                <th className="px-4 py-3 font-medium">Last Updated</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </DataTableHead>
              <tbody className="divide-y divide-border/60">
                {workflows.map((wf) => (
                  <tr
                    key={wf.id}
                    className="group transition-colors hover:bg-muted/40"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/workflows/${wf.id}`}
                            className="font-semibold text-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                          >
                            {wf.name}
                          </Link>
                        </div>
                        {wf.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1 max-w-md">
                            {wf.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge
                        variant={wf.is_active ? "secondary" : "outline"}
                        className={
                          wf.is_active
                            ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[11px]"
                            : "text-[11px]"
                        }
                      >
                        {wf.is_active ? "Active" : "Draft"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(wf.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(wf.updated_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <WorkflowRowActions
                        workflow={wf}
                        organisationId={session.organisation.id}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataTableCard>
      )}
    </div>
  );
}
