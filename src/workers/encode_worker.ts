/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { encodeToM4A } from "../lib/encoding.ts";
import type { EncodingOptions } from "../lib/encoding.ts";
import { formatError } from "../utils/error_utils.ts";

interface WorkerTask {
  id: number;
  inputPath: string;
  outputPath: string;
  trackDisplayName: string;
  options: EncodingOptions;
}

interface WorkerMessage {
  id: number;
  type: "log" | "error" | "done" | "progress";
  message?: string;
  error?: string;
  inputPath?: string;
  outputPath?: string;
}

self.onmessage = async (e: MessageEvent<WorkerTask>) => {
  const { id, inputPath, outputPath, trackDisplayName, options } = e.data;

  const postLog = (message: string) => {
    self.postMessage({
      id,
      type: "log",
      message,
    } as WorkerMessage);
  };

  const postError = (error: string) => {
    self.postMessage({
      id,
      type: "error",
      error,
    } as WorkerMessage);
  };

  try {
    postLog(`💿 Encoding '${trackDisplayName}'`);

    // Format output path display in compact format
    const inputDir = inputPath.substring(0, inputPath.lastIndexOf("/"));
    const inputFilename = inputPath.substring(inputPath.lastIndexOf("/") + 1);
    const outputDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
    const outputFilename = outputPath.substring(
      outputPath.lastIndexOf("/") + 1,
    );

    // Extract base name and extensions
    const inputExtIndex = inputFilename.lastIndexOf(".");
    const outputExtIndex = outputFilename.lastIndexOf(".");
    const baseName = inputFilename.substring(0, inputExtIndex);
    const inputExt = inputFilename.substring(inputExtIndex);
    const outputExt = outputFilename.substring(outputExtIndex);

    if (inputDir === outputDir) {
      // Same directory: show in compact format
      postLog(`   🎧 ${inputDir}/${baseName}: ${inputExt} → ${outputExt}`);
    } else {
      // Different directories: show full paths
      postLog(`   🎧 ${inputPath} → ${outputPath}`);
    }

    // Perform the encoding
    const result = await encodeToM4A(inputPath, outputPath, options);

    // Log metadata info if available
    if (result.metadataInfo) {
      postLog(`   ${result.metadataInfo}`);
    }

    if (result.success) {
      postLog(`   ✅ ${result.success}`);
    }

    // Send completion message
    self.postMessage({
      id,
      type: "done",
      inputPath,
      outputPath,
    } as WorkerMessage);
  } catch (error) {
    const errorMessage = formatError(error);
    postError(`Error encoding ${inputPath}: ${errorMessage}`);

    // Still send done message to indicate worker has finished
    self.postMessage({
      id,
      type: "done",
      error: errorMessage,
    } as WorkerMessage);
  }
};
