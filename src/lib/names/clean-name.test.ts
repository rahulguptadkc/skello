import { describe, expect, it } from "vitest";
import { cleanCustomerName, cleanNamesBatch, toTitleCase } from "./clean-name";

describe("cleanCustomerName", () => {
  it("extracts first name from full names by default (e.g. 'Raina Dwivedi' -> 'Raina')", () => {
    expect(cleanCustomerName("Raina Dwivedi")).toBe("Raina");
    expect(cleanCustomerName("t Raina Dwivedi")).toBe("Raina");
    expect(cleanCustomerName("Suresh Kumar")).toBe("Suresh");
    expect(cleanCustomerName("Amit Kumar Sharma")).toBe("Amit");
    expect(cleanCustomerName("DEENA RODRIGUES")).toBe("Deena");
    expect(cleanCustomerName("DEVAGAM SANDEEP")).toBe("Devagam");
    expect(cleanCustomerName("Mallavarappu Vijaya Krishna")).toBe("Mallavarappu");
  });

  it("strips trailing and leading single/two-letter initials (e.g., 'TEJESH C S' -> 'Tejesh')", () => {
    expect(cleanCustomerName("TEJESH C S")).toBe("Tejesh");
    expect(cleanCustomerName("Tejesh C S")).toBe("Tejesh");
    expect(cleanCustomerName("Tejesh CS")).toBe("Tejesh");
    expect(cleanCustomerName("Tejesh C.S.")).toBe("Tejesh");
    expect(cleanCustomerName("C S Tejesh")).toBe("Tejesh");
    expect(cleanCustomerName("K Suresh Kumar")).toBe("Suresh");
    expect(cleanCustomerName("Suresh Kumar K S")).toBe("Suresh");
    expect(cleanCustomerName("Priya M")).toBe("Priya");
    expect(cleanCustomerName("Vignesh R.")).toBe("Vignesh");
  });

  it("cleans stray single-letter voice AI prefixes (e.g., 't Raina Dwivedi')", () => {
    expect(cleanCustomerName("t Raina Dwivedi")).toBe("Raina");
    expect(cleanCustomerName("d Suresh Kumar")).toBe("Suresh");
    expect(cleanCustomerName("x Priya Sharma")).toBe("Priya");
    expect(cleanCustomerName("t raina dwivedi")).toBe("Raina");
  });

  it("cleans STT filler words and conversational lead-ins", () => {
    expect(cleanCustomerName("My name is Rohan Gupta")).toBe("Rohan");
    expect(cleanCustomerName("this is Priya Sharma")).toBe("Priya");
    expect(cleanCustomerName("Speaking with Amit Verma")).toBe("Amit");
    expect(cleanCustomerName("uh Karan Singh")).toBe("Karan");
    expect(cleanCustomerName("um Deepak Sharma")).toBe("Deepak");
    expect(cleanCustomerName("the Vikram Patel")).toBe("Vikram");
  });

  it("strips salutations, titles, and professional honorifics (Dr., Mr., Mrs., CA, Swami, Shri, Smt, etc.)", () => {
    expect(cleanCustomerName("mr. suresh kumar")).toBe("Suresh");
    expect(cleanCustomerName("Mr Suresh Kumar")).toBe("Suresh");
    expect(cleanCustomerName("DR. PRIYA SHARMA")).toBe("Priya");
    expect(cleanCustomerName("Dr. Raina Dwivedi")).toBe("Raina");
    expect(cleanCustomerName("Shri Rajesh Patel")).toBe("Rajesh");
    expect(cleanCustomerName("Smt. Sunita Rao")).toBe("Sunita");
    expect(cleanCustomerName("Er. Nitin Gadkari")).toBe("Nitin");
    expect(cleanCustomerName("Advocate Rahul Roy")).toBe("Rahul");
    expect(cleanCustomerName("Adv. Rahul Roy")).toBe("Rahul");
    expect(cleanCustomerName("CA Ankit Gupta")).toBe("Ankit");
    expect(cleanCustomerName("Prof. Nitin Patel")).toBe("Nitin");
    expect(cleanCustomerName("Km. Pooja Sharma")).toBe("Pooja");
    expect(cleanCustomerName("Kumari Priya")).toBe("Priya");
    expect(cleanCustomerName("Swami Ramdev")).toBe("Ramdev");
    expect(cleanCustomerName("Capt. Vikram Batra")).toBe("Vikram");
    expect(cleanCustomerName("Colonel Ajay Singh")).toBe("Ajay");
    expect(cleanCustomerName("Late Shri Dr. Ramesh Kumar")).toBe("Ramesh");
  });

  it("removes list numbering, trailing numbers, and phone numbers", () => {
    expect(cleanCustomerName("1. Amit Kumar")).toBe("Amit");
    expect(cleanCustomerName("1 - Amit Kumar")).toBe("Amit");
    expect(cleanCustomerName("Amit Kumar 9876543210")).toBe("Amit");
    expect(cleanCustomerName("Amit Kumar +919876543210")).toBe("Amit");
    expect(cleanCustomerName("Raina 123")).toBe("Raina");
  });

  it("strips trailing bracket annotations and separators", () => {
    expect(cleanCustomerName("Raina Dwivedi (Shop)")).toBe("Raina");
    expect(cleanCustomerName("Raina Dwivedi [Lead]")).toBe("Raina");
    expect(cleanCustomerName("Raina Dwivedi - Customer")).toBe("Raina");
    expect(cleanCustomerName("Raina Dwivedi | Delhi")).toBe("Raina");
  });

  it("removes emojis, symbols, and extra whitespace", () => {
    expect(cleanCustomerName("👋 Vikram Malhotra 🔥")).toBe("Vikram");
    expect(cleanCustomerName('  "Raina   Dwivedi"  ')).toBe("Raina");
    expect(cleanCustomerName("  ,Raina Dwivedi.  ")).toBe("Raina");
  });

  it("supports full name mode when firstNameOnly: false", () => {
    expect(cleanCustomerName("RAINA DWIVEDI", { firstNameOnly: false })).toBe("Raina Dwivedi");
    expect(cleanCustomerName("t raina dwivedi", { firstNameOnly: false })).toBe("Raina Dwivedi");
    expect(cleanCustomerName("mr. suresh kumar", { firstNameOnly: false })).toBe("Suresh Kumar");
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
    expect(cleanCustomerName("रैना द्विवेदी")).toBe("रैना");
    expect(cleanCustomerName("करण सिंह")).toBe("करण");
    expect(cleanCustomerName("रैना द्विवेदी", { firstNameOnly: false })).toBe("रैना द्विवेदी");
  });

  it("batches cleans an array of names", () => {
    const raw = ["TEJESH C S", "t Raina Dwivedi", "mr. suresh kumar", "test", null, "PRIYA M"];
    const cleaned = cleanNamesBatch(raw);
    expect(cleaned).toEqual(["Tejesh", "Raina", "Suresh", null, null, "Priya"]);
  });
});
