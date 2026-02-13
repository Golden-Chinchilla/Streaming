"use client";

import { openDB } from "idb";
import { AppPreferences, SankeyDocument, TemplateSummary } from "@/lib/types";

const DB_NAME = "streaming-editor-db";
const STORE_NAME = "app";
const CURRENT_DOC_KEY = "current-document";
const CURRENT_DOC_ID_KEY = "current-document-id";
const DOCUMENTS_KEY = "documents";
const RECENT_DOCS_KEY = "recent-documents";
const USER_TEMPLATES_KEY = "user-templates";
const APP_PREFERENCES_KEY = "app-preferences";
const RECENT_LIMIT = 8;
const DEFAULT_APP_PREFERENCES: AppPreferences = {
  defaultTheme: "light",
  defaultPerformanceMode: "auto",
  defaultExportTransparentBg: false,
  defaultExportFileTemplate: "{title}-{date}",
};

async function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

export async function saveCurrentDocument(document: SankeyDocument) {
  const db = await getDb();
  await db.put(STORE_NAME, document, CURRENT_DOC_KEY);
  await db.put(STORE_NAME, document.id, CURRENT_DOC_ID_KEY);
}

export async function loadCurrentDocument() {
  const db = await getDb();
  const currentId = (await db.get(STORE_NAME, CURRENT_DOC_ID_KEY)) as string | undefined;
  if (currentId) {
    const documents = await loadAllDocuments();
    const hit = documents.find((item) => item.id === currentId);
    if (hit) return hit;
  }
  return (await db.get(STORE_NAME, CURRENT_DOC_KEY)) as SankeyDocument | undefined;
}

export async function saveRecentDocument(document: SankeyDocument) {
  const db = await getDb();
  const existing = ((await db.get(STORE_NAME, RECENT_DOCS_KEY)) as SankeyDocument[] | undefined) ?? [];
  const deduped = existing.filter((item) => item.id !== document.id);
  const next = [document, ...deduped].slice(0, RECENT_LIMIT);
  await db.put(STORE_NAME, next, RECENT_DOCS_KEY);
}

export async function loadRecentDocuments() {
  const db = await getDb();
  return (((await db.get(STORE_NAME, RECENT_DOCS_KEY)) as SankeyDocument[] | undefined) ?? []).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export async function loadAllDocuments() {
  const db = await getDb();
  const docs = ((await db.get(STORE_NAME, DOCUMENTS_KEY)) as SankeyDocument[] | undefined) ?? [];
  if (docs.length > 0) {
    return docs.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  const legacyCurrent = (await db.get(STORE_NAME, CURRENT_DOC_KEY)) as SankeyDocument | undefined;
  if (!legacyCurrent) return [];
  await db.put(STORE_NAME, [legacyCurrent], DOCUMENTS_KEY);
  await db.put(STORE_NAME, legacyCurrent.id, CURRENT_DOC_ID_KEY);
  return [legacyCurrent];
}

export async function loadDocumentById(docId: string) {
  const docs = await loadAllDocuments();
  return docs.find((item) => item.id === docId);
}

export async function upsertDocument(document: SankeyDocument) {
  const db = await getDb();
  const docs = await loadAllDocuments();
  const next = [document, ...docs.filter((item) => item.id !== document.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  await db.put(STORE_NAME, next, DOCUMENTS_KEY);
}

export async function setCurrentDocumentId(docId: string) {
  const db = await getDb();
  await db.put(STORE_NAME, docId, CURRENT_DOC_ID_KEY);
}

export async function deleteDocumentById(docId: string) {
  const db = await getDb();
  const docs = await loadAllDocuments();
  const next = docs.filter((item) => item.id !== docId);
  await db.put(STORE_NAME, next, DOCUMENTS_KEY);

  const recent = (((await db.get(STORE_NAME, RECENT_DOCS_KEY)) as SankeyDocument[] | undefined) ?? []).filter(
    (item) => item.id !== docId,
  );
  await db.put(STORE_NAME, recent, RECENT_DOCS_KEY);

  const currentId = (await db.get(STORE_NAME, CURRENT_DOC_ID_KEY)) as string | undefined;
  if (currentId === docId) {
    await db.put(STORE_NAME, next[0]?.id ?? null, CURRENT_DOC_ID_KEY);
    if (next[0]) {
      await db.put(STORE_NAME, next[0], CURRENT_DOC_KEY);
    }
  }
}

export async function loadUserTemplates() {
  const db = await getDb();
  return ((await db.get(STORE_NAME, USER_TEMPLATES_KEY)) as TemplateSummary[] | undefined) ?? [];
}

export async function loadUserTemplateById(templateId: string) {
  const templates = await loadUserTemplates();
  return templates.find((item) => item.id === templateId);
}

export async function upsertUserTemplate(template: TemplateSummary) {
  const db = await getDb();
  const templates = await loadUserTemplates();
  const next = [template, ...templates.filter((item) => item.id !== template.id)];
  await db.put(STORE_NAME, next, USER_TEMPLATES_KEY);
}

export async function deleteUserTemplate(templateId: string) {
  const db = await getDb();
  const templates = await loadUserTemplates();
  const next = templates.filter((item) => item.id !== templateId);
  await db.put(STORE_NAME, next, USER_TEMPLATES_KEY);
}

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
  };
}

export async function saveAppPreferences(preferences: AppPreferences): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, preferences, APP_PREFERENCES_KEY);
}
