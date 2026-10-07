import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { planImport, SAMPLE_CSV } from "@/lib/csvImport";
import { istToUtc } from "@/lib/time";

describe("parseCsv", () => {
  it("handles quotes, commas inside quotes, escaped quotes and line breaks in a field", () => {
    expect(parseCsv('a,"b,c","d ""x"" e","line1\nline2"\n1,2,3,4')).toEqual([
      ["a", "b,c", 'd "x" e', "line1\nline2"],
      ["1", "2", "3", "4"],
    ]);
  });
  it("handles Windows line endings, a BOM from Excel, and blank lines", () => {
    expect(parseCsv("﻿name,date\r\nRavi,2026-10-08\r\n\r\n")).toEqual([
      ["name", "date"],
      ["Ravi", "2026-10-08"],
    ]);
  });
  it("keeps empty trailing fields", () => {
    expect(parseCsv("a,b,c\nx,,")).toEqual([
      ["a", "b", "c"],
      ["x", "", ""],
    ]);
  });
});

const astros = [
  { id: "1", name: "Ravi Shankar", active: true },
  { id: "2", name: "Off Person", active: false },
];

describe("planImport", () => {
  it("imports the sample file cleanly", () => {
    const p = planImport({ csv: SAMPLE_CSV, astrologers: [], existingShifts: [] });
    expect(p.errors).toEqual([]);
    expect(p.astrologersToCreate.map((a) => a.name)).toEqual(["Pandit Ravi Shankar", "Meera Joshi", "Acharya Arun Mishra", "Dr. Kavita Rao"]);
    expect(p.shiftsToCreate).toHaveLength(4);
  });

  it("reads IST times correctly and treats an end before the start as past midnight", () => {
    const p = planImport({ csv: "name,date,start_time,end_time\nA,2026-10-12,23:30,00:30", astrologers: [], existingShifts: [] });
    expect(p.shiftsToCreate[0].startsAt).toEqual(istToUtc("2026-10-12", "23:30"));
    expect(p.shiftsToCreate[0].endsAt).toEqual(istToUtc("2026-10-13", "00:30"));
  });

  it("matches existing astrologers by name ignoring case and spacing, without creating a duplicate", () => {
    const p = planImport({ csv: "name,date,start,end\n  ravi   shankar ,2026-10-12,14:00,15:00", astrologers: astros, existingShifts: [] });
    expect(p.astrologersToCreate).toEqual([]);
    expect(p.shiftsToCreate[0].astrologerName).toBe("Ravi Shankar");
  });

  it("accepts Excel-style dd/mm/yyyy dates and single-digit hours", () => {
    const p = planImport({ csv: "name,date,start_time,end_time\nA,08/10/2026,9:00,10:00", astrologers: [], existingShifts: [] });
    expect(p.errors).toEqual([]);
    expect(p.shiftsToCreate[0].startsAt).toEqual(istToUtc("2026-10-08", "09:00"));
  });

  it("reports each bad row with its line number and still imports the good ones", () => {
    const csv = [
      "name,tagline,date,start_time,end_time",
      "Good One,x,2026-10-12,10:00,11:00",
      ",x,2026-10-12,11:00,12:00",
      "Bad Date,x,2026-02-31,11:00,12:00",
      "Bad Time,x,2026-10-12,25:00,12:00",
      "Half,x,2026-10-12,,12:00",
      "Too Long,x,2026-10-12,00:00,13:30",
    ].join("\n");
    const p = planImport({ csv, astrologers: [], existingShifts: [] });
    expect(p.shiftsToCreate).toHaveLength(1);
    expect(p.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7]);
    expect(p.astrologersToCreate.map((a) => a.name)).toEqual(["Good One"]); // bad rows do not create astrologers
  });

  it("rejects shifts that overlap the existing schedule or an earlier row of the same file", () => {
    const existing = [{ startsAt: istToUtc("2026-10-12", "14:00"), endsAt: istToUtc("2026-10-12", "15:00") }];
    const csv = "name,date,start_time,end_time\nA,2026-10-12,14:30,15:30\nB,2026-10-12,15:00,16:00\nC,2026-10-12,15:30,16:30";
    const p = planImport({ csv, astrologers: [], existingShifts: existing });
    expect(p.shiftsToCreate.map((s) => s.astrologerName)).toEqual(["B"]);
    expect(p.errors.map((e) => e.line)).toEqual([2, 4]);
  });

  it("refuses to schedule an inactive astrologer, and a file without a name column", () => {
    expect(planImport({ csv: "name,date,start,end\nOff Person,2026-10-12,10:00,11:00", astrologers: astros, existingShifts: [] }).errors[0].message).toMatch(/inactive/);
    expect(planImport({ csv: "foo,bar\n1,2", astrologers: [], existingShifts: [] }).errors[0].message).toMatch(/name/);
    expect(planImport({ csv: "", astrologers: [], existingShifts: [] }).errors[0].message).toMatch(/empty/);
  });

  it("only accepts https photo addresses", () => {
    const p = planImport({ csv: "name,photo_url\nA,http://x.y/z.jpg\nB,https://x.y/z.jpg", astrologers: [], existingShifts: [] });
    expect(p.errors).toHaveLength(1);
    expect(p.astrologersToCreate.map((a) => a.name)).toEqual(["B"]);
  });
});
