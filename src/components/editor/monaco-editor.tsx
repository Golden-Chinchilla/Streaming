"use client";

import { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { editor as MonacoEditorType } from "monaco-editor";
import { DataFormat } from "@/lib/types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export type EditorMarker = {
  message: string;
  line: number;
  column: number;
};

type Props = {
  value: string;
  format: DataFormat;
  onChange: (value: string) => void;
  marker?: EditorMarker | null;
};

export function SankeyMonacoEditor({ value, format, onChange, marker }: Props) {
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
      language={format === "csv" ? "plaintext" : "json"}
      value={value}
      onChange={(nextValue) => onChange(nextValue ?? "")}
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
        applyMarkers();
      }}
      onValidate={() => applyMarkers()}
      theme="vs-dark"
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
