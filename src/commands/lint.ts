import { listAudioFilesRecursive } from "../lib/fastest_audio_scan_recursive.ts";
import {
  type LintOptions,
  type LintResult,
  runLint,
} from "../lib/lint_engine.ts";
import { SEVERITY_ORDER } from "../lib/lint.ts";
import type { LintIssue, LintSummary, Severity } from "../lib/lint.ts";

const VALID_SEVERITIES = new Set(Object.keys(SEVERITY_ORDER));

const SEVERITY_ICONS: Record<string, string> = {
  error: "\u274C",
  warning: "\u26A0\uFE0F",
  info: "\u2139\uFE0F",
};

function formatIssueTerminal(issue: LintIssue): string {
  const icon = SEVERITY_ICONS[issue.severity];
  if (issue.file) {
    return `${icon} ${issue.file}: ${issue.rule} \u2014 ${issue.message}`;
  }
  return `${icon} Album "${issue.album}": ${issue.rule} \u2014 ${issue.message}`;
}

function formatSummaryTerminal(summary: LintSummary): string {
  const lines = [
    "Summary:",
    `  ${summary.errors} error${
      summary.errors !== 1 ? "s" : ""
    } \u00B7 ${summary.warnings} warning${
      summary.warnings !== 1 ? "s" : ""
    } \u00B7 ${summary.info} info`,
    `  ${summary.filesOk} file${
      summary.filesOk !== 1 ? "s" : ""
    } OK \u00B7 ${summary.filesWithIssues} file${
      summary.filesWithIssues !== 1 ? "s" : ""
    } with issues \u00B7 ${summary.albumIssues} album issue${
      summary.albumIssues !== 1 ? "s" : ""
    }`,
  ];
  return lines.join("\n");
}

function writeStderr(text: string) {
  Deno.stderr.writeSync(new TextEncoder().encode(text));
}

export async function lintCommand(
  options: {
    deep: boolean;
    json: boolean;
    severity: string;
    quiet: boolean;
  },
  path: string,
): Promise<void> {
  if (!VALID_SEVERITIES.has(options.severity)) {
    console.error(
      `Error: Invalid severity "${options.severity}". Must be one of: ${
        [...VALID_SEVERITIES].join(", ")
      }`,
    );
    Deno.exit(2);
    return;
  }

  let files: string[];
  try {
    const stat = await Deno.stat(path);
    if (stat.isFile) {
      files = [path];
    } else if (stat.isDirectory) {
      files = listAudioFilesRecursive([path]);
    } else {
      console.error(`Error: ${path} is not a file or directory`);
      Deno.exit(2);
      return;
    }
  } catch (err) {
    console.error(
      `Error: Cannot access ${path}: ${
        err instanceof Error ? err.message : err
      }`,
    );
    Deno.exit(2);
    return;
  }

  if (files.length === 0) {
    console.error(`Error: No audio files found in ${path}`);
    Deno.exit(2);
    return;
  }

  if (!options.quiet && !options.json) {
    writeStderr(`Scanning ${files.length.toLocaleString()} files...\n\n`);
  }

  const lintOptions: LintOptions = {
    deep: options.deep,
    severity: options.severity as Severity,
    quiet: options.quiet,
    json: options.json,
  };

  const terminalIssues: LintIssue[] = [];
  let lastProgressUpdate = 0;

  const result: LintResult = await runLint(
    files,
    lintOptions,
    (issue) => {
      if (options.json) {
        console.log(JSON.stringify(issue));
      } else {
        terminalIssues.push(issue);
      }
    },
    (processed, total) => {
      if (options.quiet || options.json) return;
      const now = Date.now();
      if (
        processed === total || processed % 1000 === 0 ||
        now - lastProgressUpdate > 1000
      ) {
        writeStderr(
          `\x1b[2K\rScanning: ${processed.toLocaleString()}/${total.toLocaleString()} files`,
        );
        lastProgressUpdate = now;
      }
    },
  );

  if (options.json) {
    console.log(JSON.stringify(result.summary));
  } else {
    if (!options.quiet) {
      writeStderr(`\x1b[2K\r`);
    }
    for (const issue of terminalIssues) {
      console.log(formatIssueTerminal(issue));
    }
    if (terminalIssues.length > 0) {
      console.log();
    }
    console.log(formatSummaryTerminal(result.summary));
  }

  Deno.exit(result.summary.errors > 0 ? 1 : 0);
}
