import { exitWithError } from "./console_output.ts";

export function formatError(error: unknown, context?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return context ? `${context}: ${message}` : message;
}

export function logError(error: unknown, context: string, quiet = false): void {
  if (!quiet) {
    console.error(`❌ ${formatError(error, context)}`);
  }
}

export function exitWithFormattedError(error: unknown, context: string): never {
  exitWithError(formatError(error, context));
}
