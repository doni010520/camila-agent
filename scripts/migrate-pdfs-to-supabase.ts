#!/usr/bin/env npx tsx
/**
 * migrate-pdfs-to-supabase.ts
 * Uploads PDF files (catalogs, course docs) from local directory to Supabase Storage bucket.
 *
 * Usage: npx tsx scripts/migrate-pdfs-to-supabase.ts ./pdfs/
 *
 * Expected directory structure:
 *   pdfs/
 *   ├── servicos.pdf              → bucket path: servicos.pdf
 *   ├── portfolio.pdf             → bucket path: portfolio.pdf
 *   ├── tabela-valores-curso.pdf  → bucket path: tabela-valores-curso.pdf
 *   ├── nova-modalidade.png       → bucket path: nova-modalidade.png
 *   ├── workshop-fox.pdf          → bucket path: workshop-fox.pdf
 *   └── workshop-hidragloss.pdf   → bucket path: workshop-hidragloss.pdf
 *
 * Pre-req: Supabase bucket "catalogos" must exist (create in Supabase Dashboard → Storage).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/infra/env.js';

const EXPECTED_FILES = [
	'servicos.pdf',
	'portfolio.pdf',
	'tabela-valores-curso.pdf',
	'nova-modalidade.png',
	'workshop-fox.pdf',
	'workshop-hidragloss.pdf',
];

async function main() {
	const env = loadEnv();
	const dir = process.argv[2];
	if (!dir) {
		console.error('Usage: npx tsx scripts/migrate-pdfs-to-supabase.ts <directory>');
		process.exit(1);
	}

	const absDir = resolve(dir);
	if (!existsSync(absDir)) {
		console.error(`Directory not found: ${absDir}`);
		process.exit(1);
	}

	const files = readdirSync(absDir);
	console.log(`📁 Found ${files.length} files in ${absDir}`);

	// Check expected files
	const missing = EXPECTED_FILES.filter((f) => !files.includes(f));
	if (missing.length > 0) {
		console.warn(`⚠️  Missing expected files: ${missing.join(', ')}`);
	}

	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
	const bucket = env.SUPABASE_STORAGE_BUCKET;

	let uploaded = 0;
	let errors = 0;

	for (const file of files) {
		const filePath = resolve(absDir, file);
		const bucketPath = basename(file);
		const ext = file.split('.').pop()?.toLowerCase();
		const contentType =
			ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'application/octet-stream';

		try {
			const data = readFileSync(filePath);
			const { error } = await supabase.storage.from(bucket).upload(bucketPath, data, {
				contentType,
				upsert: true,
			});

			if (error) {
				console.error(`❌ ${bucketPath}: ${error.message}`);
				errors++;
			} else {
				const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(bucketPath);
				console.log(`✅ ${bucketPath} → ${urlData.publicUrl}`);
				uploaded++;
			}
		} catch (err) {
			console.error(`❌ ${bucketPath}: ${err instanceof Error ? err.message : 'unknown'}`);
			errors++;
		}
	}

	console.log(`\n${uploaded} uploaded, ${errors} errors, ${missing.length} missing.`);
	process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('Script error:', err);
	process.exit(1);
});
