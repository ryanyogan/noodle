// Answering a request for part of a file (an HTTP byte range, RFC 9110 §14). Safari on iPhone and
// Mac only plays a <video> whose server answers ranges with 206, and Workers static assets answer
// every request with the whole file, so the Worker cuts the intro video's files itself
// (server/intro-video.ts). This module imports nothing, so it is tested on its own.

export type ByteRange =
	/** No usable Range header: the whole file. */
	| { kind: "full" }
	/** Bytes `start` to `end`, both included. */
	| { kind: "partial"; start: number; end: number }
	/** A well-formed range with nothing of the file in it. */
	| { kind: "unsatisfiable" };

const FULL: ByteRange = { kind: "full" };
const UNSATISFIABLE: ByteRange = { kind: "unsatisfiable" };

/**
 * Reads a Range header against a file of `size` bytes: `bytes=a-b`, `bytes=a-` and `bytes=-n`.
 * A header that is missing, malformed, in another unit, backwards (`5-2`) or asks for several
 * ranges at once is ignored, as the RFC allows: the answer is then the whole file.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange {
	if (header == null) return FULL;
	const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
	if (!match) return FULL;
	const first = match[1] ?? "";
	const last = match[2] ?? "";
	if (first === "" && last === "") return FULL;
	if (first === "") {
		// The last `n` bytes.
		const length = Number(last);
		if (length === 0 || size === 0) return UNSATISFIABLE;
		return { kind: "partial", start: Math.max(0, size - length), end: size - 1 };
	}
	const start = Number(first);
	if (last !== "" && Number(last) < start) return FULL;
	if (start >= size) return UNSATISFIABLE;
	const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
	return { kind: "partial", start, end };
}

/**
 * Whether an If-Range header lets the range stand: it must be the file's own strong ETag. A date,
 * a weak ETag or another file's ETag means "send me the whole file instead".
 */
function ifRangeAllows(ifRange: string | null, etag: string | null): boolean {
	if (ifRange === null) return true;
	return etag !== null && !etag.startsWith("W/") && ifRange.trim() === etag;
}

/**
 * The answer to a GET or HEAD for a file whose bytes are all in hand: 206 with Content-Range for
 * a range, 416 for one outside the file, else 200 with everything. `fileHeaders` are the file's
 * own (Content-Type, ETag, Cache-Control); the length and range headers are set here. Range only
 * means something on GET, so HEAD always describes the whole file.
 */
export function rangedResponse(
	request: { method: string; headers: Headers },
	bytes: ArrayBuffer,
	fileHeaders: Headers,
): Response {
	const size = bytes.byteLength;
	const head = request.method === "HEAD";
	const headers = new Headers(fileHeaders);
	headers.set("Accept-Ranges", "bytes");
	headers.delete("Content-Range");

	const range =
		!head && ifRangeAllows(request.headers.get("If-Range"), headers.get("ETag"))
			? parseByteRange(request.headers.get("Range"), size)
			: FULL;

	if (range.kind === "unsatisfiable") {
		return new Response(null, {
			status: 416,
			headers: {
				"Accept-Ranges": "bytes",
				"Content-Range": `bytes */${size}`,
				"Cache-Control": "no-store",
			},
		});
	}
	if (range.kind === "full") {
		headers.set("Content-Length", String(size));
		return new Response(head ? null : bytes, { status: 200, headers });
	}
	headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
	headers.set("Content-Length", String(range.end - range.start + 1));
	return new Response(bytes.slice(range.start, range.end + 1), { status: 206, headers });
}
