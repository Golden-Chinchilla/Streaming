export type IssueLevel = "error" | "warning" | "info" | "success";

export type AppIssue = {
  id: string;
  level: IssueLevel;
  title: string;
  description?: string;
  details?: string[];
};
