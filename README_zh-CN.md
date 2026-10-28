# Typecho Publisher

通过 XML-RPC 将 Obsidian 笔记发布到 [Typecho](https://typecho.org) 博客，支持多种图床方案。

## 功能

- 一键发布新文章或更新已有文章
- 图片上传到 Cloudflare R2 或 Typecho 自带附件管理
- 图片上传缓存，避免重复上传
- 自定义 frontmatter 字段映射到 Typecho XML-RPC 字段
- 严格的 frontmatter 属性类型校验
- Wiki-Link 双链自动转换为博客链接
- 按标题截断正文（隐藏草稿、变更日志等段落）
- 发布进度弹窗，含成功/失败反馈及文章链接
- 自动检测 Obsidian 语言，支持简体中文和英文

### 本 Fork 的增强功能

- 每次发布前预览并编辑完整 YAML frontmatter，预览不包含正文
- 支持 OpenAI 兼容 Chat Completions 接口及 DeepSeek 预设自动生成标签
- AI 标签生成后可确认、重新生成或手动编辑；重新生成只更新 `tags`
- 取消预览时不修改笔记，也不请求 Typecho；预览期间笔记发生变化会停止发布，避免覆盖
- 仅有日期的发布时间会在首次发布时补全为本地当前时间，后续更新保持完整时间
- 发布成功后记录 `typecho_modified`，并正确支持 `mt_allow_comments: 0`

## 配置

### Typecho 连接

填写 Typecho 站点的 XML-RPC 地址、用户名和密码。

### AI 自动标签

启用后填写 OpenAI 兼容的 Chat Completions API 地址、模型名称和 API 密钥；也可选择 DeepSeek 预设。仅当映射的标签属性为空时自动生成。标题和准备发布的正文（不含配置为截断的段落）会发送给所选模型服务。连接信息保存在 Obsidian 本地插件目录的 `data.json` 中，该文件已被仓库忽略，不会上传。

### Frontmatter 字段映射

将自定义 frontmatter 键映射到 Typecho 字段。`dateCreated` 为必填字段，且必须使用 Obsidian 的「日期&时间」属性类型。每个字段都有类型要求，类型不匹配将拒绝发布。

示例：

```yaml
---
published: 2026-06-14 22:00
aliases: 我的第一篇文章
categories: [tech, obsidian]
tags: [obsidian, typecho]
slug: my-first-post
---
```

### Slug 回退策略

未设置 slug 时，使用发布日期按自定义格式自动生成。支持变量：`YYYY`、`YY`、`MM`、`DD`、`HH`、`mm`、`ss`。

### Wiki-Link 转换

启用后，当 `[[双链]]` 指向的笔记也包含 `dateCreated` 字段（即为已发布博客文章）时，自动转换为博客 URL 链接。非博客笔记退化为去括号的纯文本。需配置 URL 模板，变量：`{slug}`、`{postid}`、`{year}`、`{month}`、`{day}`。

### 内容截断

设置需要截断的标题（逗号分隔），发布时这些标题及之后的内容将被移除。适用于隐藏草稿、变更日志或私密笔记。

### 校验

可选择要求正文必须包含 `<!--more-->` 标签，否则发布失败。

### 图床

提供两种模式，通过开关切换：

- **关闭** — 图片上传到 Typecho 自带附件管理（通过 `metaWeblog.newMediaObject` 接口）。
- **开启** — 选择外部图床服务。当前支持 **Cloudflare R2**。

配置 Cloudflare R2：

1. 在 Cloudflare 控制台创建 R2 bucket
2. 生成 R2 API 令牌（R2 → 管理 R2 API 令牌）
3. 为 bucket 开启公开访问
4. 填写 Account ID、Access Key、Secret Key、Bucket 名称和公开访问 URL

上传路径前缀支持日期变量：`{YYYY}`、`{YY}`、`{MM}`、`{DD}`、`{HH}`、`{mm}`、`{ss}`（基于文章发布日期）。

## 使用

- 打开 Markdown 笔记，执行 `发布到 Typecho` 命令
- 在文件管理器中右键 `.md` 文件，选择 `发布到 Typecho`
- 使用编辑器右键菜单

发布前会打开仅包含完整 YAML frontmatter 的可编辑预览。保留 `typecho_postid` 会更新原文章，删除该属性会新建文章；首次发布成功后会自动回写该字段。关闭或取消预览不会写入笔记，也不会发送发布请求。

发布过程中会显示进度弹窗，展示图片上传状态和最终结果。若配置了双链 URL 模板，弹窗中还会显示文章的可点击链接。

## 开源协议

MIT
