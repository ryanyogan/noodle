import { describe, expect, it } from "vitest";
import { parseByteRange, rangedResponse } from "./byte-range";

const full = { kind: "full" };
const unsatisfiable = { kind: "unsatisfiable" };
const partial = (start: number, end: number) => ({ kind: "partial", start, end });

describe("parseByteRange", () => {
	it("gives the whole file when there is no header", () => {
		expect(parseByteRange(null, 1000)).toEqual(full);
		expect(parseByteRange(undefined, 1000)).toEqual(full);
		expect(parseByteRange("", 1000)).toEqual(full);
	});

	it("reads a closed range, both ends included", () => {
		expect(parseByteRange("bytes=0-99", 1000)).toEqual(partial(0, 99));
		expect(parseByteRange("bytes=0-0", 1000)).toEqual(partial(0, 0));
		expect(parseByteRange("bytes=0-1", 1000)).toEqual(partial(0, 1));
		expect(parseByteRange("bytes=500-999", 1000)).toEqual(partial(500, 999));
		expect(parseByteRange("bytes=999-999", 1000)).toEqual(partial(999, 999));
	});

	it("stops a range at the end of the file", () => {
		expect(parseByteRange("bytes=900-5000", 1000)).toEqual(partial(900, 999));
		expect(parseByteRange("bytes=0-999999999999999999999999", 1000)).toEqual(partial(0, 999));
	});

	it("reads an open-ended range to the end of the file", () => {
		expect(parseByteRange("bytes=0-", 1000)).toEqual(partial(0, 999));
		expect(parseByteRange("bytes=250-", 1000)).toEqual(partial(250, 999));
		expect(parseByteRange("bytes=999-", 1000)).toEqual(partial(999, 999));
	});

	it("reads a suffix range as the last bytes", () => {
		expect(parseByteRange("bytes=-100", 1000)).toEqual(partial(900, 999));
		expect(parseByteRange("bytes=-1", 1000)).toEqual(partial(999, 999));
		expect(parseByteRange("bytes=-1000", 1000)).toEqual(partial(0, 999));
		// Longer than the file: all of it.
		expect(parseByteRange("bytes=-5000", 1000)).toEqual(partial(0, 999));
	});

	it("allows spaces and any case in the unit", () => {
		expect(parseByteRange(" bytes = 10 - 19 ", 1000)).toEqual(partial(10, 19));
		expect(parseByteRange("Bytes=10-19", 1000)).toEqual(partial(10, 19));
	});

	it("says a range outside the file can't be met", () => {
		expect(parseByteRange("bytes=1000-", 1000)).toEqual(unsatisfiable);
		expect(parseByteRange("bytes=1000-1001", 1000)).toEqual(unsatisfiable);
		expect(parseByteRange("bytes=999999999999999999999999-", 1000)).toEqual(unsatisfiable);
		expect(parseByteRange("bytes=-0", 1000)).toEqual(unsatisfiable);
		expect(parseByteRange("bytes=0-", 0)).toEqual(unsatisfiable);
		expect(parseByteRange("bytes=-10", 0)).toEqual(unsatisfiable);
	});

	it("ignores several ranges at once", () => {
		expect(parseByteRange("bytes=0-99,200-299", 1000)).toEqual(full);
		expect(parseByteRange("bytes=0-99, -100", 1000)).toEqual(full);
	});

	it("ignores a malformed header", () => {
		for (const header of [
			"bytes",
			"bytes=",
			"bytes=-",
			"bytes=abc",
			"bytes=1.5-2",
			"bytes=-1-2",
			"bytes=0x10-20",
			"bytes 0-99",
			"0-99",
			"items=0-99",
			"bytes=99-0",
			"bytes=5-2",
			"bytes=0-99;",
		]) {
			expect(parseByteRange(header, 1000), header).toEqual(full);
		}
	});
});

describe("rangedResponse", () => {
	const bytes = Uint8Array.from({ length: 1000 }, (_, index) => index % 251).buffer;
	const fileHeaders = new Headers({
		"Content-Type": "video/mp4",
		ETag: '"abc"',
		"Cache-Control": "public, max-age=31536000, immutable",
		// Whatever the file's own answer said about length doesn't survive a cut.
		"Content-Length": "123456",
	});
	const ask = (headers: Record<string, string> = {}, method = "GET") =>
		rangedResponse({ method, headers: new Headers(headers) }, bytes, fileHeaders);
	const body = async (response: Response) => [...new Uint8Array(await response.arrayBuffer())];
	const slice = (start: number, end: number) => [...new Uint8Array(bytes.slice(start, end + 1))];

	it("answers a plain GET with the whole file and says ranges are welcome", async () => {
		const response = ask();
		expect(response.status).toBe(200);
		expect(response.headers.get("Accept-Ranges")).toBe("bytes");
		expect(response.headers.get("Content-Length")).toBe("1000");
		expect(response.headers.get("Content-Range")).toBeNull();
		expect(response.headers.get("Content-Type")).toBe("video/mp4");
		expect(response.headers.get("ETag")).toBe('"abc"');
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
		expect(await body(response)).toEqual(slice(0, 999));
	});

	it("answers bytes=a-b with 206 and exactly those bytes", async () => {
		const response = ask({ Range: "bytes=0-99" });
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe("bytes 0-99/1000");
		expect(response.headers.get("Content-Length")).toBe("100");
		expect(response.headers.get("Accept-Ranges")).toBe("bytes");
		expect(response.headers.get("Content-Type")).toBe("video/mp4");
		expect(response.headers.get("ETag")).toBe('"abc"');
		expect(await body(response)).toEqual(slice(0, 99));
	});

	it("answers Safari's first probe, bytes=0-1, with two bytes", async () => {
		const response = ask({ Range: "bytes=0-1" });
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe("bytes 0-1/1000");
		expect(response.headers.get("Content-Length")).toBe("2");
		expect(await body(response)).toEqual(slice(0, 1));
	});

	it("answers bytes=a- to the end of the file", async () => {
		const response = ask({ Range: "bytes=990-" });
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe("bytes 990-999/1000");
		expect(response.headers.get("Content-Length")).toBe("10");
		expect(await body(response)).toEqual(slice(990, 999));
	});

	it("answers bytes=-n with the last n bytes", async () => {
		const response = ask({ Range: "bytes=-25" });
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe("bytes 975-999/1000");
		expect(response.headers.get("Content-Length")).toBe("25");
		expect(await body(response)).toEqual(slice(975, 999));
	});

	it("answers a range past the end with what there is", async () => {
		const response = ask({ Range: "bytes=900-4000" });
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe("bytes 900-999/1000");
		expect(response.headers.get("Content-Length")).toBe("100");
		expect(await body(response)).toEqual(slice(900, 999));
	});

	it("answers a range outside the file with 416 and the file's size", async () => {
		const response = ask({ Range: "bytes=1000-" });
		expect(response.status).toBe(416);
		expect(response.headers.get("Content-Range")).toBe("bytes */1000");
		expect(response.headers.get("Accept-Ranges")).toBe("bytes");
		// The mistake isn't kept for a year like the file is.
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(await body(response)).toEqual([]);
	});

	it("answers several ranges, or a malformed header, with the whole file", async () => {
		for (const range of ["bytes=0-9,20-29", "bytes=abc", "bytes=9-2", "items=0-9"]) {
			const response = ask({ Range: range });
			expect(response.status, range).toBe(200);
			expect(response.headers.get("Content-Length")).toBe("1000");
			expect(response.headers.get("Content-Range")).toBeNull();
			expect(await body(response)).toEqual(slice(0, 999));
		}
	});

	it("answers HEAD with the whole file's headers and no body", async () => {
		const response = ask({}, "HEAD");
		expect(response.status).toBe(200);
		expect(response.headers.get("Accept-Ranges")).toBe("bytes");
		expect(response.headers.get("Content-Length")).toBe("1000");
		expect(response.headers.get("Content-Type")).toBe("video/mp4");
		expect(response.body).toBeNull();
	});

	it("ignores Range on HEAD, even one outside the file", () => {
		for (const range of ["bytes=0-99", "bytes=5000-"]) {
			const response = ask({ Range: range }, "HEAD");
			expect(response.status, range).toBe(200);
			expect(response.headers.get("Content-Length")).toBe("1000");
			expect(response.headers.get("Content-Range")).toBeNull();
			expect(response.body).toBeNull();
		}
	});

	it("keeps the range when If-Range is this file's ETag", () => {
		const response = ask({ Range: "bytes=0-99", "If-Range": '"abc"' });
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe("bytes 0-99/1000");
	});

	it("sends the whole file when If-Range is another file's ETag or a date", async () => {
		for (const ifRange of ['"old"', 'W/"abc"', "Sat, 03 Oct 2026 10:00:00 GMT"]) {
			const response = ask({ Range: "bytes=0-99", "If-Range": ifRange });
			expect(response.status, ifRange).toBe(200);
			expect(response.headers.get("Content-Length")).toBe("1000");
			expect(await body(response)).toEqual(slice(0, 999));
		}
	});

	it("sends the whole file for If-Range when the file has only a weak ETag or none", () => {
		for (const etag of ['W/"abc"', null]) {
			const headers = new Headers({ "Content-Type": "video/mp4" });
			if (etag) headers.set("ETag", etag);
			const response = rangedResponse(
				{
					method: "GET",
					headers: new Headers({ Range: "bytes=0-99", "If-Range": etag ?? '"abc"' }),
				},
				bytes,
				headers,
			);
			expect(response.status).toBe(200);
		}
	});
});
