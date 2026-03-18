import { Command } from "@cliffy/command";
import { defaultCommand } from "../commands/default.ts";
import { interactiveCommand } from "../commands/interactive.ts";
import { easyCommand } from "../commands/easy.ts";
import { encodeCommand } from "../commands/encode.ts";
import { enrichCommand } from "../commands/enrich.ts";
import { lintCommand } from "../commands/lint.ts";
import { processCommand } from "../commands/process.ts";
import { soundcheckCommand } from "../commands/soundcheck.ts";
import { xRayCommand } from "../commands/x-ray.ts";
import { VERSION } from "../version.ts";
import { dirname, fromFileUrl, join } from "@std/path";
import { loadSync } from "@std/dotenv";

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
      "A music library toolkit powered by taglib-wasm.\n\n" +
        "Supports MP3, M4A/MP4, FLAC, OGG, and WAV files.\n\n" +
        "Run without a subcommand for interactive mode.",
    )
    .example(
      "Show tags",
      "amusic --show-tags /path/to/album/",
    )
    .example(
      "Process album",
      "amusic process --encode --replay-gain --acoust-id --soundcheck /path/to/album/",
    )
    .example(
      "Process library",
      "amusic easy /path/to/music/ --api-key $ACOUSTID_API_KEY",
    )
    .example(
      "Encode to M4A",
      "amusic encode --output-dir ./encoded *.flac",
    )
    .example(
      "Lint library",
      "amusic lint /path/to/music/",
    )
    // Interactive mode as default action
    .option(
      "--show-tags",
      "Display existing tags (AcoustID, ReplayGain, MusicBrainz, and more)",
    )
    .option(
      "-q, --quiet",
      "Suppress informational output (errors still shown)",
      { default: false },
    )
    .option(
      "--debug",
      "Enable debug output for troubleshooting",
      { default: false },
    )
    .option(
      "--api-key <key:string>",
      "AcoustID API key (required for lookups)",
      { default: Deno.env.get("ACOUSTID_API_KEY") },
    )
    .arguments("[path:string]")
    .action(async (options: Record<string, unknown>, path?: string) => {
      if (options.showTags && path) {
        await defaultCommand(
          {
            quiet: options.quiet as boolean,
            showTags: true,
            debug: options.debug as boolean,
          },
          path,
        );
        return;
      }
      await interactiveCommand(path);
    });

  // Add easy subcommand
  program
    .command(
      "easy <library:string>",
      "Calculate ReplayGain and AcoustID for each album in a library root directory (each album in its own folder)",
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
      "-q, --quiet",
      "Suppress informational output (errors still shown)",
      { default: false },
    )
    .option(
      "--dry-run",
      "Simulate encoding without writing files",
      { default: false },
    )
    .option(
      "--columns <number:integer>",
      "Override terminal width for line wrapping",
    )
    .action(encodeCommand);

  // Add unified process command
  program
    .command(
      "process <files...:string>",
      "Process audio files with multiple operations in a single pass (encoding, ReplayGain, AcoustID, SoundCheck)",
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
      "--soundcheck",
      "Generate and embed Apple SoundCheck (ITUNNORM) data",
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
    .action(
      (options: Record<string, unknown>, ...files: string[]) =>
        processCommand(
          {
            ...options,
            // Cliffy converts --acoust-id to acoustId; ProcessCommandOptions uses acoustID
            acoustID: options.acoustId as boolean ?? false,
          } as Parameters<typeof processCommand>[0],
          ...files,
        ),
    );

  // Add soundcheck subcommand
  program
    .command(
      "soundcheck <files...:string>",
      "Generate and embed Apple SoundCheck (ITUNNORM) data for audio files",
    )
    .option(
      "-f, --force",
      "Force reprocessing even if ITUNNORM already exists",
      { default: false },
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
    .action(soundcheckCommand);

  // Add lint subcommand
  program
    .command(
      "lint <path:string>",
      "Scan music library for tagging problems, inconsistencies, and file integrity issues",
    )
    .option(
      "--deep",
      "Enable media integrity checks (header validation)",
      { default: false },
    )
    .option(
      "--json",
      "Output as JSONL (one issue per line, summary last line)",
      { default: false },
    )
    .option(
      "--severity <level:string>",
      "Minimum severity to report: error, warning (default), info",
      { default: "warning" },
    )
    .option(
      "-q, --quiet",
      "Suppress progress output",
      { default: false },
    )
    .action(lintCommand);

  // Add enrich subcommand
  program
    .command(
      "enrich <path:string>",
      "Enrich music metadata using MusicBrainz (requires existing MusicBrainz recording IDs from AcoustID processing)",
    )
    .option(
      "--dangerously-overwrite-tags",
      "Apply all changes without prompting (overwrites existing metadata)",
      { default: false },
    )
    .option(
      "--dry-run",
      "Show what would change without writing",
      { default: false },
    )
    .option(
      "-q, --quiet",
      "Suppress progress output (errors still shown)",
      { default: false },
    )
    .option(
      "-f, --force",
      "Re-enrich even if previously enriched",
      { default: false },
    )
    .action(enrichCommand);

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
