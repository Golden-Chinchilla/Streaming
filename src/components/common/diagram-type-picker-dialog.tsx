"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { DiagramType } from "@/lib/types";
import { DiagramPlugin } from "@/lib/diagram-registry";

type DiagramTypePickerDialogProps = {
  isOpen: boolean;
  plugins: DiagramPlugin[];
  onClose: () => void;
  onSelect: (type: DiagramType) => void | Promise<void>;
  title?: string;
  confirmHint?: string;
  isSubmitting?: boolean;
  rememberAsDefault?: boolean;
  onRememberAsDefaultChange?: (value: boolean) => void;
  closeOnBackdrop?: boolean;
};

export function DiagramTypePickerDialog({
  isOpen,
  plugins,
  onClose,
  onSelect,
  title = "Choose Diagram Type",
  confirmHint = "Pick a diagram type to continue.",
  isSubmitting = false,
  rememberAsDefault = false,
  onRememberAsDefaultChange,
  closeOnBackdrop = true,
}: DiagramTypePickerDialogProps) {
  const handleRequestClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (!closeOnBackdrop) return;
            if (event.target === event.currentTarget) {
              handleRequestClose();
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-(--shadow-lg)"
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">{title}</h2>
                <p className="text-xs text-text-secondary">{confirmHint}</p>
              </div>
              <button
                type="button"
                onClick={handleRequestClose}
                className="rounded-full p-2 text-text-secondary transition-colors hover:bg-surface-container hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {plugins.map((plugin) => (
                <button
                  key={plugin.type}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void onSelect(plugin.type)}
                  className="group flex cursor-pointer flex-col items-start gap-3 rounded-xl border border-border bg-surface-container/30 p-4 text-left transition-all hover:border-primary/40 hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="rounded-lg bg-primary/10 p-2 text-primary transition-colors group-hover:bg-primary group-hover:text-on-primary">
                    <plugin.icon className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">{plugin.displayName}</h3>
                    <p className="text-xs text-text-secondary">{plugin.description}</p>
                  </div>
                </button>
              ))}
            </div>

            {onRememberAsDefaultChange && (
              <label className="flex cursor-pointer items-center gap-2 border-t border-border px-5 py-3 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={rememberAsDefault}
                  onChange={(event) => onRememberAsDefaultChange(event.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                Remember this type as default for quick create
              </label>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
