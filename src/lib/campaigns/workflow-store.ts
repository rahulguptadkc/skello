import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { OutcomeRule, Workflow } from "@/types/workflow";

// In-memory workspace cache fallback ensuring zero-downtime if migrations are running.
// Lives here (not in actions/workflows.ts) because "use server" files may only
// export async functions — exporting a Map object causes a Next.js build error.
export const workflowStore = new Map<string, Workflow>();

export async function getWorkflowRulesForOrg(
  organisationId: string,
  workflowId?: string | null,
): Promise<OutcomeRule[] | null> {
  if (!workflowId) {
    return null;
  }

  const admin = createAdminClient();

  const mem = workflowStore.get(workflowId);
  if (mem?.rules && mem.rules.length > 0) {
    return mem.rules;
  }

  try {
    const { data: wf } = await admin
      .from("workflows")
      .select("rules")
      .eq("id", workflowId)
      .maybeSingle<{ rules: OutcomeRule[] }>();
    if (wf?.rules && Array.isArray(wf.rules) && wf.rules.length > 0) {
      return wf.rules;
    }
  } catch {
    // ignore
  }

  return null;
}
