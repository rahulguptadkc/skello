import { describe, expect, it } from "vitest";
import { parseCampaignCsv } from "./csv-parse";

describe("parseCampaignCsv", () => {
  it("cleans customer names into Devanagari by default", async () => {
    const csv =
      "phone,customer_name\n" +
      "+919876543210,Karthik Sharma\n" +
      "+919876543211,Raina Dwivedi\n";
    const parsed = await parseCampaignCsv(csv);

    expect(parsed.valid_rows).toBe(2);
    expect(parsed.blank_name_rows).toBe(0);
    expect(parsed.contacts[0].name).toBe("कार्तिक");
    expect(parsed.contacts[0].name_error).toBeNull();
    expect(parsed.contacts[1].name).toBe("रैना");
    expect(parsed.contacts[1].name_error).toBeNull();
  });

  it("detects blank AI name after cleaning and sets error", async () => {
    const csv =
      "phone,name\n" +
      "+919876543210,Dr.\n" + // Stripped to empty
      "+919876543211,\n" +    // Blank in sheet
      "+919876543212,R T\n" + // Single letters / initials only -> stripped to empty
      "+919876543213,Suresh Kumar\n"; // Valid name -> सुरेश
    const parsed = await parseCampaignCsv(csv);

    expect(parsed.valid_rows).toBe(4);
    expect(parsed.blank_name_rows).toBe(3);

    expect(parsed.contacts[0].name).toBeNull();
    expect(parsed.contacts[0].name_error).toContain("नाम खाली है");
    expect(parsed.contacts[0].name_error).toContain("कृपया शीट में मैन्युअल रूप से नाम अपडेट करें");

    expect(parsed.contacts[1].name).toBeNull();
    expect(parsed.contacts[1].name_error).toContain("नाम खाली है");

    expect(parsed.contacts[2].name).toBeNull();
    expect(parsed.contacts[2].raw_name).toBe("R T");
    expect(parsed.contacts[2].name_error).toContain("नाम खाली है");

    expect(parsed.contacts[3].name).toBe("सुरेश");
    expect(parsed.contacts[3].name_error).toBeNull();
  });

  it("does not report blank name error if no name column exists", async () => {
    const csv = "phone\n+919876543210\n+919876543211\n";
    const parsed = await parseCampaignCsv(csv);

    expect(parsed.valid_rows).toBe(2);
    expect(parsed.name_column).toBeNull();
    expect(parsed.blank_name_rows).toBe(0);
    expect(parsed.contacts[0].name_error).toBeNull();
  });
});
