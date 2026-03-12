export type LintIssue = {
  type: "issue";
  rule: string;
  severity: "error" | "warning" | "info";
  file?: string;
  album?: string;
  message: string;
};
