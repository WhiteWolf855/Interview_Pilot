import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/lib/config";
import { ApiError } from "@/lib/server/http";
import { detectKind, extractResumeText } from "@/lib/server/resume/parse";
import { RESUME_TEXT, makeDocx, makeEmptyPdf, makePdf } from "../helpers/fixtures";

async function errorCode(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  return "no error";
}

describe("resume parser", () => {
  afterEach(() => vi.restoreAllMocks());

  it("extracts text from a PDF", async () => {
    const result = await extractResumeText({ kind: "file", bytes: await makePdf(RESUME_TEXT) });
    expect(result.source).toBe("pdf");
    expect(result.text).toContain("Jordan Okafor");
    expect(result.text).toContain("from 9 hours to 5 hours");
    expect(result.text).toContain("Grafana");
  });

  it("extracts text from a multi-page PDF", async () => {
    const long = Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of the resume about project delivery.`).join("\n");
    const result = await extractResumeText({ kind: "file", bytes: await makePdf(long) });
    expect(result.text).toContain("Line 1 of the resume");
    expect(result.text).toContain("Line 120 of the resume");
  });

  it("extracts text from a DOCX", async () => {
    const result = await extractResumeText({ kind: "file", bytes: await makeDocx(RESUME_TEXT) });
    expect(result.source).toBe("docx");
    expect(result.text).toContain("Northwind Logistics");
    expect(result.text).toContain("Wrote Python scripts");
  });

  it("passes pasted text through with whitespace tidied", async () => {
    const result = await extractResumeText({ kind: "text", text: `  ${RESUME_TEXT.replace(/\n/g, "\r\n")}\n\n\n\n\n\nExtra   spaced    line​` });
    expect(result.source).toBe("text");
    expect(result.text.startsWith("Jordan Okafor")).toBe(true);
    expect(result.text).toContain("Extra spaced line");
    expect(result.text).not.toMatch(/\r|​|\n{4,}/);
  });

  it("detects the file type from its bytes, not its name", async () => {
    expect(detectKind(await makePdf("hello"))).toBe("pdf");
    expect(detectKind(await makeDocx("hello"))).toBe("docx");
    expect(detectKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toBe("doc");
    expect(detectKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("unknown");
  });

  it("rejects an empty file", async () => {
    expect(await errorCode(extractResumeText({ kind: "file", bytes: new Uint8Array() }))).toBe("unreadable_file");
  });

  it("rejects a PDF with no text, such as a scan", async () => {
    expect(await errorCode(extractResumeText({ kind: "file", bytes: await makeEmptyPdf() }))).toBe("unreadable_file");
  });

  it("rejects an image renamed to .pdf and a legacy .doc", async () => {
    expect(await errorCode(extractResumeText({ kind: "file", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }))).toBe("unsupported_file");
    expect(await errorCode(extractResumeText({ kind: "file", bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]) }))).toBe("unsupported_file");
  });

  it("rejects a corrupt PDF and a zip that is not a Word document", async () => {
    const corrupt = new TextEncoder().encode("%PDF-1.7 this is not really a pdf");
    expect(await errorCode(extractResumeText({ kind: "file", bytes: corrupt }))).toBe("unreadable_file");
    const zipOnly = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0]);
    expect(await errorCode(extractResumeText({ kind: "file", bytes: zipOnly }))).toBe("unreadable_file");
  });

  it("rejects a file over the size limit", async () => {
    const big = new Uint8Array(LIMITS.resumeMaxBytes + 1);
    big.set([0x25, 0x50, 0x44, 0x46]);
    expect(await errorCode(extractResumeText({ kind: "file", bytes: big }))).toBe("too_large");
  });

  it("rejects text that is too short or too long, and never truncates", async () => {
    expect(await errorCode(extractResumeText({ kind: "text", text: "Too short" }))).toBe("unreadable_file");
    const long = "experience ".repeat(LIMITS.resumeMaxChars / 5);
    expect(await errorCode(extractResumeText({ kind: "text", text: long }))).toBe("too_large");
  });

  it("writes nothing to the console while parsing", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    await extractResumeText({ kind: "file", bytes: await makePdf(RESUME_TEXT) });
    await extractResumeText({ kind: "file", bytes: await makeDocx(RESUME_TEXT) });
    await errorCode(extractResumeText({ kind: "file", bytes: new TextEncoder().encode("%PDF-1.7 broken Jordan Okafor") }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
