# Typecho Publisher

> 中文用户请阅读 [简体中文版说明](https://github.com/skyue/obsidian-typecho-publisher/blob/main/README_zh-CN.md)。

Publish Obsidian notes to [Typecho](https://typecho.org) blog via XML-RPC, with configurable image hosting.

## Features

- One-click publish new posts or update existing ones
- Image upload to Cloudflare R2 or Typecho's built-in media library
- Image upload cache to avoid re-uploading
- Custom frontmatter field mapping to Typecho XML-RPC fields
- Strict frontmatter property type validation
- Wiki-link to blog URL conversion
- Content cutoff by section headings (e.g., hide draft sections)
- Progress modal with success/error feedback and article URL link
- Auto-detect Obsidian language, supports English and Simplified Chinese

### Enhancements in this fork

- Review and edit the complete YAML frontmatter before every publish; the article body is never included in the preview
- Optional AI-generated tags through an OpenAI-compatible Chat Completions endpoint or the DeepSeek preset
- Review generated tags before publishing, regenerate only `tags`, or cancel without changing the note or calling Typecho
- Preserve unknown frontmatter properties and block publishing if the note changes while the review window is open
- Convert date-only publish values to the local publish time once, then retain the full timestamp on later updates
- Record `typecho_modified` after a successful publish and correctly preserve `mt_allow_comments: 0`

## Configuration

### Typecho Connection

Fill in your Typecho site XML-RPC URL, username, and password.

![Config Page](https://github.com/user-attachments/assets/e22ce600-2806-4204-a392-4f19e03e16ce)

### AI-generated tags

Enable AI tags and configure an OpenAI-compatible Chat Completions base URL, model ID, and API key. Tags are generated only when the mapped tag property is empty. The title and publishable body (excluding configured cutoff sections) are sent to the selected model service. Credentials remain in Obsidian's local plugin `data.json`, which is excluded from this repository.


### Frontmatter Field Mapping

Map your custom frontmatter keys to Typecho fields. The `dateCreated` field is mandatory and must use Obsidian's "Date & Time" property type. Each field has a type requirement — publishing will fail if the type doesn't match.

Example:

```yaml
---
published: 2026-06-14 22:00
aliases: My First Post
categories: [tech, obsidian]
tags: [obsidian, typecho]
slug: my-first-post
---
```

### Slug Fallback

When no slug is set in frontmatter, it's auto-generated from the publish date using a configurable format string (tokens: `YYYY`, `YY`, `MM`, `DD`, `HH`, `mm`, `ss`).

### Wiki-Link Conversion

Enable to convert `[[wikilinks]]` to blog post URLs when the target note is also a published blog post (has the `dateCreated` frontmatter field). Non-blog notes are converted to plain text. Configure a URL template with variables: `{slug}`, `{postid}`, `{year}`, `{month}`, `{day}`.

### Content Cutoff

Specify section headings (comma-separated) that mark content to be excluded from publishing. Sections after (and including) these headings are stripped. Useful for hiding drafts, changelogs, or private notes.

### Validation

Optionally require the `<!--more-->` tag in post body. Publish will fail if missing.

### Image Hosting

Toggle between two modes:

- **Disabled** — Images are uploaded to Typecho's built-in media library via `metaWeblog.newMediaObject`.
- **Enabled** — Select an external hosting provider. Currently supports **Cloudflare R2**.

To set up Cloudflare R2:

1. Create an R2 bucket in Cloudflare Dashboard
2. Generate R2 API tokens (R2 → Manage R2 API Tokens)
3. Enable public access for your bucket
4. Fill in Account ID, Access Key, Secret Key, Bucket name, and Public URL

The upload path prefix supports date variables: `{YYYY}`, `{YY}`, `{MM}`, `{DD}`, `{HH}`, `{mm}`, `{ss}` (based on publish date).

## Usage

- Open a Markdown note and run the `Publish to Typecho` command
- Right-click a `.md` file in the file explorer and select `Publish to Typecho`
- Use the editor context menu

![Publish to Typecho Command](https://github.com/user-attachments/assets/b6c42867-eda5-4752-9ef5-57cd75884dab)


Before publishing, the plugin opens an editable preview containing only the complete YAML frontmatter. Keeping `typecho_postid` updates the existing post; removing it creates a new post. The field is automatically added after a successful first publish. Closing or cancelling the preview performs no write and sends no publishing request.

A progress modal shows upload status and the final result, including a clickable link to the published article (if a wiki-link URL template is configured).

## License

MIT
