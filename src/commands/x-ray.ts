import { discoverMusic } from "../utils/fast_discovery.ts";
import { Table } from "jsr:@cliffy/table@1.0.0-rc.7";

interface DiscoverOptions {
  forEncoding?: boolean;
  singles?: string[];
  debug?: boolean;
}

/**
 * X-ray command for examining the music library structure
 */
export async function xRayCommand(
  options: DiscoverOptions,
  ...paths: string[]
): Promise<void> {
  console.log("🩻 X-raying music library structure...\n");

  const startTime = performance.now();

  const discovery = await discoverMusic(paths, {
    forEncoding: options.forEncoding,
    singlePatterns: options.singles,
    debug: options.debug,
    onProgress: (phase, current, total) => {
      Deno.stdout.writeSync(
        new TextEncoder().encode(
          `\x1b[2K\r→ ${phase}: ${current}${total ? `/${total}` : ""} files`,
        ),
      );
    },
  });

  const endTime = performance.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // Clear progress line
  Deno.stdout.writeSync(new TextEncoder().encode("\x1b[2K\r"));

  console.log(`✅ X-ray complete in ${duration}s\n`);

  // Summary statistics
  console.log("📊 Summary:");
  console.log(`  Total files: ${discovery.totalFiles}`);
  console.log(`  Albums: ${discovery.albums.size}`);
  console.log(`  Compilations: ${discovery.compilations.size}`);
  console.log(`  Singles: ${discovery.singles.length}`);

  if (options.forEncoding && discovery.skippedFiles) {
    console.log(`  Files to encode: ${discovery.filesToEncode?.length || 0}`);
    const aacCount = discovery.skippedFiles.filter((f) =>
      f.reason === "aac"
    ).length;
    const alreadyEncodedCount = discovery.skippedFiles.filter((f) =>
      f.reason === "already-encoded"
    ).length;
    if (aacCount > 0) {
      console.log(`  Skipped (AAC): ${aacCount}`);
    }
    if (alreadyEncodedCount > 0) {
      console.log(`  Skipped (already encoded): ${alreadyEncodedCount}`);
    }
  }

  console.log();

  // Albums table
  if (discovery.albums.size > 0) {
    console.log("💿 Albums:");
    const albumTable = new Table()
      .header(["Directory", "Tracks"])
      .body(
        Array.from(discovery.albums.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([dir, files]) => [dir, files.length.toString()]),
      );
    console.log(albumTable.toString());
    console.log();
  }

  // Compilations table
  if (discovery.compilations.size > 0) {
    console.log("🎭 Compilations:");
    const compilationTable = new Table()
      .header(["Directory", "Tracks"])
      .body(
        Array.from(discovery.compilations.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([dir, files]) => [dir, files.length.toString()]),
      );
    console.log(compilationTable.toString());
    console.log();
  }

  // Singles summary
  if (discovery.singles.length > 0) {
    console.log(`🎵 Singles: ${discovery.singles.length} files`);
    if (discovery.singles.length <= 20) {
      for (const file of discovery.singles.sort()) {
        console.log(`  - ${file}`);
      }
    } else {
      // Show first 10 and last 10
      const sorted = discovery.singles.sort();
      for (let i = 0; i < 10; i++) {
        console.log(`  - ${sorted[i]}`);
      }
      console.log(`  ... ${discovery.singles.length - 20} more files ...`);
      for (let i = sorted.length - 10; i < sorted.length; i++) {
        console.log(`  - ${sorted[i]}`);
      }
    }
    console.log();
  }

  // Skipped files for encoding
  if (
    options.forEncoding && discovery.skippedFiles &&
    discovery.skippedFiles.length > 0
  ) {
    // Group skipped files by reason
    const aacFiles = discovery.skippedFiles.filter((f) => f.reason === "aac");
    const alreadyEncoded = discovery.skippedFiles.filter((f) =>
      f.reason === "already-encoded"
    );

    if (aacFiles.length > 0) {
      console.log("⏭️  Skipped files (already AAC):");
      if (aacFiles.length <= 10) {
        for (const skip of aacFiles) {
          console.log(`  - ${skip.path} (${skip.codec || "AAC"})`);
        }
      } else {
        // Show first 5 and count
        for (let i = 0; i < 5; i++) {
          const skip = aacFiles[i];
          console.log(`  - ${skip.path} (${skip.codec || "AAC"})`);
        }
        console.log(`  ... and ${aacFiles.length - 5} more AAC files`);
      }
      console.log();
    }

    if (alreadyEncoded.length > 0) {
      console.log("🔄 Skipped files (already encoded):");
      if (alreadyEncoded.length <= 10) {
        for (const skip of alreadyEncoded) {
          const encodedName = skip.encodedPath?.substring(
            skip.encodedPath.lastIndexOf("/") + 1,
          ) || "encoded version";
          console.log(`  - ${skip.path} (exists as ${encodedName})`);
        }
      } else {
        // Show first 5 and count
        for (let i = 0; i < 5; i++) {
          const skip = alreadyEncoded[i];
          const encodedName = skip.encodedPath?.substring(
            skip.encodedPath.lastIndexOf("/") + 1,
          ) || "encoded version";
          console.log(`  - ${skip.path} (exists as ${encodedName})`);
        }
        console.log(
          `  ... and ${alreadyEncoded.length - 5} more already encoded files`,
        );
      }
      console.log();
    }
  }

  // Performance stats
  console.log("⚡ Performance:");
  console.log(
    `  Files/second: ${
      (discovery.totalFiles / parseFloat(duration)).toFixed(0)
    }`,
  );
  console.log(`  Discovery time: ${duration}s`);

  if (options.forEncoding) {
    const mpeg4Count = discovery.scan.allFiles.filter((f) =>
      f.toLowerCase().endsWith(".m4a") || f.toLowerCase().endsWith(".mp4")
    ).length;
    if (mpeg4Count > 0) {
      console.log(`  MPEG-4 files validated: ${mpeg4Count}`);
    }
  }
}
