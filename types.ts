export interface TranslatorSettings {
  anthropicApiKey: string;
  sourceFilePath: string | null;
}

export const DEFAULT_SETTINGS: TranslatorSettings = {
  anthropicApiKey: "",
  sourceFilePath: null
};