export interface ProgressReporterOptions {
  quiet?: boolean;
}

export class ProgressReporter {
  private encoder = new TextEncoder();
  private cursorHidden = false;

  constructor(private options: ProgressReporterOptions = {}) {
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
    Deno.stdout.writeSync(this.encoder.encode(output));
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
    Deno.stdout.writeSync(this.encoder.encode("\x1b[?25l"));
    this.cursorHidden = true;
  }

  private showCursor(): void {
    Deno.stdout.writeSync(this.encoder.encode("\x1b[?25h"));
    this.cursorHidden = false;
  }
}
