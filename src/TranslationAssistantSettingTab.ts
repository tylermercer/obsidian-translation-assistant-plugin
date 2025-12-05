import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import AnthropicTranslatorPlugin from "./main";

export class TranslationAssistantSettingTab extends PluginSettingTab {
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