"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";

export type LinkEditDraft = {
  source: string;
  target: string;
  value: number;
};

export type NodeEditDraft = {
  id: string;
  nextId: string;
};

type BaseProps = {
  nodeOptions: string[];
  error: string | null;
  canSave?: boolean;
  anchor?: { x: number; y: number } | null;
  onClose: () => void;
};

type LinkModalProps = BaseProps & {
  mode: "link";
  draft: LinkEditDraft;
  related?: {
    sameSourceCount: number;
    sameTargetCount: number;
  };
  onJumpSameSource?: () => void;
  onJumpSameTarget?: () => void;
  onDraftChange: (draft: LinkEditDraft) => void;
  onSave: () => void;
  onDelete: () => void;
};

type NodeModalProps = BaseProps & {
  mode: "node";
  draft: NodeEditDraft;
  stats?: {
    incomingCount: number;
    outgoingCount: number;
    incomingValue: number;
    outgoingValue: number;
  };
  onDraftChange: (draft: NodeEditDraft) => void;
  onSave: () => void;
};

type Props = LinkModalProps | NodeModalProps;

export function FlowEditModal(props: Props) {
  const [viewport, setViewport] = useState({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 720 : window.innerHeight,
  });

  useEffect(() => {
    const onResize = () =>
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props]);

  const title = useMemo(
    () => (props.mode === "link" ? "Edit Flow" : "Edit Node"),
    [props.mode],
  );

  const modalStyle = useMemo<CSSProperties>(() => {
    if (!props.anchor) return {};
    const horizontalPadding = 24;
    const verticalPadding = 24;
    const preferredWidth = Math.min(
      props.mode === "link" ? 420 : 380,
      viewport.width - horizontalPadding * 2,
    );
    const estimatedHeight = props.mode === "link" ? 360 : 320;
    const maxLeft = Math.max(horizontalPadding, viewport.width - preferredWidth - horizontalPadding);
    const maxTop = Math.max(verticalPadding, viewport.height - estimatedHeight - verticalPadding);
    const left = Math.min(maxLeft, Math.max(horizontalPadding, props.anchor.x + 14));
    const top = Math.min(maxTop, Math.max(verticalPadding, props.anchor.y - 26));
    return {
      width: preferredWidth,
      maxWidth: preferredWidth,
      margin: 0,
      position: "fixed",
      left,
      top,
    };
  }, [props.anchor, props.mode, viewport.height, viewport.width]);

  return (
    <div
      className="fixed inset-0 z-125 flex items-center justify-center bg-transparent p-4"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-(--bg-elevated) p-4 shadow-xl"
        style={modalStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-semibold text-foreground">{title}</p>
          {props.mode === "link" && (
            <button
              type="button"
              onClick={props.onDelete}
              className="rounded-md border border-[color-mix(in_srgb,var(--error)_50%,transparent)] px-3 py-1.5 text-xs font-medium text-[color-mix(in_srgb,var(--error)_78%,white)]"
            >
              Delete
            </button>
          )}
        </div>

        {props.mode === "link" ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (props.canSave === false) return;
              props.onSave();
            }}
          >
            <label className="block text-sm text-(--text-secondary)">
              From
              <select
                value={props.draft.source}
                onChange={(event) =>
                  props.onDraftChange({ ...props.draft, source: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-foreground"
              >
                {props.nodeOptions.map((nodeId) => (
                  <option key={`link-from-${nodeId}`} value={nodeId}>
                    {nodeId}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-(--text-secondary)">
              To
              <select
                value={props.draft.target}
                onChange={(event) =>
                  props.onDraftChange({ ...props.draft, target: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-foreground"
              >
                {props.nodeOptions.map((nodeId) => (
                  <option key={`link-to-${nodeId}`} value={nodeId}>
                    {nodeId}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-(--text-secondary)">
              Value
              <input
                type="number"
                min={0.0001}
                step="any"
                value={props.draft.value}
                autoFocus
                onChange={(event) =>
                  props.onDraftChange({
                    ...props.draft,
                    value: Number(event.target.value),
                  })
                }
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-foreground"
              />
            </label>
            {(props.related || props.onJumpSameSource || props.onJumpSameTarget) && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={props.onJumpSameSource}
                  disabled={!props.onJumpSameSource || (props.related?.sameSourceCount ?? 0) <= 0}
                  className="rounded-md border border-border px-2.5 py-1.5 text-xs text-(--text-secondary) disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Next Same From ({props.related?.sameSourceCount ?? 0})
                </button>
                <button
                  type="button"
                  onClick={props.onJumpSameTarget}
                  disabled={!props.onJumpSameTarget || (props.related?.sameTargetCount ?? 0) <= 0}
                  className="rounded-md border border-border px-2.5 py-1.5 text-xs text-(--text-secondary) disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Next Same To ({props.related?.sameTargetCount ?? 0})
                </button>
              </div>
            )}
            <button type="submit" className="hidden" aria-hidden="true" />
          </form>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (props.canSave === false) return;
              props.onSave();
            }}
          >
            <label className="block text-sm text-(--text-secondary)">
              Node Name
              <input
                type="text"
                value={props.draft.nextId}
                autoFocus
                onChange={(event) =>
                  props.onDraftChange({ ...props.draft, nextId: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-foreground"
              />
            </label>
            {props.stats && (
              <div className="grid grid-cols-2 gap-2 text-xs text-(--text-secondary)">
                <div className="rounded-md border border-border bg-surface px-2 py-1.5">
                  Incoming: {props.stats.incomingCount} ({props.stats.incomingValue.toLocaleString()})
                </div>
                <div className="rounded-md border border-border bg-surface px-2 py-1.5">
                  Outgoing: {props.stats.outgoingCount} ({props.stats.outgoingValue.toLocaleString()})
                </div>
              </div>
            )}
            <p className="text-xs text-(--text-muted)">
              Renaming updates all links that reference this node.
            </p>
            <button type="submit" className="hidden" aria-hidden="true" />
          </form>
        )}

        {props.error && (
          <p className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--error)_50%,transparent)] bg-[color-mix(in_srgb,var(--error)_14%,transparent)] px-3 py-2 text-xs text-[color-mix(in_srgb,var(--error)_78%,white)]">
            {props.error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-(--text-secondary)"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={props.onSave}
            disabled={props.canSave === false}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-(--text-on-primary) disabled:cursor-not-allowed disabled:opacity-45"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
