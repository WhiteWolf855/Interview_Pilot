import "server-only";
import { LIMITS } from "@/lib/config";
import { sanitizeText } from "@/lib/guards/untrusted";
import { ApiError } from "../http";

export type ResumeKind = "pdf" | "docx" | "text";

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** File type from the file's first bytes, not from its name. */
export function detectKind(bytes: Uint8Array): "pdf" | "docx" | "doc" | "unknown" {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "docx"; // zip container
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return "doc"; // legacy Word
  return "unknown";
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // verbosity 0 stops the PDF library printing warnings, which could quote file contents.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return result.value;
}

/** Tidies extracted or pasted text and enforces the length limits. Never truncates. */
export function finalizeResumeText(raw: string): string {
  const text = sanitizeText(raw).replace(/[ \t]{2,}/g, " ");
  if (text.length < LIMITS.resumeMinChars) {
    throw new ApiError(
      "unreadable_file",
      "We could not find enough text in that resume. If it is a scanned image, paste the text instead.",
    );
  }
  if (text.length > LIMITS.resumeMaxChars) {
    throw new ApiError(
      "too_large",
      `That resume is ${text.length.toLocaleString("en")} characters, over the ${LIMITS.resumeMaxChars.toLocaleString("en")} limit. Paste the most relevant sections instead.`,
    );
  }
  return text;
}

/**
 * Extracts resume text in memory. Nothing is written to disk and the text is
 * never logged; callers get the text and the detected kind only.
 */
export async function extractResumeText(
  input: { kind: "file"; bytes: Uint8Array } | { kind: "text"; text: string },
): Promise<{ text: string; source: ResumeKind }> {
  if (input.kind === "text") return { text: finalizeResumeText(input.text), source: "text" };

  const { bytes } = input;
  if (bytes.length === 0) throw new ApiError("unreadable_file", "That file is empty.");
  if (bytes.length > LIMITS.resumeMaxBytes) {
    throw new ApiError("too_large", `That file is larger than ${Math.round(LIMITS.resumeMaxBytes / 1024 / 1024)} MB.`);
  }
  const kind = detectKind(bytes);
  if (kind === "doc") {
    throw new ApiError("unsupported_file", "Old .doc files are not supported. Save it as .docx or PDF, or paste the text.");
  }
  if (kind === "unknown") {
    throw new ApiError("unsupported_file", "Upload a PDF or a .docx file, or paste the text of your resume.");
  }
  let raw: string;
  try {
    raw = kind === "pdf" ? await pdfText(bytes) : await docxText(bytes);
  } catch {
    // The parser's own error may quote file contents, so it is not passed on or logged.
    throw new ApiError("unreadable_file", "We could not read that file. Try another export of it, or paste the text.");
  }
  return { text: finalizeResumeText(raw), source: kind };
}
