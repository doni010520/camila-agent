import { z } from 'zod';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { UazapiClient } from '../../clients/uazapi.js';
import type { LeadManager } from '../../domain/lead.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const COURSE_FILES = [
	{ path: 'portfolio.pdf', name: 'Portfólio CR.pdf', type: 'document' as const },
	{
		path: 'tabela-valores-curso.pdf',
		name: 'Tabela de Valores - Curso.pdf',
		type: 'document' as const,
	},
	{ path: 'nova-modalidade.jpeg', name: 'Nova Modalidade.jpeg', type: 'image' as const },
	{ path: 'workshop-fox.pdf', name: 'Workshop FOX.pdf', type: 'document' as const },
	{ path: 'workshop-hidragloss.pdf', name: 'Workshop Hidragloss.pdf', type: 'document' as const },
];

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const inputSchema = z.object({
	telefone: z.string().describe('Telefone da cliente'),
});

type Input = z.infer<typeof inputSchema>;

export function createEnviarPdfCurso(deps: {
	uazapi: UazapiClient;
	supabase: AppSupabaseClient;
	leadManager: LeadManager;
}): ToolDefinition<Input> {
	const { uazapi, supabase, leadManager } = deps;

	return {
		name: 'enviar_pdf_curso',
		description:
			'Envia os 5 documentos do curso (portfólio, tabela de valores, nova modalidade, workshops).',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			const lead = await leadManager.getLead(input.telefone);
			if (lead?.pdf_curso_enviado_em) {
				const hours =
					(Date.now() - new Date(lead.pdf_curso_enviado_em).getTime()) / (1000 * 60 * 60);
				if (hours < 6) {
					return {
						status: 'ok',
						ja_enviado: true,
						mensagem: 'PDFs do curso já enviados nesta conversa.',
					};
				}
			}

			let enviados = 0;
			for (const file of COURSE_FILES) {
				try {
					// Use public URL (avoids base64 size limit + faster)
					const publicUrl = await supabase.getPublicUrl(file.path);
					await uazapi.sendMedia({
						number: input.telefone,
						type: file.type,
						fileBase64: publicUrl,
						docName: file.type === 'document' ? file.name : undefined,
					});
					enviados++;
					if (enviados < COURSE_FILES.length) await sleep(1000);
				} catch {
					// Continue sending remaining files even if one fails
				}
			}

			try {
				await leadManager.markPdfCursoEnviado(input.telefone);
			} catch {
				/* best-effort */
			}

			return {
				status: 'ok',
				ja_enviado: false,
				total_enviados: enviados,
				total_esperado: COURSE_FILES.length,
				mensagem: `${enviados}/${COURSE_FILES.length} documentos do curso enviados.`,
			};
		},
	};
}
