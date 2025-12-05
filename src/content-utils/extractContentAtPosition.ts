export function extractContextAtPosition(content: string, cursor: { line: number; ch: number }) {
    const lines = content.split(/\r?\n/);
    const lineIndex = cursor.line;

    const prev = lines[Math.max(0, lineIndex - 1)] || '';
    const cur = lines[lineIndex] || '';
    const next = lines[Math.min(lines.length - 1, lineIndex + 1)] || '';

    return `${prev}\n${cur}\n${next}`.trim();
}