import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

const isTest = process.env.NODE_ENV === 'test';

export const rootLogger = pino({
	level: isTest ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
	transport:
		process.env.NODE_ENV === 'development'
			? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
			: undefined,
	base: { service: 'camila-agent' },
	// Timestamps in BRT (America/Bahia, UTC-3) — easier to correlate with WhatsApp times
	timestamp: () => {
		const d = new Date();
		const isoLocal = d.toLocaleString('sv-SE', { timeZone: 'America/Bahia' }).replace(' ', 'T');
		const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
		return `,"time":"${isoLocal}.${ms}-03:00"`;
	},
});

export type Logger = pino.Logger;

export function createRequestLogger(telefone?: string): Logger {
	return rootLogger.child({
		correlationId: uuidv4(),
		...(telefone ? { telefone } : {}),
	});
}
