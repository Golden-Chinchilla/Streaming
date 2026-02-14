"use client";

import { AppIssue } from "@/lib/issues";

type Props = {
  issues: AppIssue[];
  className?: string;
};

function tone(level: AppIssue["level"]) {
  if (level === "error") {
    return "border-[color:color-mix(in_srgb,var(--error)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--error)_14%,transparent)] text-[color:color-mix(in_srgb,var(--error)_78%,white)]";
  }
  if (level === "warning") {
    return "border-[color:color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--warning)_14%,transparent)] text-[color:color-mix(in_srgb,var(--warning)_78%,white)]";
  }
  if (level === "success") {
    return "border-[color:color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--success)_14%,transparent)] text-[color:color-mix(in_srgb,var(--success)_78%,white)]";
  }
  return "border-[color:color-mix(in_srgb,var(--border-base)_75%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-secondary)_75%,transparent)] text-[var(--text-secondary)]";
}

export function IssueCenter({ issues, className }: Props) {
  if (issues.length === 0) return null;

  return (
    <div className={className}>
      <div className="space-y-2">
        {issues.map((issue) => (
          <div key={issue.id} className={`rounded-lg border px-3 py-2 text-xs ${tone(issue.level)}`}>
            <p className="font-medium">{issue.title}</p>
            {issue.description && <p className="mt-1">{issue.description}</p>}
            {issue.details && issue.details.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {issue.details.map((item, index) => (
                  <li key={`${issue.id}-detail-${index}`}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
