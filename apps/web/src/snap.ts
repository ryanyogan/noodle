import type { Cents } from "@noodle/domain";
import { useCallback, useEffect, useRef, useState } from "react";

export type { CaptureDraft, SnapResult } from "./server/snap-run";

// Snap and speak in Quick Add, in the browser: a phone photo made small enough to send, and the
// browser's own speech recognition where it has one (Safari, Chrome), with typing always there.

/** The longest side a Receipt photo is sent at: plenty for the model to read it. */
const PHOTO_SIDE = 1600;

/** Photos at or under this are sent as taken. */
const SEND_AS_TAKEN_BYTES = 1_500_000;

/**
 * A photo ready to send: as taken when it's small and a type the model reads, else scaled down to
 * PHOTO_SIDE as a JPEG (which also turns an iPhone's HEIC into something the model reads).
 */
export async function photoToSend(file: File): Promise<Blob> {
	const readable = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
	if (readable && file.size <= SEND_AS_TAKEN_BYTES) return file;
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error("Couldn’t read that photo"))),
			"image/jpeg",
			0.85,
		),
	);
}

/** An amount in cents as Quick Add's keypad would have typed it; null past five whole digits. */
export function typedAmount(cents: Cents): string | null {
	const whole = Math.floor(cents / 100);
	const fraction = cents % 100;
	if (cents <= 0 || String(whole).length > 5) return null;
	return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

/** The part of the Web Speech API Quick Add uses. */
type Recognition = {
	lang: string;
	interimResults: boolean;
	continuous: boolean;
	onresult:
		| ((event: {
				results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
		  }) => void)
		| null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
};

type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | null {
	if (typeof window === "undefined") return null;
	const speech = window as unknown as {
		SpeechRecognition?: RecognitionClass;
		webkitSpeechRecognition?: RecognitionClass;
	};
	return speech.SpeechRecognition ?? speech.webkitSpeechRecognition ?? null;
}

/**
 * The browser's speech recognition, for one phrase at a time: what's heard so far while
 * listening, and `onPhrase` with the whole of it when the Parent stops talking. Not `available`
 * where the browser has none; `failed` when it couldn't listen (no microphone permission).
 */
export function useSpeech(onPhrase: (phrase: string) => void) {
	const [available, setAvailable] = useState(false);
	const [listening, setListening] = useState(false);
	const [heard, setHeard] = useState("");
	const [failed, setFailed] = useState(false);
	const recognition = useRef<Recognition | null>(null);
	const latest = useRef(onPhrase);
	latest.current = onPhrase;

	// Known only in the browser, after hydration.
	useEffect(() => setAvailable(recognitionClass() !== null), []);
	useEffect(() => () => recognition.current?.abort(), []);

	const listen = useCallback(() => {
		const Speech = recognitionClass();
		if (!Speech || recognition.current) return;
		const listener = new Speech();
		listener.lang = "en-US";
		listener.interimResults = true;
		listener.continuous = false;
		let final = "";
		listener.onresult = (event) => {
			const said = Array.from(event.results, (result) => result[0]?.transcript ?? "").join("");
			setHeard(said);
			const last = event.results[event.results.length - 1];
			if (last?.isFinal) final = said;
		};
		listener.onerror = (event) => {
			// Silence isn't a failure: the Parent can try again or type.
			if (event.error !== "no-speech" && event.error !== "aborted") setFailed(true);
		};
		listener.onend = () => {
			recognition.current = null;
			setListening(false);
			if (final.trim()) latest.current(final.trim());
		};
		recognition.current = listener;
		setHeard("");
		setFailed(false);
		setListening(true);
		try {
			listener.start();
		} catch {
			recognition.current = null;
			setListening(false);
			setFailed(true);
		}
	}, []);

	const stop = useCallback(() => recognition.current?.stop(), []);

	return { available, listening, heard, failed, listen, stop };
}
