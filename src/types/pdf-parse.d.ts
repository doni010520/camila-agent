declare module 'pdf-parse' {
	interface PdfData {
		text: string;
		numpages: number;
		numrender: number;
		info: Record<string, unknown>;
		metadata: unknown;
		version: string;
	}
	function pdfParse(buffer: Buffer | Uint8Array): Promise<PdfData>;
	export default pdfParse;
}
