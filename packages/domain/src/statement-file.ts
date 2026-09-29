import { readOfxStatement } from "./ofx";
import {
	type CsvMapping,
	parseCsv,
	readCsvStatement,
	type Statement,
	type StatementFormat,
	statementFormat,
} from "./statements";

/**
 * Reads a statement file: OFX and QFX directly, CSV with its column mapping. A CSV without a
 * mapping reads as nothing, until the Parent has said which columns are which.
 */
export function readStatement(
	content: string,
	mapping: CsvMapping | null,
): { format: StatementFormat; statement: Statement } {
	const format = statementFormat(content);
	if (format === "ofx") return { format, statement: readOfxStatement(content) };
	return {
		format,
		statement: mapping
			? readCsvStatement(parseCsv(content), mapping)
			: { lines: [], closingBalance: null, unreadable: [] },
	};
}
