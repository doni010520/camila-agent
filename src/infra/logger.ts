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
	timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = pino.Logger;

export function createRequestLogger(telefone?: string): Logger {
	return rootLogger.child({
		correlationId: uuidv4(),
		...(telefone ? { telefone } : {}),
	});
}
