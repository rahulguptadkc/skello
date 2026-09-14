"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CrownIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  ShieldCheckIcon,
  ShieldIcon,
  Trash2Icon,
  UserCheckIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import { removeTeamMember, updateTeamMemberRole } from "@/actions/team";
import {
  DataTableCard,
  DataTableHead,
} from "@/components/app/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelative } from "@/lib/format";
import type { OrgRole, TeamMemberRow } from "@/types/organisation";

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

export function TeamMembersTable({
  members,
  currentUserId,
  isAdmin,
}: {
  members: TeamMemberRow[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [memberToDelete, setMemberToDelete] = React.useState<{
    id: string;
    email: string;
  } | null>(null);

  function handleRoleChange(memberId: string, newRole: OrgRole) {
    setPendingId(memberId);
    React.startTransition(async () => {
      const result = await updateTeamMemberRole({ memberId, role: newRole });
      setPendingId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Role updated to ${newRole === "admin" ? "Admin" : "Team Member"}`);
      router.refresh();
    });
  }

  function handleConfirmRemove() {
    if (!memberToDelete) return;
    const { id: memberId, email } = memberToDelete;

    setPendingId(memberId);
    React.startTransition(async () => {
      const result = await removeTeamMember({ memberId });
      setPendingId(null);
      setMemberToDelete(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${email} was removed from the workspace`);
      router.refresh();
    });
  }

  if (members.length === 0) {
    return (
      <DataTableCard>
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <UsersIcon className="size-8 text-muted-foreground/60" />
          <p className="text-sm font-medium">No team members yet</p>
          <p className="text-xs text-muted-foreground">
            Invite your colleagues to collaborate in this workspace.
          </p>
        </div>
      </DataTableCard>
    );
  }

  return (
    <DataTableCard>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <DataTableHead>
            <th scope="col" className="px-4 py-3 font-medium">
              Member
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Role
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Added / Invited
            </th>
            {isAdmin ? (
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Actions
              </th>
            ) : null}
          </DataTableHead>
          <tbody className="divide-y divide-border/60">
            {members.map((member) => {
              const isCurrentUser = member.user_id === currentUserId;
              const isPending = pendingId === member.id;

              return (
                <tr
                  key={member.id}
                  className="transition-colors hover:bg-muted/40"
                >
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {initials(member.email)}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground truncate">
                            {member.display_name || member.email}
                          </span>
                          {isCurrentUser ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              You
                            </Badge>
                          ) : null}
                          {member.is_owner ? (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                              <CrownIcon className="size-2.5 text-amber-500" /> Owner
                            </Badge>
                          ) : null}
                        </div>
                        {member.display_name ? (
                          <span className="text-xs text-muted-foreground truncate">
                            {member.email}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3.5 whitespace-nowrap">
                    {member.role === "admin" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-purple-500/10 px-2.5 py-1 text-xs font-medium text-purple-700 dark:text-purple-300">
                        <ShieldIcon className="size-3" /> Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        <UserIcon className="size-3" /> Team Member
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3.5 whitespace-nowrap">
                    {member.status === "active" ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        <span className="size-1.5 rounded-full bg-emerald-500" /> Active
                      </span>
                    ) : member.status === "invited" ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
                        <span className="size-1.5 rounded-full bg-amber-500" /> Pending Invite
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                        <span className="size-1.5 rounded-full bg-muted-foreground" /> Suspended
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3.5 whitespace-nowrap text-xs text-muted-foreground">
                    {formatRelative(member.created_at)}
                  </td>

                  {isAdmin ? (
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      {member.is_owner ? (
                        <span className="text-xs text-muted-foreground/60 italic">Workspace Owner</span>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={isPending}
                                aria-label="Member actions"
                              />
                            }
                          >
                            {isPending ? (
                              <Loader2Icon className="size-4 animate-spin" />
                            ) : (
                              <MoreHorizontalIcon className="size-4" />
                            )}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {member.role === "member" ? (
                              <DropdownMenuItem
                                onClick={() => handleRoleChange(member.id, "admin")}
                              >
                                <ShieldCheckIcon /> Promote to Admin
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => handleRoleChange(member.id, "member")}
                              >
                                <UserCheckIcon /> Demote to Team Member
                              </DropdownMenuItem>
                            )}

                            <DropdownMenuSeparator />

                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() =>
                                setMemberToDelete({
                                  id: member.id,
                                  email: member.email,
                                })
                              }
                            >
                              <Trash2Icon /> Remove from Team
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Remove Member Confirmation Dialog */}
      <Dialog
        open={Boolean(memberToDelete)}
        onOpenChange={(open) => {
          if (!open && !pendingId) {
            setMemberToDelete(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove Team Member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{" "}
              <strong className="text-foreground font-semibold">
                {memberToDelete?.email}
              </strong>{" "}
              from this workspace? They will immediately lose access to all CRM
              leads, outreach calls, and workspace data.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" disabled={Boolean(pendingId)}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant="destructive"
              disabled={Boolean(pendingId)}
              onClick={handleConfirmRemove}
            >
              {pendingId ? (
                <>
                  <Loader2Icon className="animate-spin" /> Removing…
                </>
              ) : (
                "Remove Member"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DataTableCard>
  );
}
