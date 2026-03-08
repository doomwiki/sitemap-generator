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
    const response = await fetch(url, {
      headers: {
        "user-agent": "doomwiki-sitemap/2.0 (+https://doomwiki.org)",
      },
    });

    if (!response.ok) {
      throw new Error(`MediaWiki API error ${response.status} ${response.statusText} for ${url}`);
    }

    return (await response.json()) as ApiResponse;
  }
}
