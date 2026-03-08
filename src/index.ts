import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MediaWikiClient } from "./mediaWikiClient";
import { SitemapGenerator } from "./sitemapGenerator";
import type { SitemapOptions } from "./types";

function parseArgs(argv: string[]): SitemapOptions {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  const maxPagesRaw = get("--max-pages");
  const maxImagesRaw = get("--max-images");
  const sleepMsRaw = get("--sleep-ms");
  const outDir = get("--out-dir") ?? "output";

  const maxPagesNum = maxPagesRaw ? Number(maxPagesRaw) : undefined;
  const maxImagesNum = maxImagesRaw ? Number(maxImagesRaw) : undefined;
  const sleepMs = sleepMsRaw ? Number(sleepMsRaw) : 0;

  if (typeof maxPagesNum === "number" && (!Number.isFinite(maxPagesNum) || maxPagesNum <= 0)) {
    throw new Error("--max-pages must be a positive number");
  }
  if (typeof maxImagesNum === "number" && (!Number.isFinite(maxImagesNum) || maxImagesNum <= 0)) {
    throw new Error("--max-images must be a positive number");
  }
  if (!Number.isFinite(sleepMs) || sleepMs < 0) {
    throw new Error("--sleep-ms must be >= 0");
  }

  return {
    outDir,
    maxPagesPerNamespace: maxPagesNum,
    maxImages: maxImagesNum,
    sleepMs,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = new MediaWikiClient("doomwiki.org", "https");
  const generator = new SitemapGenerator(client);

  console.log(`Starting sitemap generation for doomwiki.org...`);
  const start = Date.now();
  const result = await generator.run(options);
  const elapsedMs = Date.now() - start;

  console.log(`Generation finished. Total pages: ${result.pageCount}`);
  console.log(`Files generated: ${result.files.join(", ")}`);

  const summary = {
    generatedAt: new Date().toISOString(),
    elapsedMs,
    pageCount: result.pageCount,
    files: result.files,
    options,
  };

  await mkdir(options.outDir, { recursive: true });
  await writeFile(join(options.outDir, "run-summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log(`Generated ${result.files.length} files in ${options.outDir}`);
  console.log(`Processed ${result.pageCount} pages in ${elapsedMs}ms`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
