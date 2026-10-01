import { type Cents, MAX_CENTS } from "./money";
import type { DayKey } from "./month";

// Statement files (CSV and OFX) read into the lines an Import brings in. Pure: the server parses
// the file again before writing, so the preview a Parent sees is the Import they get.

/** One movement of money on a statement: money in is positive, money out negative. */
export type StatementLine = {
	date: DayKey;
	amount: Cents;
	description: string;
	/** The bank's own ID for it (OFX FITID), when the file has one. */
	bankId: string | null;
};

/** The balance a statement says the Account ended at, as the bank reports it. */
export type ClosingBalance = { amount: Cents; date: DayKey };

/**
 * What a closing balance says in the Account's own terms: for checking or savings, the balance;
 * for a card or loan, what's owed, positive. Banks report a card's or loan's balance either way
 * round (OFX usually negative, as money the Household owes; many exports positive), so either
 * sign reads as owing.
 */
export function closingBalanceFor(
	closing: ClosingBalance,
	holdsMoney: boolean,
): { owing: boolean; amount: Cents } {
	return holdsMoney
		? { owing: false, amount: closing.amount }
		: { owing: true, amount: Math.abs(closing.amount) };
}

/** A statement file read into lines, with the rows it couldn't read (1-based, as a Parent counts them). */
export type Statement = {
	lines: StatementLine[];
	closingBalance: ClosingBalance | null;
	unreadable: { row: number; reason: string }[];
	/** The last four digits of the account it's for, when the file says (OFX's ACCTID). */
	accountDigits?: string | null;
};

export type StatementFormat = "csv" | "ofx";

/** OFX and QFX files announce themselves in their header; anything else is read as CSV. */
export function statementFormat(content: string): StatementFormat {
	return /OFXHEADER|<\?OFX|<OFX>/i.test(content.slice(0, 4096)) ? "ofx" : "csv";
}

/**
 * Reads an amount as a bank writes it ("-1,234.56", "$12.00", "(45.10)", "12.30-", "+5") as
 * signed cents. Null for anything else, or beyond MAX_CENTS.
 */
export function parseStatementAmount(input: string): Cents | null {
	let text = input.trim().replace(/\s+/g, "");
	if (text === "") return null;
	let negative = false;
	if (/^\(.*\)$/.test(text)) {
		negative = true;
		text = text.slice(1, -1);
	}
	if (text.endsWith("-")) {
		negative = !negative;
		text = text.slice(0, -1);
	}
	// The sign may come before or after the dollar sign: "-$5", "$-5".
	const signs = /^([-+]?)\$?([-+]?)/.exec(text) as RegExpExecArray;
	if (signs[1] === "-") negative = !negative;
	if (signs[2] === "-") negative = !negative;
	text = text.slice(signs[0].length);
	// A lone comma with one or two digits after it is a decimal comma ("12,5"); otherwise commas
	// group thousands.
	if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(",", ".");
	else if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(text)) text = text.replaceAll(",", "");
	const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
	if (!match || text === "" || text === ".") return null;
	const fraction = match[2] ?? "";
	// Round anything past cents to the nearest cent, from the digits.
	const cents =
		Number(match[1] || "0") * 100 +
		Number(fraction.slice(0, 2).padEnd(2, "0")) +
		(Number(fraction[2] ?? "0") >= 5 ? 1 : 0);
	if (cents > MAX_CENTS) return null;
	return negative && cents !== 0 ? -cents : cents;
}

/** How dates are written: month/day/year, day/month/year, or year-month-day. */
export type DateFormat = "mdy" | "dmy" | "ymd";

export const DATE_FORMATS: Record<DateFormat, string> = {
	mdy: "MM/DD/YYYY",
	dmy: "DD/MM/YYYY",
	ymd: "YYYY-MM-DD",
};

/**
 * Reads a date in `format`, with any of / - . as separators, one- or two-digit days and months,
 * two-digit years (as 20YY), and anything after the date (a time) ignored. Null if it isn't a
 * real day.
 */
export function parseStatementDate(input: string, format: DateFormat): DayKey | null {
	const match = /^\s*(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[\sT].*)?$/.exec(input);
	let year: number;
	let month: number;
	let day: number;
	if (match) {
		const [a, b, c] = [match[1], match[2], match[3]].map(Number) as [number, number, number];
		if (format === "ymd") [year, month, day] = [a, b, c];
		else if (format === "mdy") [month, day, year] = [a, b, c];
		else [day, month, year] = [a, b, c];
		const yearDigits = format === "ymd" ? match[1] : match[3];
		if (yearDigits?.length === 2) year += 2000;
		else if (yearDigits?.length !== 4) return null;
	} else {
		// Compact YYYYMMDD, as OFX and some exports write it.
		const compact = /^\s*(\d{4})(\d{2})(\d{2})/.exec(input);
		if (!compact) return null;
		[year, month, day] = [compact[1], compact[2], compact[3]].map(Number) as [
			number,
			number,
			number,
		];
	}
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day ||
		year < 1900
	) {
		return null;
	}
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as DayKey;
}

/**
 * Splits CSV text into rows of cells: quoted cells may hold commas, quotes ("") and line breaks.
 * Tolerates a byte-order mark, CRLF, and tab- or semicolon-separated files. Blank rows are dropped.
 */
export function parseCsv(content: string): string[][] {
	const text = content.replace(/^﻿/, "");
	const firstLine = text.slice(0, text.search(/\r?\n|$/));
	const delimiter = [",", "\t", ";"].reduce((best, d) =>
		firstLine.split(d).length > firstLine.split(best).length ? d : best,
	);
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (char === '"') quoted = false;
			else cell += char;
		} else if (char === '"' && cell.trim() === "") {
			quoted = true;
			cell = "";
		} else if (char === delimiter) {
			row.push(cell);
			cell = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && text[i + 1] === "\n") i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else cell += char;
	}
	row.push(cell);
	rows.push(row);
	return rows
		.map((cells) => cells.map((c) => c.trim()))
		.filter((cells) => cells.some((c) => c !== ""));
}

/**
 * Which CSV columns (0-based) hold what, and how to read them. Remembered per Account, since a
 * bank's export keeps its shape.
 */
export type CsvMapping = {
	/** Whether the first row names the columns rather than holding a line. */
	hasHeader: boolean;
	dateColumn: number;
	descriptionColumn: number;
	dateFormat: DateFormat;
	amount:
		| {
				kind: "signed";
				column: number;
				/** Whether money out is written as negative (most checking exports) or positive (most cards). */
				moneyOut: "negative" | "positive";
		  }
		| { kind: "debit-credit"; debitColumn: number; creditColumn: number };
};

const HEADER_HINTS = {
	date: /^(posted |posting |transaction |trans\.? )?date|^date/i,
	// Most specific first: "Details" is a type column in some exports.
	description: [/description/i, /payee|merchant/i, /name/i, /memo|details|narrative/i],
	amount: /^amount|amount$/i,
	debit: /debit|withdrawal|money out|paid out/i,
	credit: /credit|deposit|money in|paid in/i,
};

/** The first column whose header matches, trying hints in order, or null. */
const columnMatching = (header: string[], hints: RegExp | RegExp[], not: number[] = []) => {
	for (const hint of [hints].flat()) {
		const index = header.findIndex((name, i) => !not.includes(i) && hint.test(name));
		if (index !== -1) return index;
	}
	return null;
};

/**
 * A first guess at the mapping for a CSV, from its header names and how its dates look; the
 * Parent confirms or corrects it in the preview.
 */
export function guessCsvMapping(rows: string[][]): CsvMapping {
	const first = rows[0] ?? [];
	const hasHeader = first.length > 0 && first.every((cell) => parseStatementAmount(cell) === null);
	const header = hasHeader ? first : [];
	const data = hasHeader ? rows.slice(1) : rows;
	const sample = data[0] ?? [];
	const dateColumn =
		columnMatching(header, HEADER_HINTS.date) ??
		Math.max(
			0,
			sample.findIndex((cell) => /^\s*\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(cell)),
		);
	const debit = columnMatching(header, HEADER_HINTS.debit);
	const credit = columnMatching(header, HEADER_HINTS.credit);
	const amountColumn =
		columnMatching(header, HEADER_HINTS.amount) ??
		Math.max(
			0,
			sample.findIndex((cell, i) => i !== dateColumn && parseStatementAmount(cell) !== null),
		);
	const descriptionColumn =
		columnMatching(header, HEADER_HINTS.description, [dateColumn, amountColumn]) ??
		Math.max(
			0,
			sample.findIndex(
				(cell, i) => i !== dateColumn && cell !== "" && parseStatementAmount(cell) === null,
			),
		);
	return {
		hasHeader,
		dateColumn,
		descriptionColumn,
		dateFormat: guessDateFormat(data.map((row) => row[dateColumn] ?? "")),
		amount:
			debit !== null && credit !== null && columnMatching(header, HEADER_HINTS.amount) === null
				? { kind: "debit-credit", debitColumn: debit, creditColumn: credit }
				: { kind: "signed", column: amountColumn, moneyOut: "negative" },
	};
}

/** The format that reads every sample date, preferring US month/day/year when several do. */
export function guessDateFormat(samples: string[]): DateFormat {
	const dates = samples.filter((s) => s.trim() !== "").slice(0, 50);
	const formats: DateFormat[] = ["mdy", "ymd", "dmy"];
	return (
		formats.find((format) => dates.every((d) => parseStatementDate(d, format) !== null)) ?? "mdy"
	);
}

/** A debit/credit cell: blank is nothing, and either column may carry its own sign. */
const unsigned = (cell: string | undefined): Cents | null =>
	cell === undefined || cell.trim() === "" ? 0 : parseStatementAmount(cell);

/** Reads a CSV's rows as statement lines using `mapping`. CSV exports carry no closing balance. */
export function readCsvStatement(rows: string[][], mapping: CsvMapping): Statement {
	const lines: StatementLine[] = [];
	const unreadable: Statement["unreadable"] = [];
	const offset = mapping.hasHeader ? 1 : 0;
	rows.slice(offset).forEach((row, i) => {
		const rowNumber = i + offset + 1;
		const date = parseStatementDate(row[mapping.dateColumn] ?? "", mapping.dateFormat);
		if (!date) {
			unreadable.push({ row: rowNumber, reason: "No date" });
			return;
		}
		let amount: Cents | null;
		if (mapping.amount.kind === "signed") {
			const value = parseStatementAmount(row[mapping.amount.column] ?? "");
			amount = value === null ? null : mapping.amount.moneyOut === "negative" ? value : -value;
		} else {
			const debit = unsigned(row[mapping.amount.debitColumn]);
			const credit = unsigned(row[mapping.amount.creditColumn]);
			amount = debit === null || credit === null ? null : Math.abs(credit) - Math.abs(debit);
		}
		if (amount === null) {
			unreadable.push({ row: rowNumber, reason: "No amount" });
			return;
		}
		// A zero line moves no money (a memo or a pending hold released).
		if (amount === 0) return;
		lines.push({
			date,
			amount,
			description: cleanDescription(row[mapping.descriptionColumn] ?? ""),
			bankId: null,
		});
	});
	return { lines, closingBalance: null, unreadable };
}

export const cleanDescription = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 200);

/**
 * The ID each line is kept under in its Account, so bringing in the same or an overlapping
 * statement again adds nothing twice. The bank's own ID when it has one; otherwise a fingerprint
 * of the day, amount and description, with an ordinal telling apart identical lines on the same
 * day (two $4.50 coffees), counted in file order.
 */
export function statementLineIds(lines: StatementLine[]): string[] {
	const seen = new Map<string, number>();
	return lines.map((line) => {
		const key = line.bankId
			? `id:${line.bankId}`
			: `fp:${line.date}|${line.amount}|${normalizeDescription(line.description)}`;
		const ordinal = (seen.get(key) ?? 0) + 1;
		seen.set(key, ordinal);
		// A bank ID is unique on its own; a repeat in one file is still a line of its own.
		return line.bankId ? (ordinal === 1 ? key : `${key}#${ordinal}`) : `${key}|${ordinal}`;
	});
}

/** Case, spacing and punctuation vary between exports of the same line; letters and digits don't. */
export const normalizeDescription = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
