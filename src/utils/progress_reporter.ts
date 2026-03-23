export interface ProgressReporterOptions {
  quiet?: boolean;
  stream?: "stdout" | "stderr";
}

export class ProgressReporter {
  private encoder = new TextEncoder();
  private cursorHidden = false;
  private writer: { writeSync(p: Uint8Array): number };
  private spinnerFrames = [
    "\u28CB",
    "\u2819",
    "\u2839",
    "\u2838",
    "\u283C",
    "\u2834",
    "\u2826",
    "\u2827",
    "\u2807",
    "\u280F",
  ];
  private spinnerFrame = 0;
  private spinnerIntervalId: number | null = null;
  private spinnerMessage = "";

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

  discoveryCallback(): (
    phase: string,
    current: number,
    total?: number,
  ) => void {
    return (phase: string, current: number, total?: number) => {
      if (this.options.quiet) return;
      const count = total ? `${current}/${total}` : `${current}`;
      const output = `\x1b[2K\r→ ${phase}: ${count} files`;
      this.writer.writeSync(this.encoder.encode(output));
    };
  }

  startSpinner(message: string): void {
    if (this.options.quiet) return;
    this.stopSpinner();
    if (!this.cursorHidden) this.hideCursor();
    this.spinnerMessage = message;
    this.renderSpinner();
    this.spinnerIntervalId = setInterval(() => this.renderSpinner(), 80);
  }

  stopSpinner(message?: string): void {
    if (this.spinnerIntervalId !== null) {
      clearInterval(this.spinnerIntervalId);
      this.spinnerIntervalId = null;
    }
    if (this.options.quiet) return;
    if (message) {
      this.writer.writeSync(
        this.encoder.encode(`\x1b[2K\r\u2705 ${message}\n`),
      );
    } else {
      this.writer.writeSync(this.encoder.encode("\x1b[2K\r"));
    }
  }

  dispose(): void {
    this.stopSpinner();
    if (this.cursorHidden) {
      this.showCursor();
    }
  }

  private renderSpinner(): void {
    const frame = this.spinnerFrames[this.spinnerFrame];
    this.spinnerFrame = (this.spinnerFrame + 1) % this.spinnerFrames.length;
    this.writer.writeSync(
      this.encoder.encode(`\x1b[2K\r${frame} ${this.spinnerMessage}`),
    );
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
