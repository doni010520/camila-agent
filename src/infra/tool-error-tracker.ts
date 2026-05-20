/**
 * Tracks tool errors in a sliding window (last hour) and triggers an alert
 * to the team WhatsApp group when the rate exceeds a threshold.
 *
 * In-memory: state resets on container restart, which is fine — alerts are
 * meant to catch acute spikes, not historical patterns.
 */
import { rootLogger } from './logger.js';

const WINDOW_MS = 60 * 60 * 1000; // 1h
const DEFAULT_THRESHOLD = 10; // errors/hour to fire alert
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1h between alerts to avoid spam

interface ErrorEvent {
	at: number;
	tool: string;
	razao: string;
}

const events: ErrorEvent[] = [];
let lastAlertAt = 0;

export interface AlertSink {
	sendAlert(summary: string): Promise<void>;
}

export function recordToolError(tool: string, razao: string, sink?: AlertSink, threshold = DEFAULT_THRESHOLD): void {
	const now = Date.now();
	events.push({ at: now, tool, razao });

	// drop events older than window
	while (events.length > 0 && events[0] !== undefined && now - events[0].at > WINDOW_MS) {
		events.shift();
	}

	const log = rootLogger.child({ module: 'tool-error-tracker' });

	if (events.length >= threshold && now - lastAlertAt >= ALERT_COOLDOWN_MS) {
		lastAlertAt = now;
		const counts: Record<string, number> = {};
		for (const e of events) counts[e.tool] = (counts[e.tool] ?? 0) + 1;
		const summary = Object.entries(counts)
			.sort((a, b) => b[1] - a[1])
			.map(([t, n]) => `${t}: ${n}`)
			.join(', ');
		const text = `🚨 *Alerta Helena*\n\n${events.length} erros de tool na última hora.\n\nDetalhe: ${summary}\n\nÚltimo erro: ${tool} → ${razao}`;
		log.warn({ totalErrors: events.length, counts }, 'Tool error threshold exceeded');
		if (sink) {
			sink.sendAlert(text).catch((err) => log.error({ err }, 'Failed to send tool error alert'));
		}
	}
}

/** For tests/debug. */
export function _resetTracker(): void {
	events.length = 0;
	lastAlertAt = 0;
}
