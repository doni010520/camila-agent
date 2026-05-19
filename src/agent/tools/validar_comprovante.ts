import { z } from 'zod';
import type { AppOpenAIClient } from '../../clients/openai.js';
import type { UazapiClient } from '../../clients/uazapi.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const VISION_PROMPT = `Extraia do comprovante PIX os seguintes dados e retorne APENAS um JSON válido (sem markdown, sem texto extra):
{
  "valor": <número em reais, ex: 48.00>,
  "destinatario": "<nome do destinatário>",
  "chave_pix": "<chave utilizada>",
  "status": "<concluído ou pendente ou falhou>"
}
Se não for um comprovante PIX ou não conseguir extrair, retorne: {"erro": "Não é um comprovante PIX válido"}`;

const PIX_DESTINATARIO_KEYWORDS = ['CAMILA', 'ROSARIO'];
const DEFAULT_TOLERANCE = 0.5;

const inputSchema = z.object({
	imagem_url: z.string().describe('URL da imagem do comprovante (content.URL do UAZAPI)'),
	valor_esperado: z.number().describe('Valor esperado do sinal em R$'),
});

type Input = z.infer<typeof inputSchema>;

interface ComprovanteData {
	valor: number;
	destinatario: string;
	chave_pix: string;
	status: string;
	erro?: string;
}

export function createValidarComprovante(deps: {
	openai: AppOpenAIClient;
	uazapi: UazapiClient;
}): ToolDefinition<Input> {
	const { openai, uazapi } = deps;

	return {
		name: 'validar_comprovante',
		description:
			'Analisa imagem de comprovante PIX via Vision e valida valor, destinatário e status.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			// 1. Download image
			let imageBase64: string;
			try {
				const bytes = await uazapi.fetchMedia(input.imagem_url);
				imageBase64 = Buffer.from(bytes).toString('base64');
			} catch (err) {
				return {
					status: 'erro',
					razao: `Falha ao baixar imagem: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			// 2. Send to Vision
			let raw: string;
			try {
				const result = await openai.analyzeImage(imageBase64, VISION_PROMPT);
				raw = result.text;
			} catch (err) {
				return {
					status: 'erro',
					razao: `Falha na análise de imagem: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			// 3. Parse JSON from Vision response
			let data: ComprovanteData;
			try {
				const cleaned = raw.replace(/```json|```/g, '').trim();
				data = JSON.parse(cleaned) as ComprovanteData;
			} catch {
				return {
					status: 'erro',
					razao: 'Não foi possível interpretar o comprovante',
					detalhes: { raw },
				};
			}

			if (data.erro) {
				return { status: 'erro', razao: data.erro };
			}

			// 4. Validate
			const validacoes: string[] = [];

			// Destinatário
			const destUpper = (data.destinatario ?? '').toUpperCase();
			const destOk = PIX_DESTINATARIO_KEYWORDS.every((kw) => destUpper.includes(kw));
			if (!destOk)
				validacoes.push(`Destinatário "${data.destinatario}" não corresponde a CAMILA ROSARIO`);

			// Valor
			const diff = Math.abs((data.valor ?? 0) - input.valor_esperado);
			const valorOk = diff <= DEFAULT_TOLERANCE;
			if (!valorOk)
				validacoes.push(`Valor R$ ${data.valor} difere do esperado R$ ${input.valor_esperado}`);

			// Status
			const statusOk = (data.status ?? '').toLowerCase().includes('conclu');
			if (!statusOk) validacoes.push(`Status "${data.status}" não é "concluído"`);

			const valido = destOk && valorOk && statusOk;

			return {
				status: 'ok',
				valido,
				detalhes: {
					valor_encontrado: data.valor,
					valor_esperado: input.valor_esperado,
					destinatario: data.destinatario,
					chave_pix: data.chave_pix,
					status_pagamento: data.status,
				},
				...(validacoes.length > 0 ? { problemas: validacoes } : {}),
			};
		},
	};
}
