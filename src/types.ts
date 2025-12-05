export interface TranslationAssistantSettings {
  anthropicApiKey: string;
  sourceFilePath: string | null;
}

export const DEFAULT_SETTINGS: TranslationAssistantSettings = {
  anthropicApiKey: "",
  sourceFilePath: null
};

export const VIEW_TYPE_TRANSLATION_ASSISTANT = 'translation-assistant-view';