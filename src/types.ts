export interface NamespaceConfig {
  id: number;
  filename: string;
  name: string;
  priority: string;
}

export interface PageImageRef {
  title?: string;
}

export interface WikiPage {
  pageid: number;
  title?: string;
  touched?: string;
  images?: PageImageRef[];
}

export interface AllImagesItem {
  name?: string;
  url?: string;
  descriptionurl?: string;
}

export interface SitemapOptions {
  outDir: string;
  maxPagesPerNamespace?: number;
  maxImages?: number;
  sleepMs: number;
}
