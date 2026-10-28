import { parseYaml, stringifyYaml } from "obsidian";
import type { TypechoSettings } from "./settings";

export function splitFrontmatter(content: string): { yaml: string; body: string } {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(content);
  return match ? { yaml: match[1] || "", body: content.slice(match[0].length) } : { yaml: "", body: content };
}

export function readProperties(yaml: string): Record<string, unknown> {
  if (/^---[ \t]*$/m.test(yaml)) throw new Error("这里只填写属性，不要包含 --- 分隔线或正文。");
  let data: unknown;
  try { data = parseYaml(yaml); } catch { throw new Error("属性 YAML 格式有误，请检查缩进、冒号和列表格式。"); }
  if (data == null) return {};
  if (typeof data !== "object" || Array.isArray(data) || data instanceof Date) {
    throw new Error("属性必须是 YAML 键值对象。");
  }
  return data as Record<string, unknown>;
}

export function writeProperties(data: Record<string, unknown>): string { return stringifyYaml(data).trimEnd(); }

export function replaceProperties(content: string, yaml: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const properties = yaml.replace(/\r?\n/g, eol).trimEnd();
  return (content.startsWith("\uFEFF") ? "\uFEFF" : "") + "---" + eol + properties + eol + "---" + eol
    + splitFrontmatter(content).body.replace(/^\uFEFF/, "");
}

export function validateProperties(data: Record<string, unknown>, settings: TypechoSettings): void {
  const mapping = settings.fieldMapping;
  const date = data[mapping.dateCreated];
  if (!mapping.dateCreated || typeof date !== "string" || !date.trim() || isNaN(new Date(date).getTime())) {
    throw new Error("请填写有效的发布时间属性：" + (mapping.dateCreated || "published"));
  }
  const rules: Record<string, string[]> = {
    title: ["string", "array"], categories: ["array"], mt_keywords: ["array"], slug: ["string"],
    post_type: ["string"], mt_allow_comments: ["number"], mt_excerpt: ["string"], post_status: ["string"]
  };
  for (const [field, types] of Object.entries(rules)) {
    const key = mapping[field as keyof typeof mapping];
    const value = data[key];
    if (!key || value == null) continue;
    const type = Array.isArray(value) ? "array" : typeof value;
    if (!types.includes(type) || (Array.isArray(value) && value.some(item => typeof item !== "string"))) {
      throw new Error(`属性 ${key} 的类型有误：列表请使用 YAML 列表，文本请使用字符串。`);
    }
  }
  for (const [field, required] of Object.entries(settings.fieldRequired)) {
    const key = mapping[field as keyof typeof mapping];
    if (required && key && !["title", "dateCreated"].includes(field) && !(key in data)) {
      throw new Error(`缺少必填属性：${key}`);
    }
  }
  const id = data.typecho_postid;
  if (id != null && id !== "" && !/^[1-9]\d*$/.test(String(id))) {
    throw new Error("typecho_postid 必须是有效文章 ID；新建文章请删除该属性。");
  }
}
