"use client";

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { buttonDangerSm, buttonPrimarySm, buttonSecondarySm } from "@/components/common/interaction-styles";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type DialogState =
  | {
    type: "confirm";
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  }
  | {
    type: "prompt";
    options: PromptOptions;
    resolve: (value: string | null) => void;
  };

export function useAppDialog() {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const closeDialog = useCallback(() => {
    setDialog(null);
    setPromptValue("");
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialog({ type: "confirm", options, resolve });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setPromptValue(options.defaultValue ?? "");
      setDialog({ type: "prompt", options, resolve });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (!dialog) return;
      if (dialog.type === "confirm") {
        dialog.resolve(false);
      } else {
        dialog.resolve(null);
      }
    };
  }, [dialog]);

  const dialogNode = useMemo<ReactNode>(() => {
    if (!dialog) return null;

    const isDanger = dialog.type === "confirm" && dialog.options.tone === "danger";
    const confirmButtonClass = isDanger ? buttonDangerSm : buttonPrimarySm;

    return (
      <div className="fixed inset-0 z-120 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-overlay)_80%,transparent)] p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl border border-border bg-[color-mix(in_srgb,var(--bg-elevated)_92%,transparent)] p-5 shadow-xl">
          <p className="text-sm font-semibold text-foreground">{dialog.options.title}</p>
          {dialog.options.message && (
            <p className="mt-2 text-sm text-(--text-secondary)">{dialog.options.message}</p>
          )}

          {dialog.type === "prompt" && (
            <input
              autoFocus
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              placeholder={dialog.options.placeholder}
              className="mt-3 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  dialog.resolve(promptValue);
                  closeDialog();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  dialog.resolve(null);
                  closeDialog();
                }
              }}
            />
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => {
                if (dialog.type === "confirm") {
                  dialog.resolve(false);
                } else {
                  dialog.resolve(null);
                }
                closeDialog();
              }}
              className={buttonSecondarySm}
            >
              {dialog.options.cancelLabel ?? "Cancel"}
            </button>
            <button
              onClick={() => {
                if (dialog.type === "confirm") {
                  dialog.resolve(true);
                } else {
                  dialog.resolve(promptValue);
                }
                closeDialog();
              }}
              className={confirmButtonClass}
            >
              {dialog.options.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </div>
      </div>
    );
  }, [closeDialog, dialog, promptValue]);

  return { confirm, prompt, dialogNode };
}

