import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { pushLogLine } from './log-buffer.js';

const isTest = process.env.NODE_ENV === 'test';

// Multistream: stdout (Easypanel/container logs) + in-memory ring buffer (HTTP endpoint)
const streams = isTest
	? [{ stream: { write: () => undefined } as unknown as NodeJS.WritableStream }]
	: [
			{ stream: process.stdout },
			{
				stream: {
					write: (chunk: string) => {
						pushLogLine(chunk);
						return true;
					},
				} as unknown as NodeJS.WritableStream,
			},
		];

export const rootLogger = pino(
	{
		level: isTest ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
		base: { service: 'camila-agent' },
		// Timestamps in BRT (America/Bahia, UTC-3) — easier to correlate with WhatsApp times
		timestamp: () => {
			const d = new Date();
			const isoLocal = d.toLocaleString('sv-SE', { timeZone: 'America/Bahia' }).replace(' ', 'T');
			const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
			return `,"time":"${isoLocal}.${ms}-03:00"`;
		},
	},
	pino.multistream(streams),
);

export type Logger = pino.Logger;

export function createRequestLogger(telefone?: string): Logger {
	return rootLogger.child({
		correlationId: uuidv4(),
		...(telefone ? { telefone } : {}),
	});
}
