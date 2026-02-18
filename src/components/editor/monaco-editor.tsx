"use client";

import { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { editor as MonacoEditorType } from "monaco-editor";
import { DataFormat } from "@/lib/types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
const CSV_LANGUAGE_ID = "streaming-csv";
const STREAMING_DARK_THEME_ID = "streaming-vs-dark";
const STREAMING_LIGHT_THEME_ID = "streaming-vs-light";
let csvLanguageReady = false;
let streamingThemeReady = false;

export type EditorMarker = {
  message: string;
  line: number;
  column: number;
  severity?: number;
};

type Props = {
  value: string;
  format: DataFormat;
  theme: "light" | "dark";
  onChange: (value: string) => void;
  marker?: EditorMarker | null;
  className?: string;
};

function ensureEditorLanguageAndTheme(monaco: typeof import("monaco-editor")) {
  if (!csvLanguageReady) {
    monaco.languages.register({ id: CSV_LANGUAGE_ID });
    monaco.languages.setMonarchTokensProvider(CSV_LANGUAGE_ID, {
      tokenizer: {
        root: [
          [/"/, { token: "string.quote", next: "@quoted" }],
          [/-?\d*\.?\d+(?:[eE][+-]?\d+)?/, "number"],
          [/,/, "delimiter"],
          [/[^,\r\n]+/, "identifier"],
        ],
        quoted: [
          [/[^\"]+/, "string"],
          [/""/, "string.escape"],
          [/"/, { token: "string.quote", next: "@pop" }],
        ],
      },
    });
    csvLanguageReady = true;
  }

  if (!streamingThemeReady) {
    monaco.editor.defineTheme(STREAMING_DARK_THEME_ID, {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "delimiter", foreground: "94a3b8" },
        { token: "number", foreground: "67e8f9" },
        { token: "string", foreground: "f472b6" },
        { token: "identifier", foreground: "e2e8f0" },
      ],
      colors: {
        "editor.background": "#00000000",
        "editor.foreground": "#e2e8f0",
        "editor.lineHighlightBackground": "#ffffff08",
        "editorCursor.foreground": "#f1f5f9",
        "editor.selectionBackground": "#38bdf84d",
        "editor.inactiveSelectionBackground": "#33415588",
        "editorLineNumber.foreground": "#64748b",
        "editorLineNumber.activeForeground": "#cbd5e1",
      },
    });

    monaco.editor.defineTheme(STREAMING_LIGHT_THEME_ID, {
      base: "vs",
      inherit: true,
      rules: [
        { token: "delimiter", foreground: "64748b" },
        { token: "number", foreground: "0e7490" },
        { token: "string", foreground: "db2777" },
        { token: "identifier", foreground: "0f172a" },
      ],
      colors: {
        "editor.background": "#ffffff",
        "editor.lineHighlightBackground": "#e2e8f088",
        "editorCursor.foreground": "#0f172a",
        "editor.selectionBackground": "#7dd3fc66",
        "editorLineNumber.foreground": "#94a3b8",
        "editorLineNumber.activeForeground": "#475569",
      },
    });

    streamingThemeReady = true;
  }
}

export function SankeyMonacoEditor({ value, format, theme, onChange, marker, className }: Props) {
  const editorRef = useRef<MonacoEditorType.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);

  const applyMarkers = useCallback(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    if (!marker) {
      monacoRef.current.editor.setModelMarkers(model, "streaming-parse", []);
      return;
    }

    monacoRef.current.editor.setModelMarkers(model, "streaming-parse", [
      {
        startLineNumber: marker.line,
        startColumn: marker.column,
        endLineNumber: marker.line,
        endColumn: marker.column + 1,
        message: marker.message,
        severity: marker.severity ?? monacoRef.current.MarkerSeverity.Error,
      },
    ]);
  }, [marker]);

  useEffect(() => {
    applyMarkers();
  }, [applyMarkers, value]);

  return (
    <MonacoEditor
      className={className}
      height="100%"
      language={format === "csv" ? CSV_LANGUAGE_ID : "json"}
      value={value}
      onChange={(nextValue) => onChange(nextValue ?? "")}
      beforeMount={(monaco) => {
        ensureEditorLanguageAndTheme(monaco);
      }}
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
        ensureEditorLanguageAndTheme(monaco);
        applyMarkers();
      }}
      onValidate={() => applyMarkers()}
      theme={theme === "dark" ? STREAMING_DARK_THEME_ID : STREAMING_LIGHT_THEME_ID}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        wordWrap: "on",
        smoothScrolling: true,
        tabSize: 2,
        cursorSmoothCaretAnimation: "on",
        padding: { top: 10, bottom: 10 },
        scrollBeyondLastLine: false,
      }}
    />
  );
}
