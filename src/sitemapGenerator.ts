import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MediaWikiClient } from "./mediaWikiClient";
import type { AllImagesItem, NamespaceConfig, SitemapOptions, WikiPage } from "./types";

const NAMESPACES: NamespaceConfig[] = [
  { id: 0, priority: "1.0", filename: "main", name: "Main" },
  { id: 1, priority: "0.5", filename: "talk", name: "Talk" },
  { id: 2, priority: "0.7", filename: "user", name: "User" },
  { id: 3, priority: "0.4", filename: "utalk", name: "User talk" },
  { id: 4, priority: "0.6", filename: "dwiki", name: "Doom Wiki" },
  { id: 5, priority: "0.2", filename: "dwtalk", name: "Doom Wiki talk" },
  { id: 6, priority: "0.5", filename: "file", name: "File" },
  { id: 7, priority: "0.3", filename: "ftalk", name: "File talk" },
  { id: 12, priority: "0.5", filename: "help", name: "Help" },
  { id: 13, priority: "0.2", filename: "htalk", name: "Help talk" },
  { id: 14, priority: "0.4", filename: "cat", name: "Category" },
  { id: 15, priority: "0.2", filename: "ctalk", name: "Category talk" },
];

export class SitemapGenerator {
  constructor(private readonly client: MediaWikiClient) {}

  public async run(options: SitemapOptions): Promise<{ files: string[]; pageCount: number }> {
    await mkdir(options.outDir, { recursive: true });

    const allImages = await this.client.fetchAllImages(options.sleepMs, options.maxImages);
    const imageMap = new Map<string, AllImagesItem>();
    for (const image of allImages) {
      if (!image.name) continue;
      imageMap.set(image.name, image);
    }

    const files: string[] = [];
    let totalPages = 0;

    for (const namespace of NAMESPACES) {
      const pages = await this.client.fetchAllPagesByNamespace(
        namespace.id,
        options.sleepMs,
        options.maxPagesPerNamespace,
      );
      totalPages += pages.length;

      const xml = this.renderNamespaceXml(namespace, pages, imageMap);
      const filename = `${namespace.filename}.xml`;
      const fullPath = join(options.outDir, filename);
      await writeFile(fullPath, xml, "utf8");
      files.push(fullPath);
    }

    const indexXml = this.renderSitemapIndex(files);
    const indexPath = join(options.outDir, "sitemap-index.xml");
    await writeFile(indexPath, indexXml, "utf8");
    files.push(indexPath);

    return { files, pageCount: totalPages };
  }

  private renderNamespaceXml(
    namespace: NamespaceConfig,
    pages: WikiPage[],
    imageMap: Map<string, AllImagesItem>,
  ): string {
    const body = pages.map((page) => this.renderPage(namespace, page, imageMap)).join("\n");

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
      body,
      "</urlset>",
      "",
    ].join("\n");
  }

  private renderPage(
    namespace: NamespaceConfig,
    page: WikiPage,
    imageMap: Map<string, AllImagesItem>,
  ): string {
    const title = page.title?.trim() || `Page-${page.pageid}`;
    const touched = page.touched?.trim() || new Date().toISOString();

    const priority = this.computePriority(namespace, page, title);
    const changeFreq = this.computeEditFrequency(touched);
    const lines: string[] = [
      "  <url>",
      `    <loc>${this.client.canonicalUrlForXml(title)}</loc>`,
      `    <lastmod>${this.client.xmlEscape(touched)}</lastmod>`,
      `    <changefreq>${changeFreq}</changefreq>`,
      `    <priority>${priority}</priority>`,
    ];

    for (const ref of page.images ?? []) {
      if (!ref.title) continue;
      const imageName = this.client.canonicalTitle(ref.title.replace(/^File:/, ""));
      const image = imageMap.get(imageName);
      if (!image || !image.url) continue;

      lines.push("    <image:image>");
      lines.push(`      <image:loc>${this.client.xmlEscape(image.url)}</image:loc>`);
      if (image.name) {
        lines.push(`      <image:title>${this.client.xmlEscape(this.prettyImageName(image.name))}</image:title>`);
      }
      if (image.descriptionurl) {
        lines.push(`      <image:license>${this.client.xmlEscape(image.descriptionurl)}</image:license>`);
      }
      lines.push("    </image:image>");
    }

    lines.push("  </url>");
    return lines.join("\n");
  }

  private renderSitemapIndex(files: string[]): string {
    const now = new Date().toISOString();
    const entries = files
      .filter((file) => file.endsWith(".xml") && !file.endsWith("sitemap-index.xml"))
      .map((file) => {
        const filename = file.split("/").at(-1) ?? file;
        const loc = this.client.xmlEscape(`${this.client.webBaseUrl}/${filename}`);
        return ["  <sitemap>", `    <loc>${loc}</loc>`, `    <lastmod>${now}</lastmod>`, "  </sitemap>"].join("\n");
      })
      .join("\n");

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      entries,
      "</sitemapindex>",
      "",
    ].join("\n");
  }

  private prettyImageName(name: string): string {
    const noUnderscore = name.replace(/_/g, " ");
    const lastDot = noUnderscore.lastIndexOf(".");
    return lastDot >= 0 ? noUnderscore.slice(0, lastDot) : noUnderscore;
  }

  private computeEditFrequency(touchedIso: string): "weekly" | "monthly" | "yearly" {
    const touched = new Date(touchedIso);
    if (Number.isNaN(touched.getTime())) {
      return "monthly";
    }

    const daysAgo = (Date.now() - touched.getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo >= 365) return "yearly";
    if (daysAgo >= 30) return "monthly";
    return "weekly";
  }

  private computePriority(namespace: NamespaceConfig, page: WikiPage, title: string): string {
    let priority = namespace.priority;
    const looksLikeMapOrFileArticle =
      title.includes(".") ||
      title.includes("(") ||
      title.startsWith("MAP") ||
      (title.startsWith("E") && title[2] === "M" && title[4] === ":");

    if (namespace.id === 0 && looksLikeMapOrFileArticle) {
      priority = "0.8";
    }

    if (namespace.id === 1 && looksLikeMapOrFileArticle) {
      priority = "0.4";
    }

    if ((namespace.id === 2 || namespace.id === 3) && title.split(".").length - 1 === 3) {
      priority = "0.1";
    }

    if (title.includes("/")) {
      priority = "0.1";
    }

    return priority;
  }
}
