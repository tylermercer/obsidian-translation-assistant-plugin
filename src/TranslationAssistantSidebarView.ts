import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import TranslationAssistantPlugin from "./main";
import { VIEW_TYPE_TRANSLATION_ASSISTANT } from "./types";
import * as smd from './streaming-markdown';

export class TranslationAssistantSidebarView extends ItemView {
	plugin: TranslationAssistantPlugin;
	containerElInner: HTMLElement;
	suggestionsEl: HTMLElement;
	parser: ReturnType<typeof smd.parser> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TranslationAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.containerElInner = createDiv();
	}

	getViewType() {
		return VIEW_TYPE_TRANSLATION_ASSISTANT;
	}

	getDisplayText() {
		return 'Translation Assistant';
	}

	async onOpen() {
		const container = this.containerEl;
		container.empty();

		// Header: source file selector
		const header = container.createEl('div', { cls: 'translator-header' });
		header.createEl('label', { text: 'Source file (English):' });

		// Simple selector: list markdown files (and MDX)
		const select = header.createEl('select');

		const files = this.app.vault.getFiles().filter(f => ['md', 'mdx'].includes(f.extension));
		files.sort((a, b) => a.path.localeCompare(b.path));

		const emptyOpt = select.createEl('option');
		emptyOpt.value = '';
		emptyOpt.text = '-- Select --';

		files.forEach((f) => {
			const opt = select.createEl('option');
			opt.value = f.path;
			opt.text = f.path;
		});

		if (this.plugin.settings.sourceFilePath) select.value = this.plugin.settings.sourceFilePath;

		select.onchange = async () => {
			const val = (select.value && select.value !== '') ? select.value : null;
			this.plugin.settings.sourceFilePath = val;
			await this.plugin.saveSettings();
			new Notice('Source file saved.');
		};

		// Suggestions area
		this.suggestionsEl = container.createEl('div', { cls: 'translator-suggestions' });
		this.suggestionsEl.textContent = 'Press the command (from editor) to request suggestions.';
	}

	async onClose() {
		// Nothing special
	}

	showLoading() {
		if (!this.suggestionsEl) return;
		this.suggestionsEl.textContent = 'Loading…';
	}

	private initializeParser() {
		if (!this.suggestionsEl) return;
		// Clear element and set up parser
		this.suggestionsEl.innerHTML = '';
		const renderer = smd.default_renderer(this.suggestionsEl);
		this.parser = smd.parser(renderer);
	}

	appendResult(text: string) {
		if (!this.parser) {
			// Fallback: if parser not initialized, initialize it
			this.initializeParser();
		}
		if (this.parser) {
			smd.parser_write(this.parser, text);
		}
	}

	setResult(text: string) {
		// Reset parser and render full markdown
		this.initializeParser();
		if (this.parser) {
			smd.parser_write(this.parser, text);
		}
	}
	clearResult() {
		if (!this.suggestionsEl) return;
		this.suggestionsEl.textContent = '';
	}
	showError(err: string) {
		if (!this.suggestionsEl) return;
		this.suggestionsEl.textContent = err;
	}
}