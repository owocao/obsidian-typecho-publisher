import { App, ButtonComponent, Modal } from "obsidian";
import { readProperties, writeProperties } from "./frontmatter";

/** Review all properties; the article body never enters the editor. */
export class PropertiesReviewModal extends Modal {
  private resolveReview!: (yaml: string | null) => void;
  private settled = false;
  private busy = false;
  private editor!: HTMLTextAreaElement;
  private statusEl!: HTMLElement;
  private confirmButton!: ButtonComponent;
  private regenerateButton?: ButtonComponent;

  constructor(app: App, private yaml: string, private tagKey: string,
    private generate: ((data: Record<string, unknown>) => Promise<string[]>) | null, private generateInitially: boolean,
    private validate: (data: Record<string, unknown>) => void) { super(app); }

  review(): Promise<string | null> {
    return new Promise(resolve => { this.resolveReview = resolve; this.open(); });
  }

  onOpen() {
    this.titleEl.setText("确认文章属性");
    this.contentEl.createEl("p", { text: "仅编辑笔记顶部两条 --- 之间的属性，不包含正文。保留 typecho_postid 会更新文章，删除它会新建文章。确认后保存属性并发布。" });
    this.editor = this.contentEl.createEl("textarea", { cls: "typecho-properties-editor" });
    this.editor.value = this.yaml;
    this.editor.setAttribute("aria-label", "文章属性 YAML");
    this.editor.spellcheck = false;
    this.statusEl = this.contentEl.createEl("p");
    const actions = this.contentEl.createEl("div", { cls: "typecho-properties-actions" });
    if (this.generate) {
      this.regenerateButton = new ButtonComponent(actions).setButtonText("重新生成标签")
        .onClick(() => { void this.regenerate(); });
    }
    this.confirmButton = new ButtonComponent(actions).setButtonText("确认并发布").setCta()
      .onClick(() => {
        if (this.busy) return;
        try {
          this.validate(readProperties(this.editor.value));
          this.finish(this.editor.value);
        } catch (error) { this.showError(error); }
      });
    new ButtonComponent(actions).setButtonText("取消").onClick(() => this.finish(null));
    if (this.generateInitially) void this.regenerate();
  }

  private showError(error: unknown) {
    this.statusEl.setText(error instanceof Error ? error.message : "操作失败，请重试。");
  }

  private async regenerate() {
    if (this.busy || this.settled || !this.generate) return;
    let data: Record<string, unknown>;
    try { data = readProperties(this.editor.value); } catch (error) { this.showError(error); return; }
    this.busy = true;
    this.editor.disabled = true;
    this.confirmButton.setDisabled(true);
    this.regenerateButton?.setDisabled(true);
    this.statusEl.setText("正在生成标签…");
    try {
      const tags = await this.generate(data);
      if (this.settled) return;
      data[this.tagKey] = tags;
      this.editor.value = writeProperties(data);
      this.statusEl.setText("标签已更新，可继续手动编辑所有属性，再确认发布。");
    } catch (error) { if (!this.settled) this.showError(error); }
    finally {
      this.busy = false;
      if (!this.settled) {
        this.editor.disabled = false;
        this.confirmButton.setDisabled(false);
        this.regenerateButton?.setDisabled(false);
      }
    }
  }

  private finish(yaml: string | null) {
    if (this.settled) return;
    this.settled = true;
    this.resolveReview(yaml);
    this.close();
  }

  onClose() {
    if (!this.settled) { this.settled = true; this.resolveReview(null); }
  }
}
