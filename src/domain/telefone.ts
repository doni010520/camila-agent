import { z } from 'zod';

/**
 * Parse any phone input into components.
 * Handles: "5571999999999", "+55 (71) 99999-9999", "71999999999", "999999999"
 */
export interface PhoneParts {
	/** Full E.164 without +: "5571999999999" */
	e164: string;
	/** Country code: "55" */
	ddi: string;
	/** Area code: "71" */
	ddd: string;
	/** Local number (8 or 9 digits): "999999999" */
	numero: string;
	/** Last 8 digits for lookups */
	last8: string;
}

const DIGITS_ONLY = /\D/g;

export function parsePhone(raw: string): PhoneParts | null {
	const digits = raw.replace(DIGITS_ONLY, '');
	if (digits.length < 8) return null;

	let ddi: string;
	let ddd: string;
	let numero: string;

	if (digits.length >= 12 && digits.startsWith('55')) {
		// Full E.164: 5571999999999 (13 digits) or 557199999999 (12 digits)
		ddi = '55';
		ddd = digits.slice(2, 4);
		numero = digits.slice(4);
	} else if (digits.length >= 10 && digits.length <= 11) {
		// DDD + number: 71999999999 (11) or 7199999999 (10)
		ddi = '55';
		ddd = digits.slice(0, 2);
		numero = digits.slice(2);
	} else if (digits.length === 8 || digits.length === 9) {
		// Local only — assume DDD 71 (Bahia default for Camila)
		ddi = '55';
		ddd = '71';
		numero = digits;
	} else if (digits.length > 13 && digits.startsWith('55')) {
		// Overly long — trim
		ddi = '55';
		ddd = digits.slice(2, 4);
		numero = digits.slice(4, 13);
	} else {
		return null;
	}

	// Normalize: ensure 9-digit mobile (BA always has 9)
	if (numero.length === 8 && ddd.startsWith('7')) {
		numero = `9${numero}`;
	}

	const e164 = `${ddi}${ddd}${numero}`;
	const last8 = numero.slice(-8);

	return { e164, ddi, ddd, numero, last8 };
}

/** Get last 8 digits for DB lookups */
export function getLast8(telefone: string): string {
	const digits = telefone.replace(DIGITS_ONLY, '');
	return digits.slice(-8);
}

/** Convert chatid from UAZAPI to E.164 digits */
export function chatidToE164(chatid: string): string {
	return chatid.split('@')[0]?.replace(DIGITS_ONLY, '') ?? '';
}

/** Zod schema for a valid phone that parsePhone can handle */
export const telefoneSchema = z
	.string()
	.refine((v) => parsePhone(v) !== null, { message: 'Telefone inválido' });
