"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";

import { inviteTeamMember } from "@/actions/team";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrgRole } from "@/types/organisation";

export function InviteMemberDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [role, setRole] = React.useState<OrgRole>("member");
  const [email, setEmail] = React.useState("");

  function resetForm() {
    setEmail("");
    setRole("member");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      toast.error("Please enter an email address");
      return;
    }

    startTransition(async () => {
      const result = await inviteTeamMember({ email: cleanEmail, role });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(
        result.data.temporaryPassword
          ? `Added ${cleanEmail}! Login credentials emailed to them.`
          : `Added ${cleanEmail} to the workspace!`,
      );
      resetForm();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm">
            <UserPlusIcon /> Add Team Member
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
            <DialogDescription>
              Onboard a new member to your organisation workspace and set their access role.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="member-email">Email address</Label>
              <Input
                id="member-email"
                type="email"
                placeholder="colleague@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
                disabled={pending}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="member-role">Role</Label>
              <Select
                value={role}
                onValueChange={(val) => setRole(val as OrgRole)}
                disabled={pending}
              >
                <SelectTrigger id="member-role" className="w-full">
                  <SelectValue>
                    {role === "admin" ? "Admin" : "Team Member"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member" label="Team Member">
                    <div className="flex flex-col text-left py-0.5">
                      <span className="font-medium text-foreground">Team Member</span>
                      <span className="text-xs text-muted-foreground whitespace-normal">
                        Can access CRM leads, calls, conversations & outreach
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin" label="Admin">
                    <div className="flex flex-col text-left py-0.5">
                      <span className="font-medium text-foreground">Admin</span>
                      <span className="text-xs text-muted-foreground whitespace-normal">
                        Full workspace rights: manage team, settings & integrations
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending}>Cancel</Button>} />
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2Icon className="animate-spin" /> Adding…
                </>
              ) : (
                "Add Member"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
