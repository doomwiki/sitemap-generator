import { setTimeout as delay } from "node:timers/promises";
import type { AllImagesItem, WikiPage } from "./types";

type ApiResponse = {
  continue?: Record<string, string>;
  query?: {
    pages?: Record<string, WikiPage>;
    allimages?: AllImagesItem[];
  };
};

export class MediaWikiClient {
  public readonly apiBaseUrl: string;
  public readonly webBaseUrl: string;
  private readonly maxRetries = 6;
  private readonly baseBackoffMs = 400;
  private readonly maxBackoffMs = 15_000;

  constructor(domain: string, protocol: "http" | "https" = "https") {
    this.apiBaseUrl = `${protocol}://${domain}/w/api.php`;
    this.webBaseUrl = `${protocol}://${domain}/wiki`;
  }

  public canonicalTitle(title: string): string {
    return title.replace(/ /g, "_");
  }

  public canonicalUrl(title: string): string {
    const encoded = encodeURI(`${this.webBaseUrl}/${this.canonicalTitle(title)}`);
    return encoded.replace(/'|\?/g, (m) => (m === "'" ? "%27" : "%3F"));
  }

  public xmlEscape(value: unknown): string {
    const text = value == null ? "" : String(value);
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  public canonicalUrlForXml(title: string): string {
    return this.xmlEscape(this.canonicalUrl(title));
  }

  public async fetchAllPagesByNamespace(
    namespaceId: number,
    sleepMs: number,
    maxPages?: number,
  ): Promise<WikiPage[]> {
    const allPages: WikiPage[] = [];
    let continuation: Record<string, string> | undefined;

    do {
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        generator: "allpages",
        gapnamespace: String(namespaceId),
        gapfilterredir: "nonredirects",
        gaplimit: "500",
        prop: "info|images",
        imlimit: "5000",
      });

      if (continuation) {
        for (const [key, value] of Object.entries(continuation)) {
          params.set(key, value);
        }
      }

      const data = await this.fetchJson(params);
      const pages = data.query?.pages ?? {};

      for (const page of Object.values(pages)) {
        allPages.push(page);
        if (maxPages && allPages.length >= maxPages) {
          return allPages;
        }
      }

      continuation = data.continue;
      if (continuation && sleepMs > 0) {
        await delay(sleepMs);
      }
    } while (continuation);

    return allPages;
  }

  public async fetchAllImages(sleepMs: number, maxImages?: number): Promise<AllImagesItem[]> {
    const images: AllImagesItem[] = [];
    let continuation: Record<string, string> | undefined;

    do {
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        list: "allimages",
        ailimit: "1000",
      });

      if (continuation) {
        for (const [key, value] of Object.entries(continuation)) {
          params.set(key, value);
        }
      }

      const data = await this.fetchJson(params);
      const chunk = data.query?.allimages ?? [];
      for (const image of chunk) {
        images.push(image);
        if (maxImages && images.length >= maxImages) {
          return images;
        }
      }

      continuation = data.continue;
      if (continuation && sleepMs > 0) {
        await delay(sleepMs);
      }
    } while (continuation);

    return images;
  }

  private async fetchJson(params: URLSearchParams): Promise<ApiResponse> {
    const url = `${this.apiBaseUrl}?${params.toString()}`;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            "user-agent": "doomwiki-sitemap-generator/2.0 (+https://doomwiki.org)",
          },
        });

        if (response.ok) {
          return (await response.json()) as ApiResponse;
        }

        const retryable = response.status === 429 || response.status === 503 || response.status === 502;
        if (retryable && attempt < this.maxRetries) {
          const waitMs = this.getRetryDelayMs(response.headers.get("retry-after"), attempt);
          await delay(waitMs);
          continue;
        }

        const nonRetryableError = new Error(
          `MediaWiki API error ${response.status} ${response.statusText} for ${url}`,
        );
        nonRetryableError.name = "NonRetryableHttpError";
        throw nonRetryableError;
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "NonRetryableHttpError") {
          throw error;
        }

        const isLastAttempt = attempt >= this.maxRetries;
        if (isLastAttempt) {
          throw error instanceof Error ? error : new Error(String(error));
        }

        const waitMs = this.getRetryDelayMs(undefined, attempt);
        await delay(waitMs);
      }
    }

    throw new Error(`MediaWiki API request exhausted retries for ${url}`);
  }

  private getRetryDelayMs(retryAfterHeader: string | null | undefined, attempt: number): number {
    if (retryAfterHeader) {
      const retrySeconds = Number(retryAfterHeader);
      if (Number.isFinite(retrySeconds) && retrySeconds >= 0) {
        return Math.min(this.maxBackoffMs, retrySeconds * 1000);
      }

      const retryAt = Date.parse(retryAfterHeader);
      if (!Number.isNaN(retryAt)) {
        const delta = retryAt - Date.now();
        if (delta > 0) {
          return Math.min(this.maxBackoffMs, delta);
        }
      }
    }

    const expBackoff = this.baseBackoffMs * 2 ** attempt;
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(this.maxBackoffMs, expBackoff + jitter);
  }
}
