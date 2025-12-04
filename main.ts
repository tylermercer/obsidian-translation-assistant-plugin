import {
	App,
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	ItemView,
	WorkspaceLeaf
} from 'obsidian';

import { TranslatorSettings, DEFAULT_SETTINGS } from './types';

const VIEW_TYPE_TRANSLATION_ASSISTANT = 'translation-assistant-view';

export default class AnthropicTranslatorPlugin extends Plugin {
	settings: TranslatorSettings;
	view?: TranslatorSidebarView;

	async onload() {
		await this.loadSettings();

		// Add a ribbon icon to open the view
		this.addRibbonIcon('languages', 'Open Translator', () => {
			new Notice('Opening Translator sidebar…');
			this.activateView()
				.then(() => {
					return new Notice('Translator sidebar opened.');
				}).catch((e) => {
					console.error(e);
					new Notice('Error opening Translator sidebar: ' + String(e));
				});
		});

		// Register the sidebar view
		this.registerView(
			VIEW_TYPE_TRANSLATION_ASSISTANT,
			(leaf: WorkspaceLeaf) => (this.view = new TranslatorSidebarView(leaf, this))
		);

		// // Add commands that operate on the active editor
		this.addCommand({
			id: 'translation-assistant-suggest-assistance',
			name: 'Suggest translation assistance at cursor',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.handleSuggestionRequest(editor);
			}
		});

		this.addCommand({
			id: 'translation-assistant-suggest-word-choices',
			name: 'Suggest word choices at cursor',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.handleSuggestionRequest(editor, { mode: 'words' });
			}
		});

		this.addSettingTab(new TranslatorSettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TRANSLATION_ASSISTANT);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView() {
		const leaf = (this.app.workspace.getRightLeaf(false) ??
			this.app.workspace.getRightLeaf(true))!;
			
		if (!leaf) {
			new Notice('Unable to open Translator sidebar.');
			return;
		}

		await leaf.setViewState({
			type: VIEW_TYPE_TRANSLATION_ASSISTANT,
			active: true
		});
		this.app.workspace.revealLeaf(leaf);
	}

	async handleSuggestionRequest(editor: Editor, opts: { mode?: string } = {}) {
		if (!this.view) {
			new Notice('Open the Anthropic Translator sidebar first.');
			return;
		}

		const cursor = editor.getCursor();
		const line = cursor.line;
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('No active file in editor.');
			return;
		}

		const content = await this.app.vault.read(file);
		const spanishContext = extractContextAtPosition(content, editor.getCursor());

		if (!this.settings.sourceFilePath) {
			new Notice('No source file selected in the plugin settings or sidebar.');
			return;
		}

		const sourceFile = this.app.vault.getAbstractFileByPath(this.settings.sourceFilePath);
		if (!sourceFile) {
			new Notice('Selected source file not found in the vault.');
			return;
		}

		// Read English source
		const englishText = await this.app.vault.read(sourceFile as any);

		// Heuristic: match by line number (simple v1)
		const englishLine = getLineSafe(englishText, line);

		// Build prompt
		const prompt = buildPrompt({ englishLine, spanishContext, mode: opts.mode || 'general' });

		// Show loading in the view
		this.view.showLoading();

		try {
			const response = await callAnthropicApi(this.settings.anthropicApiKey, prompt);
			this.view.showResult(response);
		} catch (e) {
			console.error(e);
			this.view.showError(String(e));
		}
	}
}

/** Utility functions and classes **/

function extractContextAtPosition(content: string, cursor: { line: number; ch: number }) {
	const lines = content.split(/\r?\n/);
	const lineIndex = cursor.line;

	const prev = lines[Math.max(0, lineIndex - 1)] || '';
	const cur = lines[lineIndex] || '';
	const next = lines[Math.min(lines.length - 1, lineIndex + 1)] || '';

	return `${prev}\n${cur}\n${next}`.trim();
}

function getLineSafe(text: string, lineNumber: number) {
	const lines = text.split(/\r?\n/);
	if (lineNumber < 0 || lineNumber >= lines.length) return '';
	return lines[lineNumber];
}

function buildPrompt({ englishLine, spanishContext, mode }: { englishLine: string; spanishContext: string; mode: string }) {
	// Keep the prompt compact and clear. The Anthropic model should be instructed to return JSON with suggestions.
	return `You are an assistant helping with Spanish translations.\n\nEnglish source (single line):\n"${englishLine.replace(/"/g, '\\"')}"\n\nSpanish context around the cursor:\n"""\n${spanishContext}\n"""\n\nTask: Provide helpful suggestions for the Spanish text at the cursor. If the text is missing, propose full translations for the English source line. Offer:\n- A short corrected / suggested Spanish phrase (1-2 options).\n- Alternative word choices (comma-separated).\n- Notes about grammar or register.\n\nReturn the result as plain text (can include short bullets). Don't be verbose.`;
}

async function callAnthropicApi(apiKey: string, prompt: string) {
	if (!apiKey || apiKey.trim().length === 0) throw new Error('Missing Anthropic API key. Set it in plugin settings.');

	// NOTE: Anthropic endpoints and parameters may change. This uses a generic completion POST.
	// Adjust to the exact endpoint and request body for the Anthropic model you use.

	const body = {
		prompt,
		model: 'claude-2',
		max_tokens: 300
	} as any;

	const res = await fetch('https://api.anthropic.com/v1/complete', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': apiKey
		},
		body: JSON.stringify(body)
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Anthropic API error ${res.status}: ${text}`);
	}

	const data = await res.json();
	// response shape varies. Try to get a reasonable text from common fields.
	const output = (data.completion || data.text || data.output || data.result) as string | undefined;
	if (typeof output === 'string') return output;

	// Fallback: try to get the first choice
	if (data.choices && data.choices[0] && data.choices[0].text) return data.choices[0].text;

	return JSON.stringify(data);
}

class TranslatorSidebarView extends ItemView {
	plugin: AnthropicTranslatorPlugin;
	containerElInner: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: AnthropicTranslatorPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.containerElInner = createDiv();
	}

	getViewType() {
		return VIEW_TYPE_TRANSLATION_ASSISTANT;
	}

	getDisplayText() {
		return 'Anthropic Translator';
	}

	async onOpen() {
		const container = this.containerEl;
		container.empty();

		// Header: source file selector
		const header = container.createEl('div', { cls: 'translator-header' });
		header.createEl('label', { text: 'Source file (English):' });

		// Simple selector: list markdown files
		const select = header.createEl('select');
		select.style.width = '100%';

		const files = this.app.vault.getMarkdownFiles();
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

		// API key field
		const apiWrap = container.createEl('div', { cls: 'translator-api' });
		apiWrap.createEl('label', { text: 'Anthropic API key:' });
		const apiInput = apiWrap.createEl('input') as HTMLInputElement;
		apiInput.type = 'password';
		apiInput.style.width = '100%';
		apiInput.value = this.plugin.settings.anthropicApiKey || '';
		apiInput.onchange = async () => {
			this.plugin.settings.anthropicApiKey = apiInput.value.trim();
			await this.plugin.saveSettings();
			new Notice('API key saved.');
		};

		// Suggestions area
		const suggestions = container.createEl('div', { cls: 'translator-suggestions' });
		suggestions.style.marginTop = '8px';
		suggestions.style.whiteSpace = 'pre-wrap';
		suggestions.style.maxHeight = '60vh';
		suggestions.style.overflow = 'auto';
		suggestions.textContent = 'Press the command (from editor) to request suggestions.';

		// Expose helper methods
		(this as any).showLoading = () => {
			suggestions.textContent = 'Loading…';
		};

		(this as any).showResult = (text: string) => {
			suggestions.textContent = text;
		};

		(this as any).showError = (err: string) => {
			suggestions.textContent = 'Error: ' + err;
		};
	}

	async onClose() {
		// Nothing special
	}

	showLoading() {
		// Placeholder, overridden in onOpen
	}
	showResult(text: string) {
		// Placeholder, overridden in onOpen
	}
	showError(err: string) {
		// Placeholder, overridden in onOpen
	}
}

class TranslatorSettingTab extends PluginSettingTab {
	plugin: AnthropicTranslatorPlugin;

	constructor(app: App, plugin: AnthropicTranslatorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Translation Assistant Settings' });

		new Setting(containerEl)
			.setName('Anthropic API key')
			.setDesc('Enter your Anthropic API key. Stored in plugin settings.')
			.addText((text) =>
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.anthropicApiKey || '')
					.onChange(async (value) => {
						this.plugin.settings.anthropicApiKey = value.trim();
						await this.plugin.saveSettings();
						new Notice('API key saved.');
					})
			);

		new Setting(containerEl)
			.setName('Default source file')
			.setDesc('Optional: default English source file path within vault.')
			.addText((text) =>
				text
					.setPlaceholder('path/to/file.md')
					.setValue(this.plugin.settings.sourceFilePath || '')
					.onChange(async (value) => {
						this.plugin.settings.sourceFilePath = value.trim() || null;
						await this.plugin.saveSettings();
						new Notice('Default source file saved.');
					})
			);
	}
}

// Helper to create a div without TypeScript complaining about createDiv in strict contexts
function createDiv() {
	const d = document.createElement('div');
	return d;
}