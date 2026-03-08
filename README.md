# DoomWiki Sitemap Generator

TypeScript/Node sitemap generator for DoomWiki using the MediaWiki API.

## What it does

- Queries DoomWiki page metadata by namespace
- Queries image metadata (`allimages`)
- Emits namespace sitemap XML files
- Emits a sitemap index XML file
- Emits a JSON run summary

## Requirements

- Node.js 24+
- npm

## Install

```bash
npm install
```

## Run

### Build + run compiled JS

```bash
npm run build
npm run start -- --out-dir output/run1
```

### Run via convenience TS entrypoint

```bash
node index.ts --out-dir output/run1
```

## Useful flags

- `--out-dir <path>`: output directory (default: `output`)
- `--max-pages <n>`: cap pages per namespace (useful for test runs)
- `--max-images <n>`: cap total images fetched
- `--sleep-ms <ms>`: delay between continuation requests

Example bounded run:

```bash
node index.ts --max-pages 20 --max-images 20 --sleep-ms 250 --out-dir output/sample
```

## Output files

For each run, the generator writes:

- `main.xml`
- `talk.xml`
- `user.xml`
- `utalk.xml`
- `dwiki.xml`
- `dwtalk.xml`
- `file.xml`
- `ftalk.xml`
- `help.xml`
- `htalk.xml`
- `cat.xml`
- `ctalk.xml`
- `sitemap-index.xml`
- `run-summary.json`

## XML format

### Namespace sitemap files

Each namespace file is a standard Sitemap XML document:

- root: `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ...>`
- per page: `<url>` with:
  - `<loc>` canonical DoomWiki URL
  - `<lastmod>` MediaWiki `touched` timestamp
  - `<changefreq>` (`weekly|monthly|yearly` heuristic)
  - `<priority>` namespace/title heuristic
- optional image entries per page:
  - `<image:image>`
  - `<image:loc>`
  - optional `<image:title>`
  - optional `<image:license>`

### Sitemap index

`sitemap-index.xml` uses standard `<sitemapindex>` with one `<sitemap>` per namespace XML.

### Run summary

`run-summary.json` includes:

- `generatedAt`
- `elapsedMs`
- `pageCount`
- `files`
- `options`

## Rate limiting / retries

The client is conservative by default (serialized requests) and also includes retry handling for transient API failures:

- Retries on HTTP `429`, `502`, `503`
- Honors `Retry-After` when present
- Uses exponential backoff + jitter otherwise

If you want to further reduce request pressure, set `--sleep-ms` to a non-zero value.