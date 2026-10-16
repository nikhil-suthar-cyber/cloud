export type DocumentStatus = "Queued" | "Processing" | "Completed" | "Failed";

export type ProcessingEvent = {
  id: string;
  at: string;
  title: string;
  detail: string;
  kind: "info" | "success" | "error";
};

export type DocumentReport = {
  summary: string;
  metadata: Record<string, string | number>;
  extractedText: string;
  generatedAt: string;
};

export type DocumentRecord = {
  id: string;
  name: string;
  extension: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  status: DocumentStatus;
  durationMs: number | null;
  pageCount: number | null;
  metadata: Record<string, string | number>;
  report: DocumentReport | null;
  error: string | null;
  events: ProcessingEvent[];
  fileBlob?: Blob;
};

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const supportedExtensions = new Set(["pdf", "txt", "csv", "png", "jpg", "jpeg", "webp", "gif"]);

export function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateDocument(file: Pick<File, "name" | "size">) {
  const extension = getExtension(file.name);
  if (!supportedExtensions.has(extension)) {
    return { valid: false, message: "This file type is not supported. Choose a PDF, TXT, CSV, or image file." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { valid: false, message: "This file is larger than the 10 MB demo upload limit." };
  }
  if (file.size === 0) {
    return { valid: false, message: "This file is empty and cannot be processed." };
  }
  return { valid: true, message: null };
}

export function makeEvent(title: string, detail: string, kind: ProcessingEvent["kind"] = "info"): ProcessingEvent {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), title, detail, kind };
}

export async function analyzeDocument(file: File): Promise<Pick<DocumentRecord, "metadata" | "pageCount" | "report">> {
  const extension = getExtension(file.name);
  const metadata: Record<string, string | number> = {
    "Original file name": file.name,
    "File format": extension.toUpperCase(),
    "MIME type": file.type || "Not provided by browser",
    "File size": formatFileSize(file.size),
  };
  let extractedText = "No text preview is available for this file type.";
  let pageCount: number | null = null;

  if (extension === "txt" || extension === "csv") {
    const contents = await file.text();
    const lines = contents.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (extension === "txt") {
      const words = contents.trim() ? contents.trim().split(/\s+/).length : 0;
      metadata["Word count"] = words;
      metadata["Line count"] = contents ? contents.split(/\r?\n/).length : 0;
      extractedText = contents.slice(0, 1800) || "The text file is empty.";
    } else {
      metadata["Rows detected"] = Math.max(0, lines.length - 1);
      metadata["Columns detected"] = lines[0]?.split(",").length ?? 0;
      extractedText = lines.slice(0, 8).join("\n").slice(0, 1800) || "The CSV file has no rows.";
    }
  } else if (extension === "pdf") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const header = new TextDecoder("latin1").decode(bytes.slice(0, 8));
    if (!header.startsWith("%PDF-")) throw new Error("The file does not contain a valid PDF header.");
    const source = new TextDecoder("latin1").decode(bytes);
    const pages = source.match(/\/Type\s*\/Page\b/g);
    pageCount = pages?.length ?? 0;
    metadata["PDF page objects detected"] = pageCount;
    metadata["Page count"] = pageCount === 0 ? "Not available in demo reader" : pageCount;
    extractedText = "PDF structure inspected in the browser demo. Text extraction and complex PDF parsing require a document-processing service.";
  } else {
    metadata["Image dimensions"] = "Not measured in this browser demo";
    extractedText = "Image file validated. OCR is not connected in local demo mode.";
  }

  const generatedAt = new Date().toISOString();
  return {
    metadata,
    pageCount,
    report: {
      summary: `${extension.toUpperCase()} file validated and analyzed locally in the browser demo. No cloud function was invoked.`,
      metadata,
      extractedText,
      generatedAt,
    },
  };
}

export function createReportDownload(record: DocumentRecord, format: "json" | "txt") {
  if (!record.report) return null;
  const contents = format === "json"
    ? JSON.stringify({ document: record.name, status: record.status, ...record.report }, null, 2)
    : `${record.name}\n${record.report.summary}\n\nMetadata\n${Object.entries(record.report.metadata).map(([key, value]) => `${key}: ${value}`).join("\n")}\n\nExtracted preview\n${record.report.extractedText}\n`;
  return new Blob([contents], { type: format === "json" ? "application/json" : "text/plain" });
}