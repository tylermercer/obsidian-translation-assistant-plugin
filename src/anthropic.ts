import Anthropic, { ClientOptions } from "@anthropic-ai/sdk";

export async function callAnthropicApiStream(
    apiKey: string,
    prompt: string,
    handleChunk: (text: string) => void,
    signal?: AbortSignal,
) {
    if (!apiKey || apiKey.trim().length === 0) {
        throw new Error('Missing Anthropic API key. Set it in plugin settings.');
    }

    const options: ClientOptions = {
        apiKey,
        dangerouslyAllowBrowser: true, // It's BYOK anyway
    }

    console.log(options);

    const anthropic = new Anthropic(options);

    const stream = anthropic.messages
        .stream(
            {
                model: "claude-haiku-4-5-20251001", // pick your model
                max_tokens: 300,
                messages: [{ role: "user", content: prompt }],
            },
            { signal }
        )
        .on("text", handleChunk);

    const final = await stream.finalText();
    return final;
}
