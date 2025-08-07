import { Command } from "jsr:@cliffy/command@1.0.0-rc.7";
import { defaultCommand } from "../commands/default.ts";
import { easyCommand } from "../commands/easy.ts";
import { encodeCommand } from "../commands/encode.ts";
import { processCommand } from "../commands/process.ts";
import { xRayCommand } from "../commands/x-ray.ts";
import { VERSION } from "../version.ts";
import { dirname, fromFileUrl, join } from "jsr:@std/path";
import { loadSync } from "jsr:@std/dotenv";

const __dirname = dirname(fromFileUrl(import.meta.url));

export function setupCLI() {
  // Load environment variables from .env file
  try {
    loadSync({ export: true, envPath: join(__dirname, "..", ".env") });
  } catch {
    // ignore missing or invalid .env
  }

  const program = new Command()
    .name("amusic")
    .version(VERSION)
    .description(
      "Calculate ReplayGain and embed AcousticID fingerprints and IDs",
    )
    // Default command options
    .option("-f, --force", "Force reprocessing even if tags exist")
    .option(
      "-q, --quiet",
      "Suppress informational output (errors still shown)",
      { default: false },
    )
    .option(
      "--show-tags",
      "Display existing AcoustID tags and exit",
    )
    .option(
      "--dry-run",
      "Simulate processing without writing tags",
    )
    .option(
      "--api-key <key:string>",
      "AcoustID API key (required for lookups)",
      { default: Deno.env.get("ACOUSTID_API_KEY") },
    )
    .option(
      "--debug",
      "Enable debug output for troubleshooting",
      { default: false },
    )
    .arguments("<...files:string>")
    .action(defaultCommand);

  // Add easy subcommand
  program
    .command(
      "easy <library:string>",
      "Calculate ReplayGain and AcousticID for each album in a library root directory (each album in its own folder)",
    )
    .option(
      "-f, --force",
      "Force reprocessing AcoustID fingerprints even if tags exist",
    )
    .option(
      "-q, --quiet",
      "Suppress informational output (errors still shown)",
      { default: false },
    )
    .option(
      "--dry-run",
      "Simulate processing without writing tags",
      { default: false },
    )
    .option(
      "--api-key <key:string>",
      "AcoustID API key (required for lookups)",
      { default: Deno.env.get("ACOUSTID_API_KEY") },
    )
    .action(easyCommand);

  // Add encode subcommand
  program
    .command(
      "encode <files...:string>",
      "Encode audio files to M4A/AAC format. By default only encodes from lossless sources (WAV, FLAC, M4A)",
    )
    .option(
      "--force-lossy-transcodes",
      "Allow transcoding from lossy formats (MP3, OGG) - quality loss warning",
      { default: false },
    )
    .option(
      "-o, --output-dir <dir:string>",
      "Output directory for encoded files (defaults: source directory)",
    )
    .option(
      "--flatten-output",
      "Put all output files in a single directory when using --output-dir",
      { default: false },
    )
    .option(
      "-q, --quiet",
      "Suppress informational output (errors still shown)",
      { default: false },
    )
    .option(
      "--dry-run",
      "Simulate encoding without writing files",
      { default: false },
    )
    .action(encodeCommand);

  // Add unified process command
  program
    .command(
      "process <files...:string>",
      "Process audio files with multiple operations in a single pass (encoding, ReplayGain, AcoustID)",
    )
    .option(
      "--encode",
      "Encode files to M4A/AAC format",
      { default: false },
    )
    .option(
      "--replay-gain",
      "Calculate and apply ReplayGain metadata",
      { default: false },
    )
    .option(
      "--acoust-id",
      "Generate and embed AcoustID fingerprints",
      { default: false },
    )
    .option(
      "--singles <patterns...:string>",
      "Folder patterns to treat as singles instead of albums",
      { collect: true },
    )
    .option(
      "--force-lossy-transcodes",
      "Allow encoding from lossy formats (MP3, OGG) - quality loss warning.",
      { default: false },
    )
    .option(
      "-o, --output-dir <dir:string>",
      "Output directory for encoded files (defaults: source directory)",
    )
    .option(
      "--flatten-output",
      "Put all output files in one directory when using --output-dir",
      { default: false },
    )
    .option(
      "-f, --force",
      "Force reprocessing even if tags exist",
      { default: false },
    )
    .option(
      "-q, --quiet",
      "Suppress informational output (errors still shown)",
      { default: false },
    )
    .option(
      "--dry-run",
      "Simulate processing without writing files or tags",
      { default: false },
    )
    .option(
      "--api-key <key:string>",
      "AcoustID API key (required for AcoustID lookups)",
      { default: Deno.env.get("ACOUSTID_API_KEY") },
    )
    .action(processCommand);

  // Add x-ray subcommand for testing/debugging
  program
    .command(
      "x-ray <files...:string>",
      "X-ray the music library structure without processing files",
    )
    .option(
      "--for-encoding",
      "Validate MPEG-4 codecs as if preparing for encoding",
      { default: false },
    )
    .option(
      "--singles <patterns...:string>",
      "Folder patterns to treat as singles instead of albums",
      { collect: true },
    )
    .option(
      "--debug",
      "Enable debug output",
      { default: false },
    )
    .action(xRayCommand);

  return program;
}
