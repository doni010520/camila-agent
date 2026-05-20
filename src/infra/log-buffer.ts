/**
 * In-memory ring buffer for recent log lines.
 *
 * Pino writes each log entry as one line of JSON. We attach a parallel
 * write target that pushes every line into a fixed-size circular array
 * so we can serve them via HTTP for debugging.
 *
 * Trade-off: loses on container restart. Good enough for active debug.
 */
const MAX_LINES = 1000;

const ring: string[] = [];
let cursor = 0;

export function pushLogLine(line: string): void {
	const trimmed = line.endsWith('\n') ? line.slice(0, -1) : line;
	if (!trimmed) return;
	if (ring.length < MAX_LINES) {
		ring.push(trimmed);
	} else {
		ring[cursor] = trimmed;
		cursor = (cursor + 1) % MAX_LINES;
	}
}

/** Returns log lines in chronological order, most recent last. */
export function getLogLines(limit?: number): string[] {
	const all =
		ring.length < MAX_LINES
			? ring.slice()
			: ring.slice(cursor).concat(ring.slice(0, cursor));
	if (limit && limit > 0 && limit < all.length) return all.slice(all.length - limit);
	return all;
}
