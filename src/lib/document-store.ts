import type { DocumentRecord } from "@/lib/documents";

const DATABASE_NAME = "docuflow-local-demo";
const STORE_NAME = "documents";
const DATABASE_VERSION = 1;

function openDocumentDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser does not support local document storage."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local document storage."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDocumentDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not access local documents."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Local document storage failed."));
    };
  });
}

export async function listDocuments() {
  const records = await withStore<DocumentRecord[]>("readonly", (store) => store.getAll());
  return records.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function saveDocument(record: DocumentRecord) {
  return withStore<IDBValidKey>("readwrite", (store) => store.put(record));
}

export function removeDocument(id: string) {
  return withStore<undefined>("readwrite", (store) => store.delete(id));
}