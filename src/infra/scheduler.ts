/**
 * Scheduler in-process — substitui o cron do Easypanel.
 *
 * Carrega config de `cron_jobs` no Postgres na startup, agenda cada job via
 * node-cron, e a cada 60s consulta o banco pra ver se alguém mudou a config
 * (via dashboard). Se mudou, re-agenda.
 *
 * Vantagens vs cron externo: zero config manual, versionado no app, on/off
 * sem deploy via UI. Desvantagem: se o container cair, os jobs não rodam.
 */
import cron from 'node-cron';
import type { PostgresClient } from '../clients/postgres.js';
import { rootLogger } from './logger.js';

const TZ = 'America/Bahia';
const RELOAD_INTERVAL_MS = 60 * 1000;

type JobRunner = () => Promise<unknown>;

export class Scheduler {
	private readonly pg: PostgresClient;
	private readonly runners: Map<string, JobRunner> = new Map();
	private readonly tasks: Map<string, cron.ScheduledTask[]> = new Map();
	private currentConfig: string = ''; // fingerprint pra detectar mudança
	private reloadTimer?: NodeJS.Timeout;
	private readonly log = rootLogger.child({ module: 'scheduler' });

	constructor(pg: PostgresClient) {
		this.pg = pg;
	}

	/** Registra um runner pra um job_name. Chame antes de start(). */
	register(jobName: string, runner: JobRunner): void {
		this.runners.set(jobName, runner);
	}

	async start(): Promise<void> {
		await this.reload();
		this.reloadTimer = setInterval(() => {
			this.reload().catch((err) => this.log.error({ err }, 'Scheduler reload failed'));
		}, RELOAD_INTERVAL_MS);
		this.log.info({ jobs: Array.from(this.runners.keys()) }, 'Scheduler started');
	}

	async stop(): Promise<void> {
		if (this.reloadTimer) clearInterval(this.reloadTimer);
		for (const tasks of this.tasks.values()) {
			for (const t of tasks) t.stop();
		}
		this.tasks.clear();
	}

	/** Lê config do banco e re-agenda se mudou. */
	private async reload(): Promise<void> {
		const config = await this.pg.listCronJobs();
		const fingerprint = JSON.stringify(
			config.map((c) => [c.job_name, c.enabled, c.cron_expressions]),
		);
		if (fingerprint === this.currentConfig) return;

		this.log.info({ jobs: config.length }, 'Reloading cron config');
		this.currentConfig = fingerprint;

		// Cancela tasks antigas
		for (const tasks of this.tasks.values()) {
			for (const t of tasks) t.stop();
		}
		this.tasks.clear();

		// Cria novas tasks
		for (const job of config) {
			const runner = this.runners.get(job.job_name);
			if (!runner) {
				this.log.warn({ jobName: job.job_name }, 'No runner registered, skipping');
				continue;
			}
			if (!job.enabled) {
				this.log.info({ jobName: job.job_name }, 'Job disabled, not scheduling');
				continue;
			}
			const tasks: cron.ScheduledTask[] = [];
			for (const expr of job.cron_expressions ?? []) {
				if (!cron.validate(expr)) {
					this.log.warn({ jobName: job.job_name, expr }, 'Invalid cron expression');
					continue;
				}
				const task = cron.schedule(
					expr,
					async () => {
						const log = this.log.child({ jobName: job.job_name, expr });
						log.info('Running scheduled job');
						try {
							const result = await runner();
							await this.pg.marcarExecucaoCron(job.job_name, result);
							log.info({ result }, 'Job complete');
						} catch (err) {
							const errInfo = { error: err instanceof Error ? err.message : 'unknown' };
							await this.pg.marcarExecucaoCron(job.job_name, errInfo).catch(() => undefined);
							log.error({ err }, 'Job failed');
						}
					},
					{ timezone: TZ },
				);
				tasks.push(task);
			}
			this.tasks.set(job.job_name, tasks);
			this.log.info(
				{ jobName: job.job_name, exprs: job.cron_expressions },
				'Job scheduled',
			);
		}
	}
}
