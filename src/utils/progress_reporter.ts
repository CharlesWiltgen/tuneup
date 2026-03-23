export interface ProgressReporterOptions {
  quiet?: boolean;
  stream?: "stdout" | "stderr";
}

export class ProgressReporter {
  private encoder = new TextEncoder();
  private cursorHidden = false;
  private writer: { writeSync(p: Uint8Array): number };

  constructor(private options: ProgressReporterOptions = {}) {
    this.writer = options.stream === "stderr" ? Deno.stderr : Deno.stdout;
    if (!options.quiet) {
      this.hideCursor();
    }
  }

  update(current: number, total: number, message?: string): void {
    if (this.options.quiet) return;

    const percent = Math.round((current / total) * 100);
    const output = `\x1b[2K\r→ ${
      message || "Processing"
    }: ${current}/${total} (${percent}%)`;
    this.writer.writeSync(this.encoder.encode(output));
  }

  complete(message: string): void {
    if (!this.options.quiet) {
      console.log(`\x1b[2K\r✅ ${message}`);
    }
  }

  section(title: string): void {
    if (!this.options.quiet) {
      console.log(`\n--- ${title} ---`);
    }
  }

  dispose(): void {
    if (this.cursorHidden) {
      this.showCursor();
    }
  }

  private hideCursor(): void {
    this.writer.writeSync(this.encoder.encode("\x1b[?25l"));
    this.cursorHidden = true;
  }

  private showCursor(): void {
    this.writer.writeSync(this.encoder.encode("\x1b[?25h"));
    this.cursorHidden = false;
  }
}
