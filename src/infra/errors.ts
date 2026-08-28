export class AppError extends Error {
	public readonly statusCode: number;
	public readonly isOperational: boolean;
	public readonly details?: unknown;

	constructor(message: string, statusCode = 500, details?: unknown, isOperational = true) {
		super(message);
		this.name = this.constructor.name;
		this.statusCode = statusCode;
		this.isOperational = isOperational;
		this.details = details;
		Error.captureStackTrace(this, this.constructor);
	}
}

export class TrinksError extends AppError {
	constructor(message: string, statusCode = 502, details?: unknown) {
		super(`Trinks: ${message}`, statusCode, details);
	}
}

export class UazapiError extends AppError {
	constructor(message: string, statusCode = 502, details?: unknown) {
		super(`UAZAPI: ${message}`, statusCode, details);
	}
}

/**
 * A resposta da API veio num formato que não casa com o schema.
 *
 * ⚠️ NUNCA retentar: o problema é o CONTRATO, não a rede. Retentar um POST por
 * causa disso cria registro duplicado — foi o que aconteceu em 27/08/2026, quando
 * o POST /v1/clientes (que devolve só `{id}`) foi retentado 2x e criou 3 clientes.
 */
export class TrinksSchemaError extends TrinksError {}

export class ValidationError extends AppError {
	constructor(message: string, details?: unknown) {
		super(message, 400, details);
	}
}

export class VerifyAfterWriteError extends AppError {
	constructor(resource: string, id: string | number, details?: unknown) {
		super(`Escrita não confirmada por leitura subsequente: ${resource} id=${id}`, 502, details);
	}
}
