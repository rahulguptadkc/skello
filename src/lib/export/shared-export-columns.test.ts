import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import {
  buildCallExportCsvColumns,
  buildLeadExportCsvColumns,
  type ExtractionFieldDef,
  type UnifiedCallRecord,
  type UnifiedLeadRecord,
} from "./shared-export-columns";
import { toCsv } from "@/lib/csv";

describe("shared-export-columns", () => {
  const mockExtractions: ExtractionFieldDef[] = [
    {
      header: "Interest",
      source_column: "custom_data",
      category: "",
      key_path: "Interest",
    },
    {
      header: "Call Back Time",
      source_column: "custom_data",
      category: "",
      key_path: "call_back_time",
    },
    {
      header: "Budget",
      source_column: "lead_data",
      category: "",
      key_path: "budget",
    },
  ];

  it("builds call export columns matching the requested static specification", () => {
    const cols = buildCallExportCsvColumns(mockExtractions);
    const headers = cols.map((c) => c.header);

    expect(headers).toEqual([
      "Call ID",
      "To Number",
      "From Number",
      "Date & Time",
      "Duration (sec)",
      "Direction",
      "Outcome",
      "Disposition",
      "Interest",
      "Call Back Time",
      "Budget",
      "Agent",
      "Summary",
      "Transcript",
    ]);

    const call: UnifiedCallRecord = {
      id: "call-123",
      direction: "outbound",
      status: "completed",
      agent_id: "agent-1",
      agent_label: "HDFC Bot",
      to_phone: "+919999999999",
      from_phone: "+918888888888",
      started_at: "2026-10-01T10:00:00Z",
      duration_seconds: 45,
      summary: "Customer was interested in a loan",
      transcript: "assistant: Hello\nuser: Hi",
      call_outcome: "interested",
      custom_data: {
        "": {
          Interest: "Yes",
          call_back_time: "Tomorrow 2pm",
        },
      },
      lead_data: {
        budget: "5 Lakhs",
      },
    };

    const csv = toCsv([call], cols);
    const parsed = Papa.parse<string[]>(csv.trim());
    expect(parsed.data[0]).toEqual([
      "Call ID",
      "To Number",
      "From Number",
      "Date & Time",
      "Duration (sec)",
      "Direction",
      "Outcome",
      "Disposition",
      "Interest",
      "Call Back Time",
      "Budget",
      "Agent",
      "Summary",
      "Transcript",
    ]);
    const row = parsed.data[1];
    expect(row[0]).toBe("call-123");
    expect(row[1]).toContain("+919999999999");
    expect(row[2]).toContain("+918888888888");
    expect(row[6]).toBe("Completed");
    expect(row[7]).toBe("interested");
    expect(row[8]).toBe("Yes");
    expect(row[9]).toBe("Tomorrow 2pm");
    expect(row[10]).toBe("5 Lakhs");
    expect(row[11]).toBe("HDFC Bot");
  });

  it("builds lead export columns matching the requested static specification", () => {
    const cols = buildLeadExportCsvColumns(mockExtractions);
    const headers = cols.map((c) => c.header);

    expect(headers).toEqual([
      "Call ID",
      "To Number",
      "From Number",
      "Date & Time",
      "Duration (sec)",
      "Direction",
      "Outcome",
      "Disposition",
      "Interest",
      "Call Back Time",
      "Budget",
      "Agent",
      "Summary",
      "Transcript",
    ]);

    const leadWithCall: UnifiedLeadRecord = {
      id: "lead-1",
      created_at: "2026-09-30T10:00:00Z",
      phone: "+919999999999",
      name: "Kartik",
      status: "contacted",
      current_intent: "hot",
      notes: "Lead note",
      lead_data: {},
      custom_data: {},
      latestCall: {
        id: "call-999",
        direction: "outbound",
        status: "completed",
        agent_label: "Sales Agent",
        to_phone: "+919999999999",
        from_phone: "+918888888888",
        started_at: "2026-10-01T12:00:00Z",
        duration_seconds: 60,
        call_outcome: "positive",
        summary: "Agreed to visit branch",
        transcript: "assistant: Hello\nuser: Hi",
        custom_data: {
          "": {
            Interest: "Yes",
            call_back_time: "Today 5pm",
          },
        },
        lead_data: {
          budget: "10 Lakhs",
        },
      },
    };

    const leadWithoutCall: UnifiedLeadRecord = {
      id: "lead-2",
      created_at: "2026-10-01T08:00:00Z",
      phone: "+917777777777",
      name: "Rahul",
      status: "new",
      current_intent: "cold",
      notes: "Newly uploaded lead",
      lead_data: {
        budget: "2 Lakhs",
      },
      custom_data: {
        "": {
          Interest: "No",
        },
      },
      latestCall: null,
    };

    const csv = toCsv([leadWithCall, leadWithoutCall], cols);
    const parsed = Papa.parse<string[]>(csv.trim());
    expect(parsed.data.length).toBe(3);

    // Lead with call has call details
    const row1 = parsed.data[1];
    expect(row1[0]).toBe("call-999");
    expect(row1[1]).toContain("+919999999999");
    expect(row1[6]).toBe("Completed");
    expect(row1[7]).toBe("positive");
    expect(row1[8]).toBe("Yes");
    expect(row1[9]).toBe("Today 5pm");
    expect(row1[10]).toBe("10 Lakhs");
    expect(row1[11]).toBe("Sales Agent");
    expect(row1[12]).toBe("Agreed to visit branch");

    // Lead without call falls back gracefully
    const row2 = parsed.data[2];
    expect(row2[0]).toBe("");
    expect(row2[1]).toContain("+917777777777");
    expect(row2[2]).toBe("");
    expect(row2[6]).toBe("New");
    expect(row2[7]).toBe("Cold");
    expect(row2[8]).toBe("No");
    expect(row2[10]).toBe("2 Lakhs");
    expect(row2[11]).toBe("");
    expect(row2[12]).toBe("Newly uploaded lead");
  });

  it("coalesces multi-source interest extractions and cleans :null placeholders", () => {
    const mergedInterestExt: ExtractionFieldDef = {
      header: "Interest",
      source_column: "lead_data",
      category: "",
      key_path: "interest",
      sources: [
        { source_column: "lead_data", category: "", key_path: "interest" },
        { source_column: "custom_data", category: "", key_path: "Interest" },
      ],
    };
    const callbackExt: ExtractionFieldDef = {
      header: "Call Back Time",
      source_column: "custom_data",
      category: "",
      key_path: "call_back_time",
    };

    const cols = buildCallExportCsvColumns([mergedInterestExt, callbackExt]);
    const headers = cols.map((c) => c.header);

    // Verify there is only ONE Interest column, never "Interest (2)"
    expect(headers).not.toContain("Interest (2)");
    expect(headers.filter((h) => h === "Interest").length).toBe(1);

    // Row 1: interest from lead_data
    const call1: UnifiedCallRecord = {
      id: "call-1",
      lead_data: { interest: "Yes_Maybe" },
      custom_data: { "": { call_back_time: ":null" } },
    };

    // Row 2: interest from custom_data
    const call2: UnifiedCallRecord = {
      id: "call-2",
      lead_data: {},
      custom_data: { "": { Interest: "No", call_back_time: "Tomorrow 10am" } },
    };

    // Row 3: interest from dedicated column
    const call3: UnifiedCallRecord = {
      id: "call-3",
      interest: "No_contact",
      lead_data: {},
      custom_data: null,
    };

    const csv = toCsv([call1, call2, call3], cols);
    const parsed = Papa.parse<string[]>(csv.trim());

    const r1 = parsed.data[1];
    expect(r1[8]).toBe("Yes_Maybe"); // Interest
    expect(r1[9]).toBe(""); // call_back_time ":null" cleaned to empty

    const r2 = parsed.data[2];
    expect(r2[8]).toBe("No"); // Interest
    expect(r2[9]).toBe("Tomorrow 10am");

    const r3 = parsed.data[3];
    expect(r3[8]).toBe("No_contact"); // Interest
  });
});

