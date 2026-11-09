"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

export function ScannerOnlyGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isScanner = pathname === "/whatsapp-feature";

  React.useEffect(() => {
    if (!isScanner) router.replace("/whatsapp-feature");
  }, [isScanner, router]);

  if (!isScanner) {
    return <div className="min-h-screen" aria-busy="true" />;
  }

  return children;
}
