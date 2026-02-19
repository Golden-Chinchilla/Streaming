"use client";

import { openDB, IDBPDatabase } from "idb";
import { AppPreferences, BaseDocument, Folder } from "@/lib/types";

const DB_NAME = "streaming-editor-db";
const DB_VERSION = 2;
const STORE_NAME = "app";
const CURRENT_DOC_ID_KEY = "current-document-id";
const DOCUMENTS_KEY = "documents";
const FOLDERS_KEY = "folders";
const APP_PREFERENCES_KEY = "app-preferences";
const OPEN_DOCUMENT_IDS_KEY = "open-document-ids";

const DEFAULT_APP_PREFERENCES: AppPreferences = {
  defaultTheme: "light",
  defaultPerformanceMode: "auto",
  defaultExportTransparentBg: false,
  defaultExportFileTemplate: "{title}-{date}",
  defaultDiagramType: null,
};

/* ------------------------------------------------------------------ */
/*  Database initialisation & migration                               */
/* ------------------------------------------------------------------ */

async function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }

      if (oldVersion < 2) {
        // Migrate v1 SankeyDocuments → v2 BaseDocuments
        const store = tx.objectStore(STORE_NAME);
        migrateV1ToV2(store);
      }
    },
  });
}

/**
 * Migrates legacy SankeyDocument[] stored under "documents" to BaseDocument[].
 * Also migrates the legacy "current-document" single-doc key.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function migrateV1ToV2(store: any) {
  try {
    // Migrate documents array
    const legacyDocs = (await store.get(DOCUMENTS_KEY)) as unknown[] | undefined;
    if (Array.isArray(legacyDocs) && legacyDocs.length > 0) {
      const migrated = legacyDocs.map(migrateSankeyDocToBase);
      await store.put(migrated, DOCUMENTS_KEY);
    }

    // Migrate single current-document
    const legacyCurrent = await store.get("current-document");
    if (legacyCurrent && typeof legacyCurrent === "object" && "id" in legacyCurrent) {
      // We no longer store a separate current-document blob, just the ID
      await store.put((legacyCurrent as { id: string }).id, CURRENT_DOC_ID_KEY);
      await store.delete("current-document");
    }

    // Clean up removed keys
    await store.delete("recent-documents");
    await store.delete("recent-template-ids");
    await store.delete("user-templates");

    // Initialise empty folders if not present
    const existingFolders = await store.get(FOLDERS_KEY);
    if (!existingFolders) {
      await store.put([], FOLDERS_KEY);
    }
  } catch (err) {
    console.error("[storage] v1→v2 migration error:", err);
  }
}

/**
 * Converts a legacy SankeyDocument (v1) into a BaseDocument (v2).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateSankeyDocToBase(legacy: any): BaseDocument {
  return {
    id: legacy.id ?? crypto.randomUUID(),
    title: legacy.title ?? "Untitled",
    diagramType: "sankey",
    folderId: null,
    createdAt: legacy.updatedAt ?? Date.now(),
    updatedAt: legacy.updatedAt ?? Date.now(),
    data: {
      format: legacy.format ?? "json",
      editorText: legacy.editorText ?? "",
      style: legacy.style ?? {},
      nodePositions: legacy.nodePositions ?? {},
      nodeStyles: legacy.nodeStyles ?? {},
      linkStyles: legacy.linkStyles ?? {},
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Document CRUD                                                     */
/* ------------------------------------------------------------------ */

export async function loadAllDocuments(): Promise<BaseDocument[]> {
  const db = await getDb();
  const docs =
    ((await db.get(STORE_NAME, DOCUMENTS_KEY)) as BaseDocument[] | undefined) ?? [];
  return docs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadDocumentById(
  docId: string,
): Promise<BaseDocument | undefined> {
  const docs = await loadAllDocuments();
  return docs.find((d) => d.id === docId);
}

export async function loadDocumentsByFolder(
  folderId: string | null,
): Promise<BaseDocument[]> {
  const docs = await loadAllDocuments();
  return docs.filter((d) => d.folderId === folderId);
}

export async function upsertDocument(document: BaseDocument): Promise<void> {
  const db = await getDb();
  const docs = await loadAllDocuments();
  const next = [document, ...docs.filter((d) => d.id !== document.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  await db.put(STORE_NAME, next, DOCUMENTS_KEY);
}

export async function deleteDocumentById(docId: string): Promise<void> {
  await deleteDocumentsByIds([docId]);
}

export async function deleteDocumentsByIds(docIds: string[]): Promise<void> {
  const db = await getDb();
  const docs = await loadAllDocuments();
  const toDelete = new Set(docIds);
  const next = docs.filter((d) => !toDelete.has(d.id));
  await db.put(STORE_NAME, next, DOCUMENTS_KEY);

  // If the current document was deleted, switch to the next available
  const currentId = (await db.get(STORE_NAME, CURRENT_DOC_ID_KEY)) as
    | string
    | undefined;

  if (currentId && toDelete.has(currentId)) {
    await db.put(STORE_NAME, next[0]?.id ?? null, CURRENT_DOC_ID_KEY);
  }
}

export async function moveDocument(
  docId: string,
  folderId: string | null,
): Promise<void> {
  const doc = await loadDocumentById(docId);
  if (!doc) return;
  await upsertDocument({ ...doc, folderId, updatedAt: Date.now() });
}

/* ------------------------------------------------------------------ */
/*  Current document pointer                                          */
/* ------------------------------------------------------------------ */

export async function setCurrentDocumentId(docId: string): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, docId, CURRENT_DOC_ID_KEY);
}

export async function loadCurrentDocument(): Promise<BaseDocument | undefined> {
  const db = await getDb();
  const currentId = (await db.get(STORE_NAME, CURRENT_DOC_ID_KEY)) as
    | string
    | undefined;
  if (!currentId) return undefined;
  return loadDocumentById(currentId);
}

/* ------------------------------------------------------------------ */
/*  Folder CRUD                                                       */
/* ------------------------------------------------------------------ */

export async function loadFolders(): Promise<Folder[]> {
  const db = await getDb();
  return ((await db.get(STORE_NAME, FOLDERS_KEY)) as Folder[] | undefined) ?? [];
}

export async function createFolder(folder: Folder): Promise<void> {
  const db = await getDb();
  const folders = await loadFolders();
  await db.put(STORE_NAME, [...folders, folder], FOLDERS_KEY);
}

export async function renameFolder(
  folderId: string,
  name: string,
): Promise<void> {
  const db = await getDb();
  const folders = await loadFolders();
  const next = folders.map((f) => (f.id === folderId ? { ...f, name } : f));
  await db.put(STORE_NAME, next, FOLDERS_KEY);
}

export async function moveFolderTo(
  folderId: string,
  parentId: string | null,
): Promise<void> {
  const db = await getDb();
  const folders = await loadFolders();
  const next = folders.map((f) =>
    f.id === folderId ? { ...f, parentId } : f,
  );
  await db.put(STORE_NAME, next, FOLDERS_KEY);
}

export async function deleteFolder(folderId: string): Promise<void> {
  const db = await getDb();
  const folders = await loadFolders();

  // Collect this folder and all descendant folder IDs
  const toDelete = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    toDelete.add(id);
    for (const f of folders) {
      if (f.parentId === id && !toDelete.has(f.id)) {
        queue.push(f.id);
      }
    }
  }

  const nextFolders = folders.filter((f) => !toDelete.has(f.id));
  await db.put(STORE_NAME, nextFolders, FOLDERS_KEY);

  // Move documents in deleted folders to root
  const docs = await loadAllDocuments();
  const affectedDocs = docs.filter(
    (d) => d.folderId !== null && toDelete.has(d.folderId),
  );
  for (const doc of affectedDocs) {
    await upsertDocument({ ...doc, folderId: null });
  }
}

/* ------------------------------------------------------------------ */
/*  App preferences                                                   */
/* ------------------------------------------------------------------ */

export async function loadAppPreferences(): Promise<AppPreferences> {
  const db = await getDb();
  const raw = (await db.get(STORE_NAME, APP_PREFERENCES_KEY)) as
    | Partial<AppPreferences>
    | undefined;
  if (!raw) return DEFAULT_APP_PREFERENCES;
  return {
    defaultTheme: raw.defaultTheme === "dark" ? "dark" : "light",
    defaultPerformanceMode:
      raw.defaultPerformanceMode === "quality" ||
        raw.defaultPerformanceMode === "balanced" ||
        raw.defaultPerformanceMode === "performance" ||
        raw.defaultPerformanceMode === "auto"
        ? raw.defaultPerformanceMode
        : "auto",
    defaultExportTransparentBg:
      typeof raw.defaultExportTransparentBg === "boolean"
        ? raw.defaultExportTransparentBg
        : false,
    defaultExportFileTemplate:
      typeof raw.defaultExportFileTemplate === "string" &&
        raw.defaultExportFileTemplate.trim().length > 0
        ? raw.defaultExportFileTemplate
        : "{title}-{date}",
    defaultDiagramType:
      raw.defaultDiagramType === "sankey" || raw.defaultDiagramType === "swimlane"
        ? raw.defaultDiagramType
        : null,
  };
}

export async function saveAppPreferences(
  preferences: AppPreferences,
): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, preferences, APP_PREFERENCES_KEY);
}

/* ------------------------------------------------------------------ */
/*  Open Documents Persistence                                        */
/* ------------------------------------------------------------------ */

export async function loadOpenDocumentIds(): Promise<string[]> {
  const db = await getDb();
  const ids = (await db.get(STORE_NAME, OPEN_DOCUMENT_IDS_KEY)) as string[] | undefined;
  return ids ?? [];
}

export async function saveOpenDocumentIds(ids: string[]): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, ids, OPEN_DOCUMENT_IDS_KEY);
}
