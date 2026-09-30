/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type CsvMapping,
	closingBalanceFor,
	guessCsvMapping,
	parseCsv,
	parseStatementAmount,
	parseStatementDate,
	readCsvStatement,
	readOfxStatement,
	readStatement,
	type StatementLine,
	statementFormat,
	statementLineIds,
} from "./index";

const fixture = (name: string) =>
	readFileSync(join(import.meta.dirname, "..", "fixtures", "statements", name), "utf8");

describe("parseStatementAmount", () => {
	it.each([
		["-84.12", -8412],
		["3200.00", 320000],
		["$1,234.56", 123456],
		["-$1,234.56", -123456],
		["$-5", -500],
		["(45.10)", -4510],
		["12.30-", -1230],
		["+5", 500],
		["12,5", 1250],
		["0.005", 1],
		["1 000.00", 100000],
		["-0.00", 0],
	])("reads %s as %i cents", (input, cents) => {
		expect(parseStatementAmount(input)).toBe(cents);
	});

	it.each(["", "abc", "1.2.3", "$", "12,34,5", "99999999999"])("refuses %j", (input) => {
		expect(parseStatementAmount(input)).toBeNull();
	});
});

describe("parseStatementDate", () => {
	it("reads each format, tolerant of separators, short years and times", () => {
		expect(parseStatementDate("09/02/2026", "mdy")).toBe("2026-09-02");
		expect(parseStatementDate("9/2/26", "mdy")).toBe("2026-09-02");
		expect(parseStatementDate("02.09.2026", "dmy")).toBe("2026-09-02");
		expect(parseStatementDate("2026-09-02", "ymd")).toBe("2026-09-02");
		expect(parseStatementDate("2026-09-02T10:15:00Z", "ymd")).toBe("2026-09-02");
		expect(parseStatementDate("09/02/2026 14:03", "mdy")).toBe("2026-09-02");
		expect(parseStatementDate("20260902", "mdy")).toBe("2026-09-02");
	});

	it("refuses days that don't exist and text that isn't a date", () => {
		expect(parseStatementDate("02/30/2026", "mdy")).toBeNull();
		expect(parseStatementDate("13/01/2026", "mdy")).toBeNull();
		expect(parseStatementDate("not a date", "mdy")).toBeNull();
		expect(parseStatementDate("9/2/026", "mdy")).toBeNull();
	});
});

describe("parseCsv", () => {
	it("handles quotes, escaped quotes, commas and line breaks inside cells, CRLF and a BOM", () => {
		expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\r\n\r\n')).toEqual([
			["a", "b"],
			["x, y", 'say "hi"'],
			["two\nlines", "z"],
		]);
	});

	it("detects tab- and semicolon-separated files", () => {
		expect(parseCsv("a\tb\n1\t2")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
		expect(parseCsv("a;b\n1,5;2")).toEqual([
			["a", "b"],
			["1,5", "2"],
		]);
	});
});

describe("CSV mapping", () => {
	it("guesses a checking export's columns from its header", () => {
		const rows = parseCsv(fixture("checking.csv"));
		expect(guessCsvMapping(rows)).toEqual({
			hasHeader: true,
			dateColumn: 1,
			descriptionColumn: 2,
			dateFormat: "mdy",
			amount: { kind: "signed", column: 3, moneyOut: "negative" },
		} satisfies CsvMapping);
	});

	it("reads a signed-amount export: money out negative, money in positive", () => {
		const rows = parseCsv(fixture("checking.csv"));
		const statement = readCsvStatement(rows, guessCsvMapping(rows));
		expect(statement.unreadable).toEqual([]);
		expect(statement.closingBalance).toBeNull();
		expect(statement.lines).toHaveLength(6);
		expect(statement.lines[0]).toEqual({
			date: "2026-09-02",
			amount: -8412,
			description: "TRADER JOE'S #552 PORTLAND OR",
			bankId: null,
		});
		expect(statement.lines[3]).toMatchObject({ amount: 320000, description: "ACME CORP PAYROLL" });
	});

	it("reads a card export where charges are positive", () => {
		const rows = parseCsv("Date,Amount,Merchant\n2026-09-01,15.49,NETFLIX\n2026-09-02,-20,REFUND");
		const mapping: CsvMapping = {
			...guessCsvMapping(rows),
			amount: { kind: "signed", column: 1, moneyOut: "positive" },
		};
		expect(mapping).toMatchObject({ dateFormat: "ymd", descriptionColumn: 2 });
		expect(readCsvStatement(rows, mapping).lines.map((l) => l.amount)).toEqual([-1549, 2000]);
	});

	it("reads debit and credit columns, and reports rows it can't read", () => {
		const rows = parseCsv(fixture("card-debit-credit.csv"));
		const mapping = guessCsvMapping(rows);
		expect(mapping).toEqual({
			hasHeader: true,
			dateColumn: 0,
			descriptionColumn: 1,
			dateFormat: "mdy",
			amount: { kind: "debit-credit", debitColumn: 2, creditColumn: 3 },
		} satisfies CsvMapping);
		const statement = readCsvStatement(rows, mapping);
		expect(statement.lines.map((l) => [l.date, l.amount, l.description])).toEqual([
			["2026-09-01", -1549, "NETFLIX.COM"],
			["2026-09-04", -6210, 'COSTCO WHSE #0001, "GAS"'],
			["2026-09-09", 50000, "AUTOPAY PAYMENT - THANK YOU"],
			["2026-09-12", 2499, "REI #11 RETURN"],
		]);
		expect(statement.unreadable).toEqual([{ row: 6, reason: "No date" }]);
	});

	it("guesses a headerless export's columns from its values", () => {
		const rows = parseCsv(fixture("no-header.csv"));
		const mapping = guessCsvMapping(rows);
		expect(mapping).toEqual({
			hasHeader: false,
			dateColumn: 0,
			descriptionColumn: 2,
			dateFormat: "mdy",
			amount: { kind: "signed", column: 1, moneyOut: "negative" },
		} satisfies CsvMapping);
		// The Parent corrects the description column in the preview.
		const statement = readCsvStatement(rows, { ...mapping, descriptionColumn: 4 });
		expect(statement.lines.map((l) => l.description)).toEqual([
			"COSTCO WHSE #0001",
			"MOBILE DEPOSIT",
			"SPOTIFY USA",
		]);
	});

	it("prefers day/month/year only when a date can't be month/day/year", () => {
		const rows = parseCsv("Date,Description,Amount\n25/08/2026,A,-1\n01/09/2026,B,-2");
		const mapping = guessCsvMapping(rows);
		expect(mapping.dateFormat).toBe("dmy");
		expect(readCsvStatement(rows, mapping).lines.map((l) => l.date)).toEqual([
			"2026-08-25",
			"2026-09-01",
		]);
	});
});

describe("OFX", () => {
	it("reads an OFX 1.x (SGML) bank statement and its closing balance", () => {
		const statement = readOfxStatement(fixture("checking-v1.ofx"));
		expect(statement.lines).toEqual([
			{ date: "2026-09-16", amount: -2375, description: "SAFEWAY #1234", bankId: "2026091601" },
			{ date: "2026-09-17", amount: 15000, description: "VENMO CASHOUT", bankId: "2026091702" },
			{
				date: "2026-09-18",
				amount: -999,
				description: "APPLE.COM/BILL & ICLOUD",
				bankId: "2026091803",
			},
		]);
		expect(statement.closingBalance).toEqual({ amount: 254026, date: "2026-09-20" });
		expect(statement.unreadable).toEqual([]);
	});

	it("reads an OFX 2.x (XML) card statement, reporting a transaction with no date", () => {
		const statement = readOfxStatement(fixture("card-v2.qfx"));
		expect(statement.lines.map((l) => [l.date, l.amount, l.description, l.bankId])).toEqual([
			["2026-09-02", -3840, "BARNES & NOBLE #2231", "320262450123"],
			["2026-09-10", 50000, "PAYMENT THANK YOU", "320262530456"],
			["2026-09-11", -3840, "BARNES & NOBLE #2231", "320262540789"],
		]);
		expect(statement.closingBalance).toEqual({ amount: -81233, date: "2026-09-21" });
		expect(statement.unreadable).toEqual([{ row: 4, reason: "No date" }]);
	});

	it("tells OFX and QFX from CSV", () => {
		expect(statementFormat(fixture("checking-v1.ofx"))).toBe("ofx");
		expect(statementFormat(fixture("card-v2.qfx"))).toBe("ofx");
		expect(statementFormat(fixture("checking.csv"))).toBe("csv");
		expect(readStatement(fixture("card-v2.qfx"), null).statement.lines).toHaveLength(3);
		expect(readStatement(fixture("checking.csv"), null).statement.lines).toEqual([]);
	});
});

describe("statementLineIds", () => {
	const line = (over: Partial<StatementLine>): StatementLine => ({
		date: "2026-09-03",
		amount: -450,
		description: "STUMPTOWN COFFEE",
		bankId: null,
		...over,
	});

	it("uses the bank's ID when there is one", () => {
		expect(statementLineIds([line({ bankId: "A1" }), line({ bankId: "A2" })])).toEqual([
			"id:A1",
			"id:A2",
		]);
	});

	it("tells apart identical lines on the same day by their order", () => {
		expect(statementLineIds([line({}), line({}), line({ date: "2026-09-04" })])).toEqual([
			"fp:2026-09-03|-450|stumptown coffee|1",
			"fp:2026-09-03|-450|stumptown coffee|2",
			"fp:2026-09-04|-450|stumptown coffee|1",
		]);
	});

	it("gives the same IDs to the same lines in an overlapping statement", () => {
		const earlier = [line({ date: "2026-09-02" }), line({}), line({})];
		const later = [line({}), line({}), line({ date: "2026-09-05" })];
		const [, ...overlap] = statementLineIds(earlier);
		expect(statementLineIds(later).slice(0, 2)).toEqual(overlap);
	});

	it("ignores case, spacing and punctuation in descriptions", () => {
		expect(statementLineIds([line({ description: "Stumptown  Coffee." })])).toEqual(
			statementLineIds([line({})]),
		);
	});

	it("keeps a repeated bank ID in one file as a line of its own", () => {
		expect(statementLineIds([line({ bankId: "X" }), line({ bankId: "X" })])).toEqual([
			"id:X",
			"id:X#2",
		]);
	});
});

describe("closingBalanceFor: a statement's closing balance in the Account's terms", () => {
	const closing = (amount: number) => ({ amount, date: "2026-09-20" as const });

	it("reads a card's balance as owed, whichever sign the bank used", () => {
		// OFX: what's owed as a negative balance. A CSV-style export: positive.
		expect(closingBalanceFor(closing(-61_240), false)).toEqual({ owing: true, amount: 61_240 });
		expect(closingBalanceFor(closing(61_240), false)).toEqual({ owing: true, amount: 61_240 });
	});

	it("keeps a checking or savings balance as it is, overdrawn included", () => {
		expect(closingBalanceFor(closing(310_000), true)).toEqual({ owing: false, amount: 310_000 });
		expect(closingBalanceFor(closing(-2_500), true)).toEqual({ owing: false, amount: -2_500 });
	});
});
