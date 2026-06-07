/**
 * Lock in-process serializando criações de agendamento por (profissional + dia).
 *
 * Por quê: a verificação de disponibilidade (horariosVagos / listAgendamentos)
 * tem eventual consistency no Trinks. Sem serializar, duas clientes pedindo o
 * mesmo horário quase ao mesmo tempo podem ambas "ver vago" e criar duplicado.
 *
 * O Easypanel roda instância única, então um mutex em memória resolve: enquanto
 * uma criação pro mesmo profissional+dia está em andamento (validar→criar→verificar),
 * a próxima espera. Chaves de dias/profissionais diferentes rodam em paralelo.
 */

const tails = new Map<string, Promise<unknown>>();

/**
 * Executa `fn` com exclusão mútua pela chave. Chamadas com a mesma chave
 * rodam em série (uma após a outra); chaves diferentes rodam em paralelo.
 */
export async function withAgendamentoLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const anterior = tails.get(key) ?? Promise.resolve();
	// A nova execução só começa quando a anterior terminar (sucesso OU erro).
	const minha = anterior.then(fn, fn);
	// Vira a nova "cauda" da fila. Swallow do erro pra não quebrar o encadeamento.
	tails.set(
		key,
		minha.then(
			() => undefined,
			() => undefined,
		),
	);
	return minha;
}

/** Chave canônica profissional+dia. */
export function lockKey(profissionalId: number, dataISO: string): string {
	return `${profissionalId}:${dataISO.substring(0, 10)}`;
}
