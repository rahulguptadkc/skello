import { describe, expect, it } from "vitest";
import { cleanCustomerName, cleanNamesBatch } from "./clean-name";

describe("cleanCustomerName", () => {
  it("converts first name to Hindi (Devanagari) by default (e.g. 'karthik' -> 'कार्तिक')", () => {
    expect(cleanCustomerName("karthik")).toBe("कार्तिक");
    expect(cleanCustomerName("Karthik")).toBe("कार्तिक");
    expect(cleanCustomerName("Kartik")).toBe("कार्तिक");
    expect(cleanCustomerName("Kartik Sharma")).toBe("कार्तिक");
    expect(cleanCustomerName("Raina Dwivedi")).toBe("रैना");
    expect(cleanCustomerName("t Raina Dwivedi")).toBe("रैना");
    expect(cleanCustomerName("Suresh Kumar")).toBe("सुरेश");
    expect(cleanCustomerName("Amit Kumar Sharma")).toBe("अमित");
    expect(cleanCustomerName("DEENA RODRIGUES")).toBe("दीना");
    expect(cleanCustomerName("DEVAGAM SANDEEP")).toBe("देवगम");
    expect(cleanCustomerName("TEJESH C S")).toBe("तेजेश");
    expect(cleanCustomerName("KIRAN MATTUR")).toBe("किरण");
    expect(cleanCustomerName("Mallavarappu Vijaya Krishna")).toBe("मल्लवरपु");
  });

  it("extracts Latin first name when toDevanagari: false", () => {
    expect(cleanCustomerName("karthik", { toDevanagari: false })).toBe("Karthik");
    expect(cleanCustomerName("Raina Dwivedi", { toDevanagari: false })).toBe("Raina");
    expect(cleanCustomerName("t Raina Dwivedi", { toDevanagari: false })).toBe("Raina");
    expect(cleanCustomerName("Suresh Kumar", { toDevanagari: false })).toBe("Suresh");
    expect(cleanCustomerName("Amit Kumar Sharma", { toDevanagari: false })).toBe("Amit");
    expect(cleanCustomerName("DEENA RODRIGUES", { toDevanagari: false })).toBe("Deena");
    expect(cleanCustomerName("DEVAGAM SANDEEP", { toDevanagari: false })).toBe("Devagam");
    expect(cleanCustomerName("Mallavarappu Vijaya Krishna", { toDevanagari: false })).toBe("Mallavarappu");
  });

  it("strips trailing and leading single/two-letter initials (e.g., 'TEJESH C S' -> 'तेजेश' / 'Tejesh')", () => {
    expect(cleanCustomerName("TEJESH C S")).toBe("तेजेश");
    expect(cleanCustomerName("TEJESH C S", { toDevanagari: false })).toBe("Tejesh");
    expect(cleanCustomerName("Tejesh C S", { toDevanagari: false })).toBe("Tejesh");
    expect(cleanCustomerName("Tejesh CS", { toDevanagari: false })).toBe("Tejesh");
    expect(cleanCustomerName("Tejesh C.S.", { toDevanagari: false })).toBe("Tejesh");
    expect(cleanCustomerName("C S Tejesh", { toDevanagari: false })).toBe("Tejesh");
    expect(cleanCustomerName("K Suresh Kumar", { toDevanagari: false })).toBe("Suresh");
    expect(cleanCustomerName("Suresh Kumar K S", { toDevanagari: false })).toBe("Suresh");
    expect(cleanCustomerName("Priya M", { toDevanagari: false })).toBe("Priya");
    expect(cleanCustomerName("Vignesh R.", { toDevanagari: false })).toBe("Vignesh");
  });

  it("cleans stray single-letter voice AI prefixes (e.g., 't Raina Dwivedi')", () => {
    expect(cleanCustomerName("t Raina Dwivedi")).toBe("रैना");
    expect(cleanCustomerName("t Raina Dwivedi", { toDevanagari: false })).toBe("Raina");
    expect(cleanCustomerName("d Suresh Kumar", { toDevanagari: false })).toBe("Suresh");
    expect(cleanCustomerName("x Priya Sharma", { toDevanagari: false })).toBe("Priya");
    expect(cleanCustomerName("t raina dwivedi", { toDevanagari: false })).toBe("Raina");
  });

  it("cleans STT filler words and conversational lead-ins", () => {
    expect(cleanCustomerName("My name is Rohan Gupta")).toBe("रोहन");
    expect(cleanCustomerName("this is Priya Sharma")).toBe("प्रिया");
    expect(cleanCustomerName("Speaking with Amit Verma")).toBe("अमित");
    expect(cleanCustomerName("uh Karan Singh")).toBe("करण");
    expect(cleanCustomerName("um Deepak Sharma")).toBe("दीपक");
    expect(cleanCustomerName("the Vikram Patel")).toBe("विक्रम");
  });

  it("strips salutations, titles, and professional honorifics (Dr., Mr., Mrs., CA, Swami, Shri, Smt, etc.)", () => {
    expect(cleanCustomerName("mr. suresh kumar")).toBe("सुरेश");
    expect(cleanCustomerName("Mr Suresh Kumar")).toBe("सुरेश");
    expect(cleanCustomerName("DR. PRIYA SHARMA")).toBe("प्रिया");
    expect(cleanCustomerName("Dr. Raina Dwivedi")).toBe("रैना");
    expect(cleanCustomerName("Shri Rajesh Patel")).toBe("राजेश");
    expect(cleanCustomerName("Smt. Sunita Rao")).toBe("सुनीता");
    expect(cleanCustomerName("Er. Nitin Gadkari")).toBe("नितिन");
    expect(cleanCustomerName("Advocate Rahul Roy")).toBe("राहुल");
    expect(cleanCustomerName("Adv. Rahul Roy")).toBe("राहुल");
    expect(cleanCustomerName("CA Ankit Gupta")).toBe("अंकित");
    expect(cleanCustomerName("Prof. Nitin Patel")).toBe("नितिन");
    expect(cleanCustomerName("Km. Pooja Sharma")).toBe("पूजा");
    expect(cleanCustomerName("Kumari Priya")).toBe("प्रिया");
    expect(cleanCustomerName("Swami Ramdev")).toBe("रामदेव");
    expect(cleanCustomerName("Capt. Vikram Batra")).toBe("विक्रम");
    expect(cleanCustomerName("Colonel Ajay Singh")).toBe("अजय");
    expect(cleanCustomerName("Late Shri Dr. Ramesh Kumar")).toBe("रमेश");
  });

  it("removes list numbering, trailing numbers, and phone numbers", () => {
    expect(cleanCustomerName("1. Amit Kumar")).toBe("अमित");
    expect(cleanCustomerName("1 - Amit Kumar")).toBe("अमित");
    expect(cleanCustomerName("Amit Kumar 9876543210")).toBe("अमित");
    expect(cleanCustomerName("Amit Kumar +919876543210")).toBe("अमित");
    expect(cleanCustomerName("Raina 123")).toBe("रैना");
  });

  it("strips trailing bracket annotations and separators", () => {
    expect(cleanCustomerName("Raina Dwivedi (Shop)")).toBe("रैना");
    expect(cleanCustomerName("Raina Dwivedi [Lead]")).toBe("रैना");
    expect(cleanCustomerName("Raina Dwivedi - Customer")).toBe("रैना");
    expect(cleanCustomerName("Raina Dwivedi | Delhi")).toBe("रैना");
  });

  it("removes emojis, symbols, and extra whitespace", () => {
    expect(cleanCustomerName("👋 Vikram Malhotra 🔥")).toBe("विक्रम");
    expect(cleanCustomerName('  "Raina   Dwivedi"  ')).toBe("रैना");
    expect(cleanCustomerName("  ,Raina Dwivedi.  ")).toBe("रैना");
  });

  it("supports full name mode when firstNameOnly: false", () => {
    expect(cleanCustomerName("RAINA DWIVEDI", { firstNameOnly: false, toDevanagari: false })).toBe("Raina Dwivedi");
    expect(cleanCustomerName("t raina dwivedi", { firstNameOnly: false, toDevanagari: false })).toBe("Raina Dwivedi");
    expect(cleanCustomerName("mr. suresh kumar", { firstNameOnly: false, toDevanagari: false })).toBe("Suresh Kumar");
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

  it("preserves already Devanagari script names and strips Hindi honorifics", () => {
    expect(cleanCustomerName("कार्तिक")).toBe("कार्तिक");
    expect(cleanCustomerName("कार्तिक शर्मा")).toBe("कार्तिक");
    expect(cleanCustomerName("श्री कार्तिक शर्मा")).toBe("कार्तिक");
    expect(cleanCustomerName("डॉ. कार्तिक")).toBe("कार्तिक");
    expect(cleanCustomerName("रैना द्विवेदी")).toBe("रैना");
    expect(cleanCustomerName("करण सिंह")).toBe("करण");
    expect(cleanCustomerName("कार्तिक शर्मा", { firstNameOnly: false })).toBe("कार्तिक शर्मा");
    expect(cleanCustomerName("रैना द्विवेदी", { firstNameOnly: false })).toBe("रैना द्विवेदी");
  });

  it("batches cleans an array of names into Hindi first names", () => {
    const raw = ["TEJESH C S", "t Raina Dwivedi", "mr. suresh kumar", "test", null, "PRIYA M", "karthik"];
    const cleaned = cleanNamesBatch(raw);
    expect(cleaned).toEqual(["तेजेश", "रैना", "सुरेश", null, null, "प्रिया", "कार्तिक"]);
  });
});
