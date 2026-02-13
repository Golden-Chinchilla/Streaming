"use client";

import { AppIssue } from "@/lib/issues";

type Props = {
  issues: AppIssue[];
  className?: string;
};

function tone(level: AppIssue["level"]) {
  if (level === "error") return "border-red-200 bg-red-50 text-red-700";
  if (level === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  if (level === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
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
