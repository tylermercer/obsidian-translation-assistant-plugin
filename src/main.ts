import {
    Editor,
    MarkdownView,
    Notice,
    Plugin,
    TFile,
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

/**
 * Extracts context around the cursor, but only from the body (post-frontmatter).
 */
function extractContextAtPosition(content: string, bodyLineIndex: number) {
    const lines = content.split(/\r?\n/);
    const prev = lines[Math.max(0, bodyLineIndex - 1)] || '';
    const cur = lines[bodyLineIndex] || '';
    const next = lines[Math.min(lines.length - 1, bodyLineIndex + 1)] || '';

    return `${prev}\n${cur}\n${next}`.trim();
}

/**
 * Helper to split content into frontmatter and body, returning the line offset.
 */
function parseFileStructure(content: string): { bodyLines: string[], offset: number } {
    const lines = content.split(/\r?\n/);
    if (lines[0] !== '---') {
        return { bodyLines: lines, offset: 0 };
    }

    // Find the closing ---
    let closingIndex = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') {
            closingIndex = i;
            break;
        }
    }

    if (closingIndex === -1) {
        return { bodyLines: lines, offset: 0 };
    }

    // The body starts after the closing dashes
    const offset = closingIndex + 1;
    return { 
        bodyLines: lines.slice(offset), 
        offset 
    };
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
        let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TRANSLATION_ASSISTANT)[0];
        
        if (!leaf) {
            leaf = (this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getLeftLeaf(true))!;
            await leaf.setViewState({
                type: VIEW_TYPE_TRANSLATION_ASSISTANT,
                active: true
            });
        }
        
        this.app.workspace.revealLeaf(leaf);
    }

    async handleSuggestionRequest(editor: Editor, opts: { mode?: string } = {}) {
        if (!this.view) {
            new Notice('Open the Translation Assistant sidebar first.');
            return;
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        // 1. Determine the relative line index in the current (Spanish) file
        const currentFullContent = await this.app.vault.read(activeFile);
        const { bodyLines: currentBody, offset: currentOffset } = parseFileStructure(currentFullContent);
        
        const cursor = editor.getCursor();
        const bodyLineIndex = cursor.line - currentOffset;

        if (bodyLineIndex < 0) {
            new Notice('Cursor is inside the frontmatter. Move it to the translation text.');
            return;
        }

        // 2. Get the Source (English) file
        if (!this.settings.sourceFilePath) {
            new Notice('No source file selected in settings.');
            return;
        }

        const sourceFile = this.app.vault.getAbstractFileByPath(this.settings.sourceFilePath);
        if (!(sourceFile instanceof TFile)) {
            new Notice('Selected source file not found.');
            return;
        }

        const sourceFullContent = await this.app.vault.read(sourceFile);
        const { bodyLines: sourceBody } = parseFileStructure(sourceFullContent);

        // 3. Match the line (Heuristic: Body line N matches Body line N)
        const englishLine = sourceBody[bodyLineIndex] || '[End of source file]';
        const spanishContext = extractContextAtPosition(currentBody.join('\n'), bodyLineIndex);

        // 4. Build prompt and call API
        const prompt = buildPrompt({ englishLine, spanishContext, mode: opts.mode || 'general' });

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
            this.view.showError(e.message || 'An unknown error occurred.');
        }
    }
}

function buildPrompt({ englishLine, spanishContext, mode }: { englishLine: string; spanishContext: string; mode: string }): {
    systemPrompt: string; userPrompt: string;
} {
    return {
        systemPrompt: `You are a language learning assistant. Give the user simple, concise instruction for what he or she could type next in the translation they give you, OR how they could make it better. Omit praise. Explain the denotation of words to promote deep learning.`,
        userPrompt: `Target line to translate: "${englishLine}"\n\nUser's current progress in translation (context):\n${spanishContext}`
    };
}