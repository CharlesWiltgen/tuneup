const CAA_BASE = "https://coverartarchive.org";
const REQUEST_TIMEOUT_MS = 15000;

export type CoverArtResult = {
  data: Uint8Array;
  mimeType: string;
} | null;

export function buildCoverArtUrl(releaseId: string): string {
  return `${CAA_BASE}/release/${releaseId}/front`;
}

export async function fetchCoverArt(
  releaseId: string,
): Promise<CoverArtResult> {
  const url = buildCoverArtUrl(releaseId);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }

    if (!response.ok) {
      await response.body?.cancel();
      console.error(
        `  Cover art fetch failed: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data = new Uint8Array(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type") ?? "image/jpeg";

    return { data, mimeType };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      console.error(`  Cover art fetch timed out for release ${releaseId}`);
    } else {
      console.error(`  Cover art fetch error for ${releaseId}: ${error}`);
    }
    return null;
  }
}
