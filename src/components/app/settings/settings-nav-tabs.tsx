"use client";

import { usePathname } from "next/navigation";
import { Building2Icon, UploadCloudIcon, UsersIcon } from "lucide-react";

import { NavTabs } from "@/components/app/nav-tabs";

export function SettingsNavTabs({ memberCount }: { memberCount?: number }) {
  const pathname = usePathname();

  const tabs = [
    {
      href: "/settings",
      label: "Workspace",
      icon: <Building2Icon />,
      active: pathname === "/settings",
    },
    {
      href: "/settings/team",
      label: "Manage Team",
      icon: <UsersIcon />,
      active: pathname.startsWith("/settings/team"),
      count: memberCount,
    },
    {
      href: "/settings/import-calls",
      label: "Data Import",
      icon: <UploadCloudIcon />,
      active: pathname.startsWith("/settings/import-calls"),
    },
  ];

  return <NavTabs items={tabs} aria-label="Settings navigation" className="mb-2" />;
}
