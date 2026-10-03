import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envFile = existsSync(".env.local") ? ".env.local" : existsSync(".env") ? ".env" : null;
if (envFile) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function check() {
  const { data: wf, error: wfErr } = await admin.from("workflows").select("*").limit(5);
  console.log("workflows table:", { count: wf?.length, error: wfErr?.message, sample: wf?.[0] });

  const { data: camps, error: campErr } = await admin
    .from("campaigns")
    .select("id, name, status, workflow_id, workflow_name, max_attempts, max_connected_attempts, retry_interval_seconds, created_at")
    .order("created_at", { ascending: false })
    .limit(3);
  console.log("recent campaigns:", { error: campErr?.message, camps });

  if (camps && camps[0]) {
    const { data: contacts, error: contErr } = await admin
      .from("campaign_contacts")
      .select("id, name, phone, status, attempt, connected_count, last_outcome, last_error, metadata")
      .eq("campaign_id", camps[0].id);
    console.log("contacts for campaign " + camps[0].id + ":", { error: contErr?.message, contacts });

    const { data: calls, error: callErr } = await admin
      .from("calls")
      .select("id, status, call_outcome, lead_intent_extracted, interest, customer_status, lead_data, created_at")
      .eq("campaign_contact_id", contacts?.[0]?.id ?? "");
    console.log("calls for contact:", { error: callErr?.message, calls });
  }
}

check().catch(console.error);
