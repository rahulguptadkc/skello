import { ShieldIcon, UserCheckIcon, UsersIcon } from "lucide-react";

import { listTeamMembers } from "@/actions/team";
import { ErrorCard } from "@/components/app/error-card";
import { SettingsNavTabs } from "@/components/app/settings/settings-nav-tabs";
import { StatCard } from "@/components/app/stat-card";
import { InviteMemberDialog } from "@/components/app/team/invite-member-dialog";
import { TeamMembersTable } from "@/components/app/team/team-members-table";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Manage Team · Settings · Skelo" };

export default async function ManageTeamPage() {
  const session = await requireSession();
  const result = await listTeamMembers();

  if (!result.success) {
    return (
      <div className="flex flex-col gap-6">
        <header className="space-y-1.5">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Settings
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Manage your workspace, team, and account.
          </p>
        </header>
        <SettingsNavTabs />
        <ErrorCard>{result.error}</ErrorCard>
      </div>
    );
  }

  const members = result.data;
  const isAdmin =
    session.role === "admin" || session.organisation.owner_id === session.userId;

  const adminCount = members.filter((m) => m.role === "admin").length;
  const teamMemberCount = members.filter((m) => m.role === "member").length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Settings
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Manage your workspace, team members, and account.
          </p>
        </div>
        {isAdmin ? <InviteMemberDialog /> : null}
      </header>

      <SettingsNavTabs memberCount={members.length} />

      {/* KPI Stats */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Members"
          value={String(members.length)}
          icon={<UsersIcon />}
          hint="In this workspace"
        />
        <StatCard
          label="Admins"
          value={String(adminCount)}
          icon={<ShieldIcon />}
          hint="Full management access"
        />
        <StatCard
          label="Team Members"
          value={String(teamMemberCount)}
          icon={<UserCheckIcon />}
          hint="CRM & outreach access"
        />
      </section>

      {/* Team Roster Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold leading-tight">
              Team Roster
            </h2>
            <p className="text-xs text-muted-foreground">
              {isAdmin
                ? "Admins can invite new members, change roles, or remove members."
                : "You have standard Team Member access to this workspace."}
            </p>
          </div>
        </div>

        <TeamMembersTable
          members={members}
          currentUserId={session.userId}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  );
}
