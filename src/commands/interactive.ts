import { Checkbox } from "@cliffy/prompt/checkbox";
import { Confirm } from "@cliffy/prompt/confirm";
import { Input } from "@cliffy/prompt/input";
import { Secret } from "@cliffy/prompt/secret";
import { processCommand } from "./process.ts";
import type { ProcessCommandOptions } from "./process.ts";

type ProcessCommandFn = (
  options: ProcessCommandOptions,
  ...paths: string[]
) => Promise<void>;

export interface Prompter {
  input(
    message: string,
    options?: {
      validate?: (value: string) => boolean | string;
      default?: string;
    },
  ): Promise<string>;
  checkbox(
    message: string,
    options: { name: string; value: string }[],
  ): Promise<string[]>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  secret(
    message: string,
    options?: { validate?: (value: string) => boolean | string },
  ): Promise<string>;
}

const cliffy: Prompter = {
  async input(message, options) {
    return await Input.prompt({
      message,
      validate: options?.validate,
      default: options?.default,
    });
  },
  async checkbox(message, options) {
    return await Checkbox.prompt({
      message,
      options,
      minOptions: 1,
    });
  },
  async confirm(message, defaultValue) {
    return await Confirm.prompt({
      message,
      default: defaultValue,
    });
  },
  async secret(message, options) {
    return await Secret.prompt({
      message,
      validate: options?.validate,
    });
  },
};

const OPERATIONS = [
  { name: "Encode (to M4A/AAC)", value: "encode" },
  { name: "ReplayGain", value: "replayGain" },
  { name: "AcoustID", value: "acoustID" },
  { name: "SoundCheck", value: "soundCheck" },
];

export async function interactiveCommand(
  path?: string,
  processCommandFn: ProcessCommandFn = processCommand,
  prompter: Prompter = cliffy,
): Promise<void> {
  try {
    const targetPath = path ?? await prompter.input("Path to music folder", {
      validate: (value) => {
        if (!value.trim()) return "Path is required";
        try {
          const stat = Deno.statSync(value);
          if (!stat.isDirectory) return "Path must be a directory";
        } catch {
          return "Path does not exist";
        }
        return true;
      },
    });

    const selectedOps = await prompter.checkbox(
      "Select operations to perform",
      OPERATIONS,
    );

    const ops = new Set(selectedOps);

    let outputDir: string | undefined;
    let forceLossyTranscodes = false;
    let apiKey: string | undefined;

    if (ops.has("encode")) {
      const dir = await prompter.input("Output directory for encoded files", {
        default: "(source directory)",
      });
      if (dir !== "(source directory)") outputDir = dir;

      forceLossyTranscodes = await prompter.confirm(
        "Allow transcoding from lossy formats (MP3, OGG)?",
        false,
      );
    }

    if (ops.has("acoustID")) {
      const envKey = Deno.env.get("ACOUSTID_API_KEY");
      if (envKey) {
        apiKey = envKey;
      } else {
        apiKey = await prompter.secret("AcoustID API key", {
          validate: (value) => {
            if (!value.trim()) {
              return "API key is required for AcoustID lookups";
            }
            return true;
          },
        });
      }
    }

    const dryRun = await prompter.confirm(
      "Dry run (simulate without writing)?",
      false,
    );

    const force = await prompter.confirm(
      "Force reprocessing (overwrite existing tags)?",
      false,
    );

    console.log("\n--- Summary ---");
    console.log(`  Path:       ${targetPath}`);
    console.log(`  Operations: ${selectedOps.join(", ")}`);
    if (outputDir) console.log(`  Output dir: ${outputDir}`);
    if (dryRun) console.log(`  Dry run:    yes`);
    if (force) console.log(`  Force:      yes`);
    console.log("");

    const confirmed = await prompter.confirm("Proceed?", true);

    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }

    const options: ProcessCommandOptions = {
      quiet: false,
      encode: ops.has("encode"),
      replayGain: ops.has("replayGain"),
      acoustID: ops.has("acoustID"),
      soundCheck: ops.has("soundCheck"),
      forceLossyTranscodes,
      outputDir,
      apiKey,
      dryRun,
      force,
    };

    await processCommandFn(options, targetPath);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("canceled") || error.message.includes("aborted"))
    ) {
      console.log("\nCancelled.");
      return;
    }
    throw error;
  }
}
