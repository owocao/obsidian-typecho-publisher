import { App, Modal, Notice, TFile, Vault } from "obsidian";
import { XmlRpcClient, type PostContent } from "./xmlrpc-client";
import { createImageUploader } from "./image-uploader";
import { extractImages, resolveImageFile, replaceImageUrls, convertWikiLinks, stripCutoffSections } from "./markdown-utils";
import type { TypechoSettings } from "./settings";
import { t } from "./i18n";
import { generateTags } from "./ai-tags";
import { PropertiesReviewModal } from "./ai-tags-modal";
import { splitFrontmatter, readProperties, writeProperties, replaceProperties, validateProperties } from "./frontmatter";

export const FRONTMATTER_POST_ID_KEY = "typecho_postid";

interface NoticeLine {
  text: string;
  bold?: boolean;
  href?: string;
}

class PublishProgressModal extends Modal {
  private statusEl!: HTMLElement;
  private closeBtnEl!: HTMLElement;
  private spinnerEl!: HTMLElement;
  private resolved = false;

  constructor(app: App) {
    super(app);
    this.modalEl.addClass("typecho-progress-modal");
  }

  onOpen() {
    this.titleEl.setText(t("progress_title"));

    this.spinnerEl = this.contentEl.createEl("div", {
      cls: "typecho-progress-spinner",
    });

    this.statusEl = this.contentEl.createEl("div", {
      cls: "typecho-progress-status",
    });

    this.closeBtnEl = this.contentEl.createEl("button", {
      cls: "typecho-progress-close typecho-hidden",
      text: t("modal_close"),
    });
    this.closeBtnEl.addEventListener("click", () => this.close());
  }

  setStatus(text: string) {
    if (!this.resolved && this.statusEl) {
      this.statusEl.empty();
      this.statusEl.createEl("span", { text });
    }
  }

  resolve(lines: NoticeLine[], isError: boolean, autoCloseMs = 0) {
    if (this.resolved) return;
    this.resolved = true;

    this.titleEl.setText(isError ? t("publish_error") : t("publish_success"));
    if (isError) {
      this.statusEl.addClass("typecho-progress-error");
    }

    // Build result lines using DOM API
    this.statusEl.empty();
    for (const line of lines) {
      if (line.href) {
        const a = this.statusEl.createEl("a", { href: line.href, text: line.text });
        a.addEventListener("click", (e) => {
          e.preventDefault();
          window.open(line.href, "_blank");
        });
      } else {
        const el = this.statusEl.createEl("div");
        el.setText(line.text);
        if (line.bold) {
          el.addClass("typecho-progress-bold");
        }
      }
    }

    if (this.spinnerEl) this.spinnerEl.addClass("typecho-hidden");
    if (this.closeBtnEl) this.closeBtnEl.removeClass("typecho-hidden");

    if (autoCloseMs > 0) {
      window.setTimeout(() => {
        if (!this.containerEl.parentNode) return;
        this.close();
      }, autoCloseMs);
    }
  }

  onClose() {}
}

export class PublishService {
  constructor(
    private app: App,
    private vault: Vault,
    private metadataCache: {
      getFileCache: (file: TFile) => { frontmatter?: Record<string, unknown> } | null;
      getFirstLinkpathDest: (linktext: string, sourcePath: string) => TFile | null;
    },
    private getSettings: () => TypechoSettings,
    private saveSettings: () => Promise<void>,
    private processFrontMatter: (file: TFile, fn: (fm: Record<string, unknown>) => void) => Promise<void>
  ) {}

  async publish(noteFile: TFile): Promise<void> {
    const settings = this.getSettings();

    // Validate settings
    if (!settings.xmlrpcUrl || !settings.username || !settings.password) {
      new Notice(t("config_first"));
      return;
    }

    try {
      const original = await this.vault.read(noteFile);
      const parts = splitFrontmatter(original);
      let yaml = parts.yaml;
      const initial = readProperties(yaml);
      const fm = settings.fieldMapping;
      const date = initial[fm.dateCreated];
      if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        initial[fm.dateCreated] = this.formatDate("YYYY-MM-DDTHH:mm:ss", new Date());
        yaml = writeProperties(initial);
      }
      const sections = settings.cutoffSections.split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const publicBody = stripCutoffSections(parts.body, sections);
      const generator = settings.aiTagsEnabled && fm.mt_keywords ? (data: Record<string, unknown>) => {
        const title = this.getFmValue(data, fm.title) || this.extractFirstHeading(parts.body) || noteFile.basename;
        return generateTags(settings, title, publicBody);
      } : null;
      const reviewed = await new PropertiesReviewModal(this.app, yaml, fm.mt_keywords, generator,
        !!generator && this.getFmList(initial, fm.mt_keywords).filter(tag => tag.trim()).length === 0,
        data => validateProperties(data, settings)).review();
      if (reviewed === null) return;
      const frontmatter = readProperties(reviewed);
      validateProperties(frontmatter, settings);
      const content = replaceProperties(original, reviewed);
      await this.vault.process(noteFile, latest => {
        if (latest !== original) throw new Error("笔记在预览期间发生了修改，请重新发布以避免覆盖新内容。");
        return content;
      });
      await this.publishReviewed(noteFile, content, frontmatter);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "发布失败，请重试。");
    }
  }

  private async publishReviewed(noteFile: TFile, content: string, frontmatter: Record<string, unknown>): Promise<void> {
    const settings = this.getSettings();
    const fm = this.fieldMapping;
    // Validation: require <!--more--> tag
    if (settings.requireMoreTag && !content.includes("<!--more-->")) {
      new Notice(t("more_required"));
      return;
    }

    // dateCreated: REQUIRED. User must provide a valid date in frontmatter.
    if (!fm.dateCreated) {
      new Notice(t("date_mapping_required"));
      return;
    }
    const dateStr = this.getFmValue(frontmatter, fm.dateCreated);
    if (!dateStr) {
      new Notice(t("date_required"));
      return;
    }
    // A date-only value becomes 08:00 in UTC+8 when parsed as UTC midnight.
    // Use the publish action's local time once, then persist it for later edits.
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
    const pubDate = dateOnly ? new Date() : new Date(dateStr);
    if (isNaN(pubDate.getTime())) {
      new Notice(t("date_invalid", { value: dateStr }));
      return;
    }

    // title: frontmatter > first # heading > filename
    const title =
      this.getFmValue(frontmatter, fm.title) ||
      this.extractFirstHeading(splitFrontmatter(content).body) ||
      noteFile.basename;

    // categories: fallback empty
    const categories = this.getFmList(frontmatter, fm.categories);

    // mt_keywords: fallback empty
    const tags = this.getFmList(frontmatter, fm.mt_keywords).filter(tag => tag.trim());

    // wp_slug: frontmatter > fallback from dateCreated
    let slug = this.getFmValue(frontmatter, fm.slug);
    if (!slug) {
      slug = this.formatDate(settings.slugDateFormat, pubDate);
    }

    // wp_post_type: frontmatter > fallback "post"
    const postType = this.getFmValue(frontmatter, fm.post_type) || "post";

    // mt_allow_comments: frontmatter > fallback 1 (allow)
    const allowComments = this.getFmValue(frontmatter, fm.mt_allow_comments) || "1";

    // mt_excerpt: fallback empty
    const excerpt = this.getFmValue(frontmatter, fm.mt_excerpt) || undefined;

    // post_status: frontmatter > default "publish"
    const status = this.getFmValue(frontmatter, fm.post_status) || "publish";

    // Step 0: Check typecho_postid early — before any network I/O
    const existingPostId = frontmatter[FRONTMATTER_POST_ID_KEY] as string | undefined;

    // Open progress modal before any network I/O
    const progressModal = new PublishProgressModal(this.app);
    progressModal.open();

    try {
      // Step 1: Extract and upload images
      let processedContent = content;
      const images = extractImages(content);
    let imgStats: { total: number; cached: number; uploaded: number } = {
      total: 0, cached: 0, uploaded: 0,
    };

    const xmlrpc = new XmlRpcClient(
      settings.xmlrpcUrl,
      settings.username,
      settings.password
    );

    if (images.length > 0) {
      const uploader = createImageUploader(settings, xmlrpc);

      if (uploader) {
        const cache = settings.imageCache ?? {};
        const urlMap = new Map<string, string>();
        let cacheChanged = false;
        let uploadedCount = 0;

        for (const img of images) {
          const imgFile = resolveImageFile(img.path, noteFile, this.vault);
          if (!imgFile) continue;
          imgStats.total++;

          // Check cache by vault-relative path
          const cacheKey = imgFile.path;
          if (cache[cacheKey]) {
            urlMap.set(img.path, cache[cacheKey]);
            imgStats.cached++;
            continue;
          }

          try {
            progressModal.setStatus(
              t("uploading_images", { current: uploadedCount + 1, total: images.length })
            );
            const imgData = await this.vault.readBinary(imgFile);
            const mimeType = this.getMimeType(imgFile.extension);
            const uploadedUrl = await uploader.uploadImage(imgData, imgFile.name, mimeType, pubDate);
            urlMap.set(img.path, uploadedUrl);
            cache[cacheKey] = uploadedUrl;
            cacheChanged = true;
            imgStats.uploaded++;
            uploadedCount++;
          } catch (e) {
            new Notice(
              `${t("img_upload_failed")}"${imgFile.name}": ${e instanceof Error ? e.message : String(e)}`
            );
          }
        }

        if (cacheChanged) {
          settings.imageCache = cache;
          await this.saveSettings();
        }

        if (imgStats.uploaded > 0 || imgStats.cached > 0) {
          processedContent = replaceImageUrls(content, urlMap);
        }
      } else if (settings.useImageHost) {
        // External image host is enabled but not configured
        new Notice(t("img_stats_no_r2", { total: images.length }));
      }
      // else: useImageHost disabled but no uploader — shouldn't happen since
      // TypechoUploader is always available with valid xmlrpc credentials
    }

    // Step 1.5: Convert wiki-links to blog post links
    if (settings.linkConversionEnabled && settings.linkUrlTemplate) {
      processedContent = convertWikiLinks(processedContent, {
        vault: this.vault,
        metadataCache: this.metadataCache,
        sourcePath: noteFile.path,
        dateCreatedKey: fm.dateCreated,
        slugKey: fm.slug || "slug",
        slugDateFormat: settings.slugDateFormat,
        titleKey: fm.title || "title",
        urlTemplate: settings.linkUrlTemplate,
      });
    }

    // Step 1.6: Strip cutoff sections (Draft, ChangeLog, PrivateNote, etc.)
    if (settings.cutoffSections) {
      const sections = settings.cutoffSections
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      processedContent = stripCutoffSections(processedContent, sections);
    }

    // Strip frontmatter for the published content
    const bodyOnly = this.stripFrontmatter(processedContent);

    // Build post content with mapped fields + fallbacks
    const postContent: PostContent = {
      title,
      description: bodyOnly,
      categories: categories.length > 0 ? categories : undefined,
      mt_keywords: tags.length > 0 ? tags.join(",") : undefined,
      slug,
      mt_allow_comments: parseInt(allowComments, 10) === 0 ? 0 : 1,
      mt_excerpt: excerpt,
      post_status: status,
      wp_post_type: postType,
      dateCreated: pubDate,
    };

    // Step 2: Check if article exists and publish
    progressModal.setStatus(t("publishing_to"));

    if (existingPostId) {
      await xmlrpc.editPost(existingPostId, postContent, true);
      await this.savePublishTimes(noteFile, fm.dateCreated, dateOnly ? pubDate : null);
      progressModal.resolve(
        this.buildNotice(existingPostId, title, slug, pubDate, settings.linkUrlTemplate, imgStats, false),
        false
      );
    } else {
      const newPostId = await xmlrpc.newPost(postContent, true);
      await this.savePublishTimes(noteFile, fm.dateCreated, dateOnly ? pubDate : null, newPostId);
      progressModal.resolve(
        this.buildNotice(newPostId, title, slug, pubDate, settings.linkUrlTemplate, imgStats, true),
        false
      );
    }
  } catch (e) {
    console.error("[TypechoPlugin] publish() UNCAUGHT ERROR:", e);
    progressModal.resolve(
      [{ text: e instanceof Error ? e.message : String(e) }],
      true
    );
  }
  }

  private buildNotice(
    postId: string,
    title: string,
    slug: string,
    pubDate: Date,
    urlTemplate: string,
    imgStats: { total: number; cached: number; uploaded: number },
    isNew: boolean
  ): NoticeLine[] {
    const header = isNew
      ? t("article_new", { postid: postId })
      : t("article_updated", { postid: postId });
    const lines: NoticeLine[] = [{ text: header, bold: true }];
    lines.push({ text: t("article_detail_title", { title }) });
    lines.push({ text: t("article_detail_slug", { slug }) });

    if (urlTemplate) {
      const url = urlTemplate
        .replace("{slug}", slug)
        .replace("{postid}", postId)
        .replace("{year}", String(pubDate.getFullYear()))
        .replace("{month}", String(pubDate.getMonth() + 1).padStart(2, "0"))
        .replace("{day}", String(pubDate.getDate()).padStart(2, "0"));
      lines.push({ text: t("article_detail_more"), href: url });
    }

    if (imgStats.total > 0) {
      lines.push({ text: t("img_stats", {
        total: imgStats.total,
        cached: imgStats.cached,
        new: imgStats.uploaded,
      })});
    }

    return lines;
  }

  private get fieldMapping() {
    return this.getSettings().fieldMapping;
  }

  /** Read a single string value from frontmatter using the mapped key. */
  private getFmValue(
    fm: Record<string, unknown>,
    fmKey: string
  ): string | undefined {
    if (!fmKey) return undefined;
    const val = fm[fmKey];
    if (typeof val === "string") return val;
    if (typeof val === "number") return String(val);
    if (Array.isArray(val) && val.length > 0) return String(val[0]);
    return undefined;
  }

  /** Read a list value from frontmatter using the mapped key. */
  private getFmList(
    fm: Record<string, unknown>,
    fmKey: string
  ): string[] {
    if (!fmKey) return [];
    const val = fm[fmKey];
    if (Array.isArray(val)) return val.map((v) => String(v));
    if (typeof val === "string") return val.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    return [];
  }

  private extractFirstHeading(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  private stripFrontmatter(content: string): string {
    return splitFrontmatter(content).body.trim();
  }

  private async savePublishTimes(
    noteFile: TFile,
    dateKey: string,
    publishedAt: Date | null,
    postId?: string
  ): Promise<void> {
    await this.processFrontMatter(noteFile, (fm) => {
      if (postId) fm[FRONTMATTER_POST_ID_KEY] = postId;
      if (publishedAt) fm[dateKey] = this.formatDate("YYYY-MM-DDTHH:mm:ss", publishedAt);
      fm.typecho_modified = this.formatDate("YYYY-MM-DDTHH:mm:ss", new Date());
    });
  }


  /** Format a date using a pattern with tokens:
   *  YYYY=year, YY=2-digit-year, MM=month, DD=day, HH=hour, mm=minute, ss=second */
  private formatDate(format: string, d: Date): string {
    const tokens: Record<string, string> = {
      YYYY: String(d.getFullYear()),
      YY: String(d.getFullYear()).slice(-2),
      MM: String(d.getMonth() + 1).padStart(2, "0"),
      DD: String(d.getDate()).padStart(2, "0"),
      HH: String(d.getHours()).padStart(2, "0"),
      mm: String(d.getMinutes()).padStart(2, "0"),
      ss: String(d.getSeconds()).padStart(2, "0"),
    };
    let result = format;
    // Replace long tokens first to avoid partial matches (YYYY before YY)
    for (const [token, value] of Object.entries(tokens)) {
      result = result.replace(token, value);
    }
    return result;
  }

  private getMimeType(extension: string): string {
    const map: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      bmp: "image/bmp",
      ico: "image/x-icon",
      tiff: "image/tiff",
      tif: "image/tiff",
      avif: "image/avif",
    };
    return map[extension.toLowerCase()] || "application/octet-stream";
  }
}
