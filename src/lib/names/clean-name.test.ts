import { describe, expect, it } from "vitest";
import { cleanCustomerName, cleanNamesBatch, toTitleCase } from "./clean-name";

describe("cleanCustomerName", () => {
  it("strips trailing and leading single/two-letter initials (e.g., 'TEJESH C S' -> 'Tejesh')", () => {
    expect(cleanCustomerName("TEJESH C S")).toBe("Tejesh");
    expect(cleanCustomerName("Tejesh C S")).toBe("Tejesh");
    expect(cleanCustomerName("Tejesh CS")).toBe("Tejesh");
    expect(cleanCustomerName("Tejesh C.S.")).toBe("Tejesh");
    expect(cleanCustomerName("C S Tejesh")).toBe("Tejesh");
    expect(cleanCustomerName("K Suresh Kumar")).toBe("Suresh Kumar");
    expect(cleanCustomerName("Suresh Kumar K S")).toBe("Suresh Kumar");
    expect(cleanCustomerName("Priya M")).toBe("Priya");
    expect(cleanCustomerName("Vignesh R.")).toBe("Vignesh");
  });

  it("cleans stray single-letter voice AI prefixes (e.g., 't Raina Dwivedi')", () => {
    expect(cleanCustomerName("t Raina Dwivedi")).toBe("Raina Dwivedi");
    expect(cleanCustomerName("d Suresh Kumar")).toBe("Suresh Kumar");
    expect(cleanCustomerName("x Priya Sharma")).toBe("Priya Sharma");
    expect(cleanCustomerName("t raina dwivedi")).toBe("Raina Dwivedi");
  });

  it("cleans STT filler words and conversational lead-ins", () => {
    expect(cleanCustomerName("My name is Rohan Gupta")).toBe("Rohan Gupta");
    expect(cleanCustomerName("this is Priya Sharma")).toBe("Priya Sharma");
    expect(cleanCustomerName("Speaking with Amit Verma")).toBe("Amit Verma");
    expect(cleanCustomerName("uh Karan Singh")).toBe("Karan Singh");
    expect(cleanCustomerName("um Deepak Sharma")).toBe("Deepak Sharma");
    expect(cleanCustomerName("the Vikram Patel")).toBe("Vikram Patel");
  });

  it("strips salutations and honorifics (Mr., Dr., Shri, Smt, etc.)", () => {
    expect(cleanCustomerName("mr. suresh kumar")).toBe("Suresh Kumar");
    expect(cleanCustomerName("Mr Suresh Kumar")).toBe("Suresh Kumar");
    expect(cleanCustomerName("DR. PRIYA SHARMA")).toBe("Priya Sharma");
    expect(cleanCustomerName("Shri Rajesh Patel")).toBe("Rajesh Patel");
    expect(cleanCustomerName("Smt. Sunita Rao")).toBe("Sunita Rao");
    expect(cleanCustomerName("Er. Nitin Gadkari")).toBe("Nitin Gadkari");
    expect(cleanCustomerName("Advocate Rahul Roy")).toBe("Rahul Roy");
  });

  it("removes list numbering, trailing numbers, and phone numbers", () => {
    expect(cleanCustomerName("1. Amit Kumar")).toBe("Amit Kumar");
    expect(cleanCustomerName("1 - Amit Kumar")).toBe("Amit Kumar");
    expect(cleanCustomerName("Amit Kumar 9876543210")).toBe("Amit Kumar");
    expect(cleanCustomerName("Amit Kumar +919876543210")).toBe("Amit Kumar");
    expect(cleanCustomerName("Raina 123")).toBe("Raina");
  });

  it("strips trailing bracket annotations and separators", () => {
    expect(cleanCustomerName("Raina Dwivedi (Shop)")).toBe("Raina Dwivedi");
    expect(cleanCustomerName("Raina Dwivedi [Lead]")).toBe("Raina Dwivedi");
    expect(cleanCustomerName("Raina Dwivedi - Customer")).toBe("Raina Dwivedi");
    expect(cleanCustomerName("Raina Dwivedi | Delhi")).toBe("Raina Dwivedi");
  });

  it("removes emojis, symbols, and extra whitespace", () => {
    expect(cleanCustomerName("👋 Vikram Malhotra 🔥")).toBe("Vikram Malhotra");
    expect(cleanCustomerName('  "Raina   Dwivedi"  ')).toBe("Raina Dwivedi");
    expect(cleanCustomerName("  ,Raina Dwivedi.  ")).toBe("Raina Dwivedi");
  });

  it("normalizes casing to Title Case for multi-word full names", () => {
    expect(cleanCustomerName("DEENA RODRIGUES")).toBe("Deena Rodrigues");
    expect(cleanCustomerName("DEVAGAM SANDEEP")).toBe("Devagam Sandeep");
    expect(cleanCustomerName("KIRAN MATTUR")).toBe("Kiran Mattur");
    expect(cleanCustomerName("MALLAVARAPPU VIJAYA KRISHNA")).toBe("Mallavarappu Vijaya Krishna");
    expect(cleanCustomerName("RAINA DWIVEDI")).toBe("Raina Dwivedi");
    expect(cleanCustomerName("raina dwivedi")).toBe("Raina Dwivedi");
    expect(cleanCustomerName("rAiNa DwIvEdI")).toBe("Raina Dwivedi");
  });

  it("discards dummy, test, and placeholder names", () => {
    expect(cleanCustomerName("test")).toBeNull();
    expect(cleanCustomerName("TEST USER")).toBeNull();
    expect(cleanCustomerName("dummy")).toBeNull();
    expect(cleanCustomerName("null")).toBeNull();
    expect(cleanCustomerName("undefined")).toBeNull();
    expect(cleanCustomerName("n/a")).toBeNull();
    expect(cleanCustomerName("NA")).toBeNull();
    expect(cleanCustomerName("none")).toBeNull();
    expect(cleanCustomerName("unknown")).toBeNull();
    expect(cleanCustomerName("customer")).toBeNull();
    expect(cleanCustomerName("12345")).toBeNull();
    expect(cleanCustomerName("---")).toBeNull();
    expect(cleanCustomerName("")).toBeNull();
    expect(cleanCustomerName(null)).toBeNull();
    expect(cleanCustomerName(undefined)).toBeNull();
  });

  it("preserves already Devanagari script names", () => {
    expect(cleanCustomerName("रैना द्विवेदी")).toBe("रैना द्विवेदी");
    expect(cleanCustomerName("करण सिंह")).toBe("करण सिंह");
  });

  it("batches cleans an array of names", () => {
    const raw = ["TEJESH C S", "t Raina Dwivedi", "mr. suresh", "test", null, "PRIYA M"];
    const cleaned = cleanNamesBatch(raw);
    expect(cleaned).toEqual(["Tejesh", "Raina Dwivedi", "Suresh", null, null, "Priya"]);
  });
});
