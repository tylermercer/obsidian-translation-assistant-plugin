import Anthropic from "@anthropic-ai/sdk";

export async function callAnthropicApiStream(
    apiKey: string,
    { systemPrompt, userPrompt }: { systemPrompt: string; userPrompt: string },
    handleChunk: (text: string) => void,
    signal?: AbortSignal,
) {
    if (!apiKey || apiKey.trim().length === 0) {
        throw new Error('Missing Anthropic API key. Set it in plugin settings.');
    }

    const anthropic = new Anthropic({
            apiKey,
            dangerouslyAllowBrowser: true, // It's BYOK anyway
    });

    
    console.log('Calling Anthropic API...');

    const stream = anthropic.messages
        .stream(
            {
                model: "claude-haiku-4-5-20251001",
                max_tokens: 150,
                system: systemPrompt,
                messages: [{ role: "user", content: userPrompt }],
            },
            { signal }
        )
        .on("text", handleChunk);

    const final = await stream.finalText();
    return final;
}
