import { createFileRoute } from "@tanstack/react-router";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, subDays } from "date-fns";
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCircle2,
  ChevronDown, Clock3, Cloud, Database, FileArchive, FileImage, FileJson2, FileText,
  FileUp, Filter, FolderOpen, HardDrive, Info, Layers3, ListFilter, LoaderCircle,
  MoreHorizontal, RefreshCw, Search, ShieldCheck, Sparkles, Upload, Workflow, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  analyzeDocument, createReportDownload, formatFileSize, getExtension, makeEvent,
  validateDocument, type DocumentRecord, type DocumentStatus,
} from "@/lib/documents";
import { listDocuments, removeDocument, saveDocument } from "@/lib/document-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DocuFlow Cloud — Document processing workspace" },
      { name: "description", content: "Upload documents, review local demo analysis, and follow processing events in DocuFlow Cloud." },
      { property: "og:title", content: "DocuFlow Cloud — Document processing workspace" },
      { property: "og:description", content: "A clear workspace for document uploads, processing status, and analysis reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DocuFlow,
});

type ViewName = "Overview" | "Documents" | "Workflow";
type StatusFilter = "All statuses" | DocumentStatus;

function DocuFlow() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [view, setView] = useState<ViewName>("Overview");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All statuses");
  const [typeFilter, setTypeFilter] = useState("All types");
  const [selected, setSelected] = useState<DocumentRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    let active = true;
    listDocuments().then((saved) => {
      if (!active) return;
      setDocuments(saved);
      setIsLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setIsLoading(false);
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Local demo storage could not be opened." });
    });
    return () => { active = false; };
  }, []);

  const updateRecord = useCallback((id: string, update: (record: DocumentRecord) => DocumentRecord) => {
    setDocuments((current) => {
      const next = current.map((record) => record.id === id ? update(record) : record);
      const changed = next.find((record) => record.id === id);
      if (changed) void saveDocument(changed).catch(() => setNotice({ tone: "error", text: "This update could not be saved to local browser storage." }));
      setSelected((currentSelected) => currentSelected?.id === id ? changed ?? null : currentSelected);
      return next;
    });
  }, []);

  const processDocument = useCallback(async (id: string, file: File) => {
    const startedAt = performance.now();
    updateRecord(id, (record) => ({
      ...record,
      status: "Processing",
      error: null,
      events: [...record.events, makeEvent("Processing started", "Running local file checks and available metadata extraction.")],
    }));
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    try {
      const result = await analyzeDocument(file);
      const durationMs = Math.round(performance.now() - startedAt);
      updateRecord(id, (record) => ({
        ...record,
        status: "Completed",
        durationMs,
        pageCount: result.pageCount,
        metadata: result.metadata,
        report: result.report,
        error: null,
        events: [...record.events,
          makeEvent("Metadata extracted", `${Object.keys(result.metadata).length} fields available in the browser demo.`),
          makeEvent("Report generated", "A local JSON result and readable summary are ready.", "success"),
          makeEvent("Demo processing completed", `Completed in ${durationMs} ms. No cloud service was invoked.`, "success"),
        ],
      }));
      setNotice({ tone: "success", text: `${file.name} has a local demo report ready.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The document could not be processed.";
      updateRecord(id, (record) => ({
        ...record,
        status: "Failed",
        durationMs: Math.round(performance.now() - startedAt),
        error: message,
        report: null,
        events: [...record.events, makeEvent("Processing failed", message, "error")],
      }));
      setNotice({ tone: "error", text: `${file.name}: ${message}` });
    }
  }, [updateRecord]);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      const validation = validateDocument(file);
      if (!validation.valid) rejected.push(`${file.name}: ${validation.message}`);
      else accepted.push(file);
    }
    if (rejected.length > 0) setNotice({ tone: "error", text: rejected.join(" ") });
    if (accepted.length === 0) return;
    setNotice({ tone: "info", text: `${accepted.length} file${accepted.length === 1 ? "" : "s"} added to the local demo queue.` });
    for (const file of accepted) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const initial: DocumentRecord = {
        id,
        name: file.name,
        extension: getExtension(file.name),
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        uploadedAt: now,
        status: "Queued",
        durationMs: null,
        pageCount: null,
        metadata: {},
        report: null,
        error: null,
        events: [makeEvent("File added", "Stored in this browser's local demo workspace."), makeEvent("Queued", "Waiting for local demo processing.")],
        fileBlob: file,
      };
      setDocuments((current) => [initial, ...current]);
      try {
        await saveDocument(initial);
        void processDocument(id, file);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The file could not be stored locally.";
        updateRecord(id, (record) => ({ ...record, status: "Failed", error: message, events: [...record.events, makeEvent("Local storage failed", message, "error")] }));
      }
    }
  }, [processDocument, updateRecord]);

  const retryDocument = useCallback(async (record: DocumentRecord) => {
    if (!record.fileBlob) {
      setNotice({ tone: "error", text: "The source file is unavailable in this browser. Upload it again to retry." });
      return;
    }
    const file = new File([record.fileBlob], record.name, { type: record.mimeType });
    updateRecord(record.id, (item) => ({ ...item, status: "Queued", error: null, report: null, events: [...item.events, makeEvent("Retry requested", "The source file is being reprocessed locally.")] }));
    void processDocument(record.id, file);
  }, [processDocument, updateRecord]);

  const filteredDocuments = useMemo(() => documents.filter((document) => {
    const matchesQuery = document.name.toLowerCase().includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === "All statuses" || document.status === statusFilter;
    const matchesType = typeFilter === "All types" || document.extension.toUpperCase() === typeFilter;
    return matchesQuery && matchesStatus && matchesType;
  }), [documents, query, statusFilter, typeFilter]);

  const counts = useMemo(() => ({
    total: documents.length,
    queued: documents.filter(({ status }) => status === "Queued" || status === "Processing").length,
    completed: documents.filter(({ status }) => status === "Completed").length,
    failed: documents.filter(({ status }) => status === "Failed").length,
  }), [documents]);

  const activity = useMemo(() => documents.flatMap((document) => document.events.map((event) => ({ ...event, documentName: document.name, documentId: document.id })))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7), [documents]);

  const chartData = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const day = subDays(new Date(), 6 - index);
    const dayKey = format(day, "yyyy-MM-dd");
    const dayRecords = documents.filter((document) => document.uploadedAt.slice(0, 10) === dayKey);
    return {
      day: format(day, "EEE"),
      completed: dayRecords.filter(({ status }) => status === "Completed").length,
      queued: dayRecords.filter(({ status }) => status === "Queued" || status === "Processing").length,
      failed: dayRecords.filter(({ status }) => status === "Failed").length,
    };
  }), [documents]);

  const openReport = (record: DocumentRecord, formatName: "json" | "txt") => {
    const blob = createReportDownload(record, formatName);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${record.name.replace(/\.[^.]+$/, "")}-report.${formatName}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ tone: "success", text: `${formatName.toUpperCase()} report downloaded.` });
  };

  const removeRecord = async (record: DocumentRecord) => {
    try {
      await removeDocument(record.id);
      setDocuments((current) => current.filter((item) => item.id !== record.id));
      setSelected(null);
      setNotice({ tone: "success", text: `${record.name} removed from this browser.` });
    } catch {
      setNotice({ tone: "error", text: "The document could not be removed from local storage." });
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    void handleFiles(event.dataTransfer.files);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-[244px] shrink-0 flex-col border-r border-border bg-card px-4 py-5 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Layers3 className="size-[18px]" /></div>
            <div><div className="font-display text-[15px] font-extrabold leading-tight">DocuFlow</div><div className="mt-0.5 text-[11px] font-medium text-muted-foreground">CLOUD WORKSPACE</div></div>
          </div>
          <div className="mt-9 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Workspace</div>
          <nav className="mt-2 grid gap-1" aria-label="Workspace">
            {(["Overview", "Documents", "Workflow"] as const).map((item) => {
              const Icon = item === "Overview" ? Activity : item === "Documents" ? FolderOpen : Workflow;
              return <Button key={item} variant="ghost" onClick={() => setView(item)} className={`h-10 justify-start rounded-md px-3 text-[13px] ${view === item ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground"}`}><Icon className="size-4" />{item}</Button>;
            })}
          </nav>
          <div className="mt-8 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Storage</div>
          <div className="mt-3 rounded-md border border-border bg-background px-3 py-3.5">
            <div className="flex items-center justify-between text-xs font-semibold"><span>Local demo</span><HardDrive className="size-3.5 text-primary" /></div>
            <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Files stay in this browser. No cloud storage is connected.</div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground"><span>Browser quota</span><span>Managed by browser</span></div>
          </div>
          <div className="mt-auto rounded-md bg-surface-cream p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold"><ShieldCheck className="size-4 text-primary" /> Private by default</div>
            <p className="mb-0 mt-1.5 text-[11px] leading-relaxed text-muted-foreground">Files are not uploaded to a server in demo mode.</p>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-border px-1 pt-4">
            <div className="flex min-w-0 items-center gap-2.5"><div className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-secondary-foreground">DF</div><div className="min-w-0"><div className="truncate text-xs font-semibold">Demo workspace</div><div className="text-[10px] text-muted-foreground">Local session</div></div></div>
            <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[66px] items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:px-7">
            <div className="flex items-center gap-3 lg:hidden"><div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"><Layers3 className="size-4" /></div><span className="font-display text-sm font-extrabold">DocuFlow</span></div>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex"><span>Workspace</span><span>/</span><span className="font-semibold text-foreground">{view}</span></div>
            <div className="flex items-center gap-2.5">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-status-amber/30 bg-status-amber-soft px-2.5 py-1 text-[10px] font-bold text-primary"><span className="size-1.5 rounded-full bg-status-amber" />LOCAL DEMO</div>
              <div className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex"><ShieldCheck className="size-3.5" /> Private to this browser</div>
              <Button onClick={() => fileInputRef.current?.click()} className="h-9 rounded-md px-3 text-xs"><Upload className="size-3.5" /><span className="hidden sm:inline">Upload documents</span><span className="sm:hidden">Upload</span></Button>
            </div>
          </header>

          <div className="mx-auto max-w-[1440px] px-4 pb-12 pt-7 md:px-7 md:pt-8">
            <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.13em] text-primary"><Sparkles className="size-3.5" /> DOCUMENT OPERATIONS</div><h1 className="mt-2 text-[26px] font-bold leading-tight tracking-normal sm:text-[30px]">{view === "Overview" ? "Good work starts here." : view}</h1><p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{view === "Overview" ? "A clear view of documents and processing activity in your local workspace." : view === "Documents" ? "Find, inspect, and manage files processed in this browser." : "See exactly what runs locally and what would need a connected cloud service."}</p></div>
              <div className="flex items-center gap-2.5">
                <div className="hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground sm:flex"><Clock3 className="size-3.5" />Last 7 days<ChevronDown className="size-3" /></div>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="h-9 rounded-md px-3 text-xs"><FileUp className="size-3.5" />Upload files</Button>
              </div>
            </section>

            {notice && <div role="status" className={`mt-5 flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-xs ${notice.tone === "error" ? "border-status-red/30 bg-status-red-soft text-status-red" : notice.tone === "success" ? "border-status-green/25 bg-status-green-soft text-status-green" : "border-border bg-card text-foreground"}`}><Info className="mt-0.5 size-3.5 shrink-0" /><span className="min-w-0 flex-1 leading-relaxed">{notice.text}</span><Button variant="ghost" size="icon" aria-label="Dismiss notification" onClick={() => setNotice(null)} className="-mr-1 -mt-1 size-6 shrink-0"><X className="size-3.5" /></Button></div>}

            {view === "Workflow" ? <WorkflowView /> : (
              <>
                <section className="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Document metrics">
                  <Metric title="Documents processed" value={counts.total} note="Files in local history" icon={FileText} tone="primary" />
                  <Metric title="Waiting in queue" value={counts.queued} note="Queued or processing" icon={Clock3} tone="amber" />
                  <Metric title="Completed successfully" value={counts.completed} note="Local demo reports ready" icon={CheckCircle2} tone="green" />
                  <Metric title="Failed jobs" value={counts.failed} note="Can be retried locally" icon={AlertCircle} tone="red" />
                </section>

                {view === "Overview" && <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,.85fr)]">
                  <section className="min-w-0 rounded-md border border-border bg-card p-4 md:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold">Processing activity</h2><p className="mt-1 text-[11px] text-muted-foreground">Document status by upload date · local records only</p></div><div className="flex items-center gap-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-primary" />Completed</span><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-status-amber" />In queue</span><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-status-red" />Failed</span></div></div>
                    <div className="mt-5 h-[190px] w-full" role="img" aria-label="Seven-day document status chart">
                      <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 4, right: 6, left: -24, bottom: 0 }}><CartesianGrid vertical={false} className="df-chart-grid" /><XAxis dataKey="day" axisLine={false} tickLine={false} className="df-chart-axis" /><YAxis allowDecimals={false} axisLine={false} tickLine={false} className="df-chart-axis" /><Tooltip contentStyle={{ borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 12 }} /><Area type="monotone" dataKey="completed" name="Completed" stroke="var(--primary)" fill="var(--accent)" strokeWidth={2} fillOpacity={0.45} /><Area type="monotone" dataKey="queued" name="In queue" stroke="var(--status-amber)" fill="var(--status-amber-soft)" strokeWidth={1.5} fillOpacity={0.6} /><Area type="monotone" dataKey="failed" name="Failed" stroke="var(--status-red)" fill="var(--status-red-soft)" strokeWidth={1.5} fillOpacity={0.55} /></AreaChart></ResponsiveContainer>
                    </div>
                    {documents.length === 0 && <p className="-mt-1 text-center text-[10px] text-muted-foreground">No uploads in this period yet.</p>}
                  </section>
                  <section className="rounded-md border border-border bg-card p-4 md:p-5"><div className="flex items-start justify-between"><div><h2 className="text-sm font-bold">Recent activity</h2><p className="mt-1 text-[11px] text-muted-foreground">Timestamped processing events</p></div><Button variant="ghost" onClick={() => setView("Documents")} className="h-7 gap-1 px-2 text-[10px] text-primary">View all<ArrowRight className="size-3" /></Button></div><div className="mt-4">{activity.length === 0 ? <EmptyActivity onUpload={() => fileInputRef.current?.click()} /> : <div className="grid">{activity.slice(0, 5).map((event) => <button key={event.id} onClick={() => setSelected(documents.find((item) => item.id === event.documentId) ?? null)} className="flex min-w-0 items-start gap-2.5 border-b border-border py-3 text-left last:border-0"><EventDot kind={event.kind} /><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold">{event.title}</span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{event.documentName}</span><span className="mt-1 block text-[9px] text-muted-foreground">{new Date(event.at).toLocaleString()}</span></span><ArrowUpRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" /></button>)}</div>}</div></section>
                </div>}

                <section className="mt-5 rounded-md border border-border bg-card p-4 md:p-5">
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start"><div><div className="flex items-center gap-2"><h2 className="text-sm font-bold">{view === "Overview" ? "Recent documents" : "All documents"}</h2><span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground">{filteredDocuments.length}</span></div><p className="mt-1 text-[11px] text-muted-foreground">Search files and inspect local processing results</p></div><div className="flex flex-wrap items-center gap-2"><div className="relative min-w-[190px] flex-1 md:w-[220px] md:flex-none"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents..." aria-label="Search documents" className="h-8 rounded-md pl-8 text-xs" /></div><SelectFilter label="Status" value={statusFilter} options={["All statuses", "Queued", "Processing", "Completed", "Failed"]} onChange={(value) => setStatusFilter(value as StatusFilter)} /><SelectFilter label="Type" value={typeFilter} options={["All types", ...Array.from(new Set(documents.map((item) => item.extension.toUpperCase()))).sort()]} onChange={setTypeFilter} /></div></div>
                  <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-left"><thead><tr className="border-y border-border text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground"><th className="py-2.5 pl-2 font-semibold">Document</th><th className="py-2.5 font-semibold">File size</th><th className="py-2.5 font-semibold">Uploaded</th><th className="py-2.5 font-semibold">Status</th><th className="py-2.5 font-semibold">Duration</th><th className="py-2.5 pr-2 text-right font-semibold">Action</th></tr></thead><tbody>
                    {isLoading ? <tr><td colSpan={6} className="py-12 text-center text-xs text-muted-foreground"><LoaderCircle className="mr-2 inline size-4 animate-spin" />Loading local documents…</td></tr> : filteredDocuments.length === 0 ? <tr><td colSpan={6}><EmptyDocuments hasFilter={documents.length > 0 && (query !== "" || statusFilter !== "All statuses" || typeFilter !== "All types")} onUpload={() => fileInputRef.current?.click()} onReset={() => { setQuery(""); setStatusFilter("All statuses"); setTypeFilter("All types"); }} /></td></tr> : (view === "Overview" ? filteredDocuments.slice(0, 6) : filteredDocuments).map((record) => <DocumentRow key={record.id} record={record} onOpen={() => setSelected(record)} onRetry={() => void retryDocument(record)} onDownload={(formatName) => openReport(record, formatName)} />)}
                  </tbody></table></div>
                  <div className="mt-3 flex flex-col justify-between gap-1 border-t border-border pt-3 text-[10px] text-muted-foreground sm:flex-row"><span>Showing {view === "Overview" ? Math.min(filteredDocuments.length, 6) : filteredDocuments.length} of {documents.length} documents</span><span>All activity shown is stored in this browser</span></div>
                </section>

                <section className="mt-5 rounded-md border border-dashed border-border bg-surface-cream/60 p-5 md:p-6" onDragEnter={(event) => { event.preventDefault(); dragDepth.current += 1; setIsDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setIsDragging(false); } }} onDrop={handleDrop} data-dragging={isDragging}>
                  <div className="flex flex-col items-center justify-center text-center sm:flex-row sm:gap-4 sm:text-left"><div className="grid size-11 shrink-0 place-items-center rounded-md border border-border bg-card text-primary"><Upload className="size-5" /></div><div className="mt-3 min-w-0 sm:mt-0"><h2 className="text-sm font-bold">Drop files to process locally</h2><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">PDF, TXT, CSV, PNG, JPG, WEBP, or GIF · up to 10 MB each</p></div><Button onClick={() => fileInputRef.current?.click()} className="mt-4 h-9 shrink-0 rounded-md px-4 text-xs sm:ml-auto sm:mt-0"><FileUp className="size-3.5" />Choose files</Button></div>
                  <div className="mt-4 flex items-center justify-center gap-2 border-t border-border/80 pt-3 text-[10px] text-muted-foreground"><HardDrive className="size-3.5" />Files remain in this browser. This is not a cloud upload.</div>
                </section>
              </>
            )}
            <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-border pt-4 text-[10px] text-muted-foreground sm:flex-row"><span>DocuFlow Cloud · Local demo mode</span><span>Cloud processing and private server storage are not connected.</span></footer>
          </div>
        </main>
      </div>

      <input ref={fileInputRef} className="sr-only" type="file" multiple accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif,application/pdf,text/plain,text/csv,image/*" aria-label="Choose documents to upload" onChange={(event) => { if (event.target.files) void handleFiles(event.target.files); event.currentTarget.value = ""; }} />
      <DocumentDialog record={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} onRetry={() => { if (selected) void retryDocument(selected); }} onDownload={openReport} onRemove={removeRecord} />
    </div>
  );
}

function Metric({ title, value, note, icon: Icon, tone }: { title: string; value: number; note: string; icon: typeof FileText; tone: "primary" | "amber" | "green" | "red" }) {
  const toneClasses = { primary: "bg-accent text-primary", amber: "bg-status-amber-soft text-status-amber", green: "bg-status-green-soft text-status-green", red: "bg-status-red-soft text-status-red" };
  return <div className="rounded-md border border-border bg-card p-3.5 md:p-4"><div className="flex items-start justify-between gap-2"><div className="text-[11px] font-medium leading-snug text-muted-foreground">{title}</div><div className={`grid size-7 shrink-0 place-items-center rounded-md ${toneClasses[tone]}`}><Icon className="size-3.5" /></div></div><div className="mt-3 font-display text-[25px] font-bold leading-none">{value.toLocaleString()}</div><div className="mt-2 text-[10px] leading-snug text-muted-foreground">{note}</div></div>;
}

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="relative"><span className="sr-only">Filter by {label.toLowerCase()}</span><ListFilter className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /><select value={value} onChange={(event) => onChange(event.target.value)} aria-label={`Filter by ${label.toLowerCase()}`} className="h-8 max-w-[130px] appearance-none rounded-md border border-input bg-background pl-7 pr-6 text-[11px] font-medium text-foreground outline-none focus:ring-1 focus:ring-ring">{options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /></label>;
}

function DocumentRow({ record, onOpen, onRetry, onDownload }: { record: DocumentRecord; onOpen: () => void; onRetry: () => void; onDownload: (format: "json" | "txt") => void }) {
  const Icon = record.extension === "csv" ? FileArchive : ["png", "jpg", "jpeg", "webp", "gif"].includes(record.extension) ? FileImage : FileText;
  return <tr className="group border-b border-border last:border-0 hover:bg-muted/45"><td className="py-3 pl-2"><button onClick={onOpen} className="flex min-w-0 items-center gap-2.5 text-left"><div className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground"><Icon className="size-4" /></div><span className="min-w-0"><span className="block max-w-[230px] truncate text-xs font-semibold text-foreground">{record.name}</span><span className="mt-1 block text-[9px] uppercase text-muted-foreground">{record.extension} · {record.mimeType}</span></span></button></td><td className="py-3 text-[11px] text-muted-foreground">{formatFileSize(record.size)}</td><td className="py-3 text-[11px] text-muted-foreground">{new Date(record.uploadedAt).toLocaleString()}</td><td className="py-3"><StatusPill status={record.status} /></td><td className="py-3 text-[11px] text-muted-foreground">{record.durationMs === null ? "—" : `${record.durationMs} ms`}</td><td className="py-3 pr-2 text-right"><div className="flex items-center justify-end gap-1">{record.status === "Failed" ? <Button variant="ghost" size="icon" title="Retry processing" aria-label={`Retry ${record.name}`} onClick={onRetry} className="size-7"><RefreshCw className="size-3.5" /></Button> : record.report ? <Button variant="ghost" size="icon" title="Download JSON report" aria-label={`Download report for ${record.name}`} onClick={() => onDownload("json")} className="size-7"><ArrowDownToLine className="size-3.5" /></Button> : null}<Button variant="ghost" size="sm" onClick={onOpen} className="h-7 px-2 text-[10px]">Details<ArrowUpRight className="size-3" /></Button></div></td></tr>;
}

function StatusPill({ status }: { status: DocumentStatus }) {
  const style = status === "Completed" ? "bg-status-green-soft text-status-green" : status === "Failed" ? "bg-status-red-soft text-status-red" : status === "Processing" ? "bg-status-amber-soft text-status-amber" : "bg-secondary text-secondary-foreground";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-bold ${style}`}>{status === "Completed" ? <Check className="size-2.5" /> : status === "Failed" ? <AlertCircle className="size-2.5" /> : status === "Processing" ? <LoaderCircle className="size-2.5 animate-spin" /> : <Clock3 className="size-2.5" />}{status}</span>;
}

function EmptyDocuments({ hasFilter, onUpload, onReset }: { hasFilter: boolean; onUpload: () => void; onReset: () => void }) {
  return <div className="flex flex-col items-center py-11 text-center"><div className="grid size-10 place-items-center rounded-md bg-secondary text-primary"><FolderOpen className="size-5" /></div><p className="mt-3 text-xs font-semibold">{hasFilter ? "No documents match these filters" : "Your workspace is ready"}</p><p className="mt-1 max-w-sm text-[10px] leading-relaxed text-muted-foreground">{hasFilter ? "Try adjusting your search or status filters." : "Upload a file to see real local processing status and a generated report here."}</p>{hasFilter ? <Button variant="outline" onClick={onReset} className="mt-3 h-8 rounded-md px-3 text-[10px]"><Filter className="size-3" />Clear filters</Button> : <Button onClick={onUpload} className="mt-3 h-8 rounded-md px-3 text-[10px]"><Upload className="size-3" />Upload first document</Button>}</div>;
}

function EmptyActivity({ onUpload }: { onUpload: () => void }) {
  return <div className="flex flex-col items-center py-7 text-center"><div className="grid size-9 place-items-center rounded-full bg-secondary text-muted-foreground"><Activity className="size-4" /></div><p className="mt-2 text-[11px] font-semibold">Nothing to report yet</p><p className="mt-1 max-w-[220px] text-[10px] leading-relaxed text-muted-foreground">Events appear here as documents move through the local demo.</p><Button variant="ghost" onClick={onUpload} className="mt-1 h-7 px-2 text-[10px] text-primary">Upload a document<ArrowRight className="size-3" /></Button></div>;
}

function EventDot({ kind }: { kind: "info" | "success" | "error" }) {
  const style = kind === "success" ? "bg-status-green-soft text-status-green" : kind === "error" ? "bg-status-red-soft text-status-red" : "bg-secondary text-muted-foreground";
  const Icon = kind === "success" ? CheckCircle2 : kind === "error" ? AlertCircle : Activity;
  return <div className={`grid size-6 shrink-0 place-items-center rounded-full ${style}`}><Icon className="size-3" /></div>;
}

function DocumentDialog({ record, onOpenChange, onRetry, onDownload, onRemove }: { record: DocumentRecord | null; onOpenChange: (open: boolean) => void; onRetry: () => void; onDownload: (record: DocumentRecord, format: "json" | "txt") => void; onRemove: (record: DocumentRecord) => void }) {
  return <Dialog open={record !== null} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-[720px] overflow-y-auto rounded-md p-0"><div className="border-b border-border px-5 py-5 md:px-6"><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-primary"><FileText className="size-5" /></div><div className="min-w-0 flex-1"><DialogHeader><div className="flex flex-wrap items-center gap-2"><DialogTitle className="break-all text-base">{record?.name ?? "Document details"}</DialogTitle>{record && <StatusPill status={record.status} />}</div><DialogDescription className="mt-1 text-left">{record ? `${record.extension.toUpperCase()} · ${formatFileSize(record.size)} · Added ${new Date(record.uploadedAt).toLocaleString()}` : ""}</DialogDescription></DialogHeader></div></div><div className="mt-4 flex flex-wrap gap-2">{record?.report && <><Button onClick={() => record && onDownload(record, "txt")} className="h-8 rounded-md px-3 text-[10px]"><ArrowDownToLine className="size-3.5" />Download report</Button><Button variant="outline" onClick={() => record && onDownload(record, "json")} className="h-8 rounded-md px-3 text-[10px]"><FileJson2 className="size-3.5" />JSON result</Button></>}{record?.status === "Failed" && <Button variant="outline" onClick={onRetry} className="h-8 rounded-md px-3 text-[10px]"><RefreshCw className="size-3.5" />Retry processing</Button>}</div></div>
    {record && <div className="grid gap-6 px-5 py-5 md:grid-cols-[1fr_.9fr] md:px-6"><div className="min-w-0"><section><h3 className="text-xs font-bold">Extracted metadata</h3><p className="mt-1 text-[10px] text-muted-foreground">Values measured from this file in the browser demo</p><div className="mt-3 grid gap-0.5">{Object.entries({ "File name": record.name, "File format": record.extension.toUpperCase(), "MIME type": record.mimeType, "File size": formatFileSize(record.size), ...(record.durationMs === null ? {} : { "Processing duration": `${record.durationMs} ms` }), ...(record.pageCount === null ? {} : { "Page count": record.pageCount }), ...record.metadata }).map(([key, value], index) => <div key={`${key}-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-3 border-b border-border py-2 text-[10px] last:border-0"><span className="text-muted-foreground">{key}</span><span className="break-words text-right font-medium">{String(value)}</span></div>)}</div></section>
      {record.error && <div className="mt-5 rounded-md border border-status-red/25 bg-status-red-soft p-3"><div className="flex items-center gap-2 text-[11px] font-bold text-status-red"><AlertCircle className="size-3.5" />Processing error</div><p className="mb-0 mt-1.5 break-words text-[10px] leading-relaxed text-status-red">{record.error}</p></div>}
      {record.report && <section className="mt-5"><h3 className="text-xs font-bold">Readable report</h3><div className="mt-2 rounded-md border border-border bg-muted/50 p-3"><p className="text-[10px] leading-relaxed">{record.report.summary}</p><div className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-card p-2 font-mono text-[9px] leading-relaxed text-muted-foreground">{record.report.extractedText}</div></div></section>}
      <p className="mb-0 mt-4 flex items-start gap-2 text-[9px] leading-relaxed text-muted-foreground"><Info className="mt-0.5 size-3 shrink-0" />This report was generated locally. PDF text extraction and image OCR are not connected in demo mode.</p></div>
    <section><div className="flex items-center justify-between"><div><h3 className="text-xs font-bold">Processing events</h3><p className="mt-1 text-[10px] text-muted-foreground">Timestamped browser demo log</p></div><span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold">{record.events.length}</span></div><div className="mt-3 grid">{[...record.events].reverse().map((event) => <div key={event.id} className="relative flex gap-2.5 pb-4 last:pb-0"><div className="relative z-10"><EventDot kind={event.kind} /></div><div className="min-w-0 flex-1 pt-0.5"><p className="mb-0 text-[10px] font-semibold">{event.title}</p><p className="mb-0 mt-1 break-words text-[9px] leading-relaxed text-muted-foreground">{event.detail}</p><p className="mb-0 mt-1 text-[8px] text-muted-foreground">{new Date(event.at).toLocaleString()}</p></div></div>)}</div><Button variant="ghost" onClick={() => void onRemove(record)} className="mt-5 h-8 w-full justify-center rounded-md text-[10px] text-destructive hover:bg-status-red-soft hover:text-destructive"><X className="size-3.5" />Remove from this browser</Button></section></div>}
  </DialogContent></Dialog>;
}

function WorkflowView() {
  const steps = [
    { name: "Choose a file", detail: "Drag and drop or select PDF, TXT, CSV, or common image files.", icon: Upload, state: "Runs here" },
    { name: "Validate locally", detail: "Check file extension, size limit, empty-file rule, and PDF signature.", icon: ShieldCheck, state: "Runs here" },
    { name: "Store for this browser", detail: "The original file and report are saved in this browser's IndexedDB.", icon: HardDrive, state: "Runs here" },
    { name: "Extract available metadata", detail: "Read text/CSV content; inspect PDF header and available page objects.", icon: FileText, state: "Runs here" },
    { name: "Generate report and event log", detail: "Create a structured JSON result, readable report, and timestamped status events.", icon: FileJson2, state: "Runs here" },
    { name: "Private object storage", detail: "No storage bucket, upload link, or server-side file access is configured.", icon: Cloud, state: "Not connected" },
    { name: "Event trigger and cloud function", detail: "Uploads do not invoke an object-created event or serverless worker.", icon: Workflow, state: "Not connected" },
    { name: "Cloud database and logs", detail: "Counts and activity above come only from this browser—not cloud metrics.", icon: Database, state: "Not connected" },
  ];
  return <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,.7fr)]"><section className="rounded-md border border-border bg-card p-4 md:p-5"><div><h2 className="text-sm font-bold">Document lifecycle</h2><p className="mt-1 text-[11px] text-muted-foreground">A transparent view of local demo steps and cloud steps not yet connected</p></div><div className="mt-5 grid gap-0">{steps.map((step, index) => { const Icon = step.icon; const active = step.state === "Runs here"; return <div key={step.name} className="relative flex gap-3 pb-5 last:pb-0"><div className="relative z-10 grid size-8 shrink-0 place-items-center rounded-md border border-border bg-background text-primary"><Icon className="size-4" /></div>{index < steps.length - 1 && <div className="absolute bottom-0 left-[15px] top-8 border-l border-dashed border-border" />}<div className="min-w-0 flex-1 pt-0.5"><div className="flex flex-wrap items-center gap-2"><h3 className="text-xs font-bold">{step.name}</h3><span className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase ${active ? "bg-status-green-soft text-status-green" : "bg-status-amber-soft text-status-amber"}`}>{step.state}</span></div><p className="mb-0 mt-1 text-[10px] leading-relaxed text-muted-foreground">{step.detail}</p></div></div>; })}</div></section><aside className="h-fit rounded-md border border-status-amber/25 bg-status-amber-soft/50 p-4 md:p-5"><div className="flex items-center gap-2 text-primary"><Info className="size-4" /><h2 className="text-xs font-bold">Demo mode, not cloud execution</h2></div><p className="mb-0 mt-3 text-[11px] leading-relaxed text-muted-foreground">Uploads, processing, reports, and logs are real browser actions. A cloud object store, event trigger, serverless worker, and shared database have not been connected to this workflow.</p><div className="mt-4 grid gap-2 border-t border-status-amber/20 pt-4 text-[10px]"><div className="flex items-center gap-2"><CheckCircle2 className="size-3.5 text-status-green" />File validation and local report generation</div><div className="flex items-center gap-2"><CheckCircle2 className="size-3.5 text-status-green" />Status transitions and browser event history</div><div className="flex items-center gap-2"><X className="size-3.5 text-status-red" />Cloud storage or actual serverless execution</div><div className="flex items-center gap-2"><X className="size-3.5 text-status-red" />Server-side PDF text extraction and OCR</div></div><div className="mt-4 rounded-md border border-border bg-card p-3"><div className="flex items-center gap-2 text-[10px] font-bold"><HardDrive className="size-3.5 text-primary" />Privacy boundary</div><p className="mb-0 mt-1.5 text-[9px] leading-relaxed text-muted-foreground">Files and reports remain in this browser profile. Clearing site data removes them. Do not upload confidential files to the demo.</p></div></aside></div>;
}