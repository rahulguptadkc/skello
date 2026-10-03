"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CrownIcon,
  Loader2Icon,
  ShieldCheckIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  inviteTeamMemberAdmin,
  removeTeamMemberAdmin,
} from "@/actions/admin/organisations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRelative } from "@/lib/format";
import type { TeamMemberRow } from "@/types/organisation";

interface Props {
  organisationId: string;
  members: TeamMemberRow[];
}

export function OrgTeamCard({ organisationId, members }: Props) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<"admin" | "member">("member");
  const [pending, startTransition] = React.useTransition();
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    startTransition(async () => {
      const res = await inviteTeamMemberAdmin({
        organisationId,
        email: email.trim(),
        role,
      });

      if (!res.success) {
        toast.error(res.error);
        return;
      }

      toast.success(
        res.data.temporaryPassword
          ? `Added ${email}! Login credentials emailed to them.`
          : `Added ${email} to the workspace!`,
      );
      setEmail("");
      setInviteOpen(false);
      router.refresh();
    });
  }

  function handleRemove(member: TeamMemberRow) {
    if (
      !confirm(
        `Remove ${member.email} from this organisation?`,
      )
    ) {
      return;
    }

    setRemovingId(member.id);
    startTransition(async () => {
      const res = await removeTeamMemberAdmin({
        organisationId,
        memberId: member.id,
      });

      if (!res.success) {
        toast.error(res.error);
      } else {
        toast.success(`Removed ${member.email}`);
        router.refresh();
      }
      setRemovingId(null);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <UsersIcon className="size-4 text-muted-foreground" />
            <CardTitle>Team &amp; Members</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground">
            {members.length} {members.length === 1 ? "member" : "members"} in this organisation
          </p>
        </div>

        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger
            render={
              <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                <UserPlusIcon className="size-3.5" /> Add member
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md">
            <form onSubmit={handleInvite}>
              <DialogHeader>
                <DialogTitle>Add team member</DialogTitle>
                <DialogDescription>
                  Invite a user to this workspace as an Admin or Member.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="admin-member-email">Email address</Label>
                  <Input
                    id="admin-member-email"
                    type="email"
                    placeholder="teammate@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={pending}
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label>Role</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole("member")}
                      disabled={pending}
                      className={`flex flex-col items-start rounded-lg border p-2.5 text-left text-xs transition-colors ${
                        role === "member"
                          ? "border-primary bg-primary/5 font-medium"
                          : "border-border/70 hover:bg-muted/30 text-muted-foreground"
                      }`}
                    >
                      <span className="font-semibold text-foreground">Member</span>
                      <span className="text-[11px] text-muted-foreground">Standard access</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setRole("admin")}
                      disabled={pending}
                      className={`flex flex-col items-start rounded-lg border p-2.5 text-left text-xs transition-colors ${
                        role === "admin"
                          ? "border-primary bg-primary/5 font-medium"
                          : "border-border/70 hover:bg-muted/30 text-muted-foreground"
                      }`}
                    >
                      <span className="font-semibold text-foreground">Admin</span>
                      <span className="text-[11px] text-muted-foreground">Full workspace control</span>
                    </button>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <DialogClose
                  render={
                    <Button type="button" variant="ghost" disabled={pending}>
                      Cancel
                    </Button>
                  }
                />
                <Button type="submit" disabled={pending || !email.trim()}>
                  {pending ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                  {pending ? "Adding…" : "Add member"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-y border-border/60 bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 font-medium">User</th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Joined</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {members.map((m) => (
                <tr key={m.id} className="transition-colors hover:bg-muted/20">
                  <td className="px-5 py-3">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        {m.email}
                        {m.is_owner ? (
                          <span
                            title="Workspace Primary Owner"
                            className="inline-flex items-center gap-0.5 rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
                          >
                            <CrownIcon className="size-3" /> Owner
                          </span>
                        ) : null}
                      </div>
                      {m.display_name ? (
                        <span className="text-[11px] text-muted-foreground">
                          {m.display_name}
                        </span>
                      ) : null}
                    </div>
                  </td>

                  <td className="px-3 py-3">
                    {m.role === "admin" ? (
                      <Badge variant="default" className="gap-1 text-[11px] font-normal">
                        <ShieldCheckIcon className="size-3" /> Admin
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[11px] font-normal">
                        Member
                      </Badge>
                    )}
                  </td>

                  <td className="px-3 py-3">
                    {m.status === "active" ? (
                      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        Invited
                      </Badge>
                    )}
                  </td>

                  <td className="px-3 py-3 text-muted-foreground">
                    {m.created_at ? formatRelative(m.created_at) : "—"}
                  </td>

                  <td className="px-4 py-3 text-right">
                    {!m.is_owner ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        disabled={pending || removingId === m.id}
                        onClick={() => handleRemove(m)}
                        title="Remove member"
                      >
                        {removingId === m.id ? (
                          <Loader2Icon className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2Icon className="size-3.5" />
                        )}
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
