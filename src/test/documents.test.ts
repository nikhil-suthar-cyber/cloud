import { describe, expect, it } from "vitest";

import { MAX_FILE_BYTES, analyzeDocument, validateDocument } from "@/lib/documents";

describe("DocuFlow demo document rules", () => {
  it("accepts PDF, TXT, CSV, and supported image files", () => {
    for (const name of ["brief.pdf", "notes.txt", "table.csv", "scan.png", "photo.jpg", "photo.jpeg", "chart.webp", "frame.gif"]) {
      expect(validateDocument({ name, size: 42 }).valid, name).toBe(true);
    }
  });

  it("rejects unsupported file types and files larger than 10 MB", () => {
    expect(validateDocument({ name: "archive.zip", size: 42 }).valid).toBe(false);
    expect(validateDocument({ name: "large.pdf", size: MAX_FILE_BYTES + 1 }).valid).toBe(false);
  });

  it("creates a readable local report for text uploads", async () => {
    const file = new File(["DocuFlow demo\nA second line."], "notes.txt", { type: "text/plain" });
    const result = await analyzeDocument(file);
    expect(result.metadata["Word count"]).toBe(5);
    expect(result.metadata["Line count"]).toBe(2);
    expect(result.report?.extractedText).toContain("DocuFlow demo");
    expect(result.report?.summary).toContain("No cloud function was invoked");
  });

  it("reports malformed PDF content as a processing error", async () => {
    const file = new File(["not a pdf"], "bad.pdf", { type: "application/pdf" });
    await expect(analyzeDocument(file)).rejects.toThrow("valid PDF header");
  });
});