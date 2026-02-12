import {
    Editor,
    MarkdownView,
    Notice,
    Plugin,
    WorkspaceLeaf
} from 'obsidian';
import { callAnthropicApiStream } from './anthropic';
import { TranslationAssistantSettingTab } from './TranslationAssistantSettingTab';
import { TranslationAssistantSidebarView } from './TranslationAssistantSidebarView';
import {
    DEFAULT_SETTINGS,
    TranslationAssistantSettings,
    VIEW_TYPE_TRANSLATION_ASSISTANT,
} from './types';

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

export default class AnthropicTranslatorPlugin extends Plugin {
    settings: TranslationAssistantSettings;
    view?: TranslationAssistantSidebarView;

    async onload() {
        console.log('Loading Translation Assistant Plugin...');
        await this.loadSettings();

        // Add a ribbon icon to open the view
        this.addRibbonIcon('languages', 'Open Translation Assistant', async () => {
            await this.activateView();
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
            },
        });

        this.addCommand({
            id: 'translation-assistant-suggest-word-choices',
            name: 'Suggest word choices at cursor',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.handleSuggestionRequest(editor, { mode: 'words' });
            }
        });

        this.addCommand({
            id: 'translation-assistant-activate',
            name: 'Open Translation Assistant sidebar',
            callback: async () => {
                await this.activateView();
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
        console.log('Opening Translation Assistant sidebar view...');
        const leaf = (this.app.workspace.getLeftLeaf(false) ??
            this.app.workspace.getLeftLeaf(true))!;

        if (!leaf) {
            new Notice('Unable to open Translation Assistant sidebar.');
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
            new Notice('Open the Translation Assistant sidebar first.');
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

function buildPrompt({ englishLine, spanishContext, mode }: { englishLine: string; spanishContext: string; mode: string }): {
    systemPrompt: string; userPrompt: string;
} {
    return {
        systemPrompt: `You are a language learning assistant. Give the user simple, concise instruction for what he or she could type next in the translation they give you, OR how they could make it better. Choose only the most relevant of those two. If the user's translation is unfinished mid-sentence, you may assume they are looking for the next word or phrase. Omit praise or other filler text that isn't relevant instruction. Give context for your guidance to promote deep learning, e.g. explain the denotation of words you offer as suggestions.`,
        userPrompt: `English source: ${englishLine}\n\nWIP Spanish translation: ${spanishContext}`
    };
}