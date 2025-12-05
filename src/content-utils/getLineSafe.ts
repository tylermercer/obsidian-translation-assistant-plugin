export function getLineSafe(text: string, lineNumber: number) {
	const lines = text.split(/\r?\n/);
	if (lineNumber < 0 || lineNumber >= lines.length) return '';
	return lines[lineNumber];
}