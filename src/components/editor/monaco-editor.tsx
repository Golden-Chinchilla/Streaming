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
};

type Props = {
  value: string;
  format: DataFormat;
  theme: "light" | "dark";
  onChange: (value: string) => void;
  marker?: EditorMarker | null;
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
        { token: "delimiter", foreground: "64748b" },
        { token: "number", foreground: "22d3ee" },
        { token: "string", foreground: "fbbf24" },
        { token: "identifier", foreground: "cbd5e1" },
      ],
      colors: {},
    });

    monaco.editor.defineTheme(STREAMING_LIGHT_THEME_ID, {
      base: "vs",
      inherit: true,
      rules: [
        { token: "delimiter", foreground: "475569" },
        { token: "number", foreground: "0891b2" },
        { token: "string", foreground: "b45309" },
        { token: "identifier", foreground: "334155" },
      ],
      colors: {},
    });

    streamingThemeReady = true;
  }
}

export function SankeyMonacoEditor({ value, format, theme, onChange, marker }: Props) {
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
        severity: monacoRef.current.MarkerSeverity.Error,
      },
    ]);
  }, [marker]);

  useEffect(() => {
    applyMarkers();
  }, [applyMarkers, value]);

  return (
    <MonacoEditor
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
        wordWrap: "on",
        smoothScrolling: true,
        tabSize: 2,
      }}
    />
  );
}
