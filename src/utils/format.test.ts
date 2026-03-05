import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  formatBitrate,
  formatChannels,
  formatDuration,
  formatFileSize,
  formatSampleRate,
} from "./format.ts";

describe("formatDuration", () => {
  it("should format zero seconds", () => {
    assertEquals(formatDuration(0), "0:00");
  });

  it("should format seconds less than a minute", () => {
    assertEquals(formatDuration(45), "0:45");
  });

  it("should format exact minutes", () => {
    assertEquals(formatDuration(120), "2:00");
  });

  it("should format minutes and seconds", () => {
    assertEquals(formatDuration(195), "3:15");
  });

  it("should pad single-digit seconds with leading zero", () => {
    assertEquals(formatDuration(61), "1:01");
    assertEquals(formatDuration(69), "1:09");
  });

  it("should truncate fractional seconds", () => {
    assertEquals(formatDuration(90.7), "1:30");
    assertEquals(formatDuration(61.999), "1:01");
  });

  it("should handle large durations", () => {
    assertEquals(formatDuration(3661), "61:01");
  });
});

describe("formatChannels", () => {
  it("should return 'Mono' for 1 channel", () => {
    assertEquals(formatChannels(1), "Mono");
  });

  it("should return 'Stereo' for 2 channels", () => {
    assertEquals(formatChannels(2), "Stereo");
  });

  it("should return channel count for 3+ channels", () => {
    assertEquals(formatChannels(6), "6 channels");
    assertEquals(formatChannels(8), "8 channels");
  });

  it("should return 'Unknown' for undefined", () => {
    assertEquals(formatChannels(undefined), "Unknown");
  });

  it("should return 'Unknown' for 0", () => {
    assertEquals(formatChannels(0), "Unknown");
  });
});

describe("formatFileSize", () => {
  it("should format bytes", () => {
    assertEquals(formatFileSize(500), "500.0 B");
  });

  it("should format kilobytes", () => {
    assertEquals(formatFileSize(1024), "1.0 KB");
    assertEquals(formatFileSize(1536), "1.5 KB");
  });

  it("should format megabytes", () => {
    assertEquals(formatFileSize(1048576), "1.0 MB");
    assertEquals(formatFileSize(3145728), "3.0 MB");
  });

  it("should format gigabytes", () => {
    assertEquals(formatFileSize(1073741824), "1.0 GB");
  });

  it("should cap at GB for very large sizes", () => {
    assertEquals(formatFileSize(1099511627776), "1024.0 GB");
  });

  it("should handle zero bytes", () => {
    assertEquals(formatFileSize(0), "0.0 B");
  });
});

describe("formatBitrate", () => {
  it("should format bitrate with kbps suffix", () => {
    assertEquals(formatBitrate(320), "320 kbps");
    assertEquals(formatBitrate(128), "128 kbps");
  });

  it("should return 'Unknown' for undefined", () => {
    assertEquals(formatBitrate(undefined), "Unknown");
  });

  it("should return 'Unknown' for 0", () => {
    assertEquals(formatBitrate(0), "Unknown");
  });
});

describe("formatSampleRate", () => {
  it("should format sample rate with Hz suffix", () => {
    assertEquals(formatSampleRate(44100), "44100 Hz");
    assertEquals(formatSampleRate(48000), "48000 Hz");
    assertEquals(formatSampleRate(96000), "96000 Hz");
  });

  it("should return 'Unknown' for undefined", () => {
    assertEquals(formatSampleRate(undefined), "Unknown");
  });

  it("should return 'Unknown' for 0", () => {
    assertEquals(formatSampleRate(0), "Unknown");
  });
});
