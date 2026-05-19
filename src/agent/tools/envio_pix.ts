import { z } from 'zod';
import type { UazapiClient } from '../../clients/uazapi.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

// PIX data for Camila Rosario Academy (from Helena v13 prompt + REFERENCE-PAYLOADS)
const PIX_KEY = 'bf673a9f-8117-49c0-ad9e-82e318f665b1';
const PIX_NAME = 'CAMILA SILVA DO ROSARIO';

const inputSchema = z.object({
	telefone: z.string().describe('Telefone da cliente'),
	valor: z.number().describe('Valor do sinal (para referência na mensagem)'),
});

type Input = z.infer<typeof inputSchema>;

export function createEnvioPix(deps: { uazapi: UazapiClient }): ToolDefinition<Input> {
	const { uazapi } = deps;

	return {
		name: 'envio_pix',
		description: 'Envia o botão PIX do WhatsApp para a cliente efetuar o pagamento do sinal.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			try {
				await uazapi.sendPixButton({
					number: input.telefone,
					pixType: 'EVP',
					pixKey: PIX_KEY,
					pixName: PIX_NAME,
				});
				return {
					status: 'ok',
					valor_sinal: input.valor,
					mensagem: `Botão PIX enviado. Valor do sinal: R$ ${input.valor.toFixed(2)}`,
				};
			} catch (err) {
				return {
					status: 'erro',
					razao: `Falha ao enviar PIX: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}
		},
	};
}
