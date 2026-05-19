import { z } from 'zod';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { UazapiClient } from '../../clients/uazapi.js';
import type { LeadManager } from '../../domain/lead.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const inputSchema = z.object({
	telefone: z.string().describe('Telefone da cliente'),
});

type Input = z.infer<typeof inputSchema>;

export function createEnviarCatalogo(deps: {
	uazapi: UazapiClient;
	supabase: AppSupabaseClient;
	leadManager: LeadManager;
}): ToolDefinition<Input> {
	const { uazapi, supabase, leadManager } = deps;

	return {
		name: 'enviar_catalogo',
		description:
			'Envia o catálogo de serviços (PDF) para a cliente via WhatsApp. Verifica se já foi enviado nas últimas 6h.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			// Check if already sent recently
			const lead = await leadManager.getLead(input.telefone);
			if (lead && leadManager.wasCatalogoSentRecently(lead)) {
				return { status: 'ok', ja_enviado: true, mensagem: 'Catálogo já enviado nesta conversa.' };
			}

			// UAZAPI accepts public URL in `file` field (lighter than base64, no size limits)
			try {
				const publicUrl = await supabase.getPublicUrl('servicos.pdf');
				await uazapi.sendMedia({
					number: input.telefone,
					type: 'document',
					fileBase64: publicUrl, // field name is `file` in UAZAPI; accepts URL or base64
					docName: 'Catálogo Camila Rosario Academy.pdf',
				});
			} catch (err) {
				return {
					status: 'erro',
					razao: `Falha ao enviar catálogo: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			// Mark as sent
			try {
				await leadManager.markPdfCatalogoEnviado(input.telefone);
			} catch {
				/* best-effort */
			}

			return { status: 'ok', ja_enviado: false, mensagem: 'Catálogo enviado com sucesso.' };
		},
	};
}
