import {
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	WorkspaceLeaf
} from 'obsidian';
import { callAnthropicApiStream } from './anthropic';
import { extractContextAtPosition } from './content-utils/extractContentAtPosition';
import { getLineSafe } from './content-utils/getLineSafe';
import { TranslationAssistantSettingTab } from './TranslationAssistantSettingTab';
import { TranslationAssistantSidebarView } from './TranslationAssistantSidebarView';
import {
	DEFAULT_SETTINGS,
	TranslationAssistantSettings,
	VIEW_TYPE_TRANSLATION_ASSISTANT,
} from './types';

export default class AnthropicTranslatorPlugin extends Plugin {
	settings: TranslationAssistantSettings;
	view?: TranslationAssistantSidebarView;

	async onload() {
		await this.loadSettings();

		// Add a ribbon icon to open the view
		this.addRibbonIcon('languages', 'Open Translator', () => {
			this.activateView();
		});

		// Register the sidebar view
		this.registerView(
			VIEW_TYPE_TRANSLATION_ASSISTANT,
			(leaf: WorkspaceLeaf) => (this.view = new TranslationAssistantSidebarView(leaf, this))
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

		this.addSettingTab(new TranslationAssistantSettingTab(this.app, this));
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
		const leaf = (this.app.workspace.getLeftLeaf(false) ??
			this.app.workspace.getLeftLeaf(true))!;

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
			const view = this.view;
			const response = await callAnthropicApiStream(
				this.settings.anthropicApiKey,
				prompt,
				(chunk) => {
					view.appendResult(chunk);
				},
			);
			this.view.setResult(response);
		} catch (e) {
			console.error(e);
			if (e instanceof Error) {
				this.view.showError(e.message);
				return;
			}
			this.view.showError(e.message + ': ' + e.stack);
		}
	}
}

/** Utility functions and classes **/

function buildPrompt({ englishLine, spanishContext, mode }: { englishLine: string; spanishContext: string; mode: string }) {
	// Keep the prompt compact and clear. The Anthropic model should be instructed to return JSON with suggestions.
	return `You are an assistant helping with Spanish translations.\n\nEnglish source (single line):\n"${englishLine.replace(/"/g, '\\"')}"\n\nSpanish context around the cursor:\n"""\n${spanishContext}\n"""\n\nTask: Provide helpful suggestions for the Spanish text at the cursor. If the text is missing, propose full translations for the English source line. Offer:\n- A short corrected / suggested Spanish phrase (1-2 options).\n- Alternative word choices (comma-separated).\n- Notes about grammar or register.\n\nReturn the result as plain text (can include short bullets). Don't be verbose.`;
}