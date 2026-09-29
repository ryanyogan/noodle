import { Button } from "@noodle/ui/components/button";
import { Input } from "@noodle/ui/components/input";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Camera, Mic, Square } from "lucide-react";
import { useRef, useState } from "react";
import { ulid } from "ulid";
import { readSpokenPhrase, snapReceiptPhoto } from "../server/snap";
import { type CaptureDraft, photoToSend, type SnapResult, useSpeech } from "../snap";

/**
 * Snap and speak in Quick Add: a photo of a paper Receipt, or a phrase said or typed ("forty on
 * pizza after hockey"), read into the amount, Bucket, For and note for the Parent to check.
 * Nothing is saved here: the Parent still taps the Bucket.
 */
export function SnapAndSpeak({
	onPhrase,
	onSnap,
}: {
	onPhrase: (draft: CaptureDraft) => void;
	onSnap: (result: SnapResult) => void;
}) {
	const hydrated = useHydrated();
	const photoInput = useRef<HTMLInputElement>(null);
	const phraseInput = useRef<HTMLInputElement>(null);
	const [saying, setSaying] = useState(false);
	const [phrase, setPhrase] = useState("");

	const snap = useMutation({
		mutationFn: async (file: File) => {
			const form = new FormData();
			form.set("receiptId", ulid());
			form.set("photo", await photoToSend(file), file.name || "receipt.jpg");
			return snapReceiptPhoto({ data: form });
		},
		onSuccess: onSnap,
	});

	const read = useMutation({
		mutationFn: (said: string) => readSpokenPhrase({ data: { phrase: said } }),
		onSuccess: (draft) => {
			setSaying(false);
			setPhrase("");
			onPhrase(draft);
		},
	});

	const speech = useSpeech((said) => {
		setPhrase(said);
		read.mutate(said);
	});

	function say() {
		snap.reset();
		read.reset();
		setSaying(true);
		if (speech.available) speech.listen();
		else requestAnimationFrame(() => phraseInput.current?.focus());
	}

	const busy = snap.isPending || read.isPending;
	const status = snap.isPending
		? "Reading the receipt…"
		: read.isPending
			? "Reading what you said…"
			: snap.isError
				? "Couldn’t read that photo. Type the amount instead."
				: read.isError
					? "Couldn’t read that. Try again, or type the amount."
					: speech.listening
						? "Listening…"
						: speech.failed
							? "Couldn’t listen. Type it instead."
							: null;

	return (
		<div className="grid gap-2">
			<div className="flex justify-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={!hydrated || busy}
					onClick={() => {
						read.reset();
						setSaying(false);
						photoInput.current?.click();
					}}
				>
					<Camera strokeWidth={1.75} />
					Snap receipt
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					aria-pressed={saying}
					disabled={!hydrated || busy}
					onClick={() => (saying ? setSaying(false) : say())}
				>
					<Mic strokeWidth={1.75} />
					Say it
				</Button>
			</div>
			<input
				ref={photoInput}
				type="file"
				accept="image/*"
				capture="environment"
				aria-label="Receipt photo"
				className="sr-only"
				tabIndex={-1}
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = "";
					if (file) snap.mutate(file);
				}}
			/>
			{saying ? (
				<form
					className="flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						const said = phrase.trim();
						if (said && !read.isPending) read.mutate(said);
					}}
				>
					<Input
						ref={phraseInput}
						aria-label="What you spent"
						placeholder="forty on pizza after hockey"
						maxLength={200}
						autoComplete="off"
						enterKeyHint="go"
						value={speech.listening ? speech.heard : phrase}
						readOnly={speech.listening}
						onChange={(event) => setPhrase(event.currentTarget.value)}
					/>
					{speech.available ? (
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="h-9 w-9 shrink-0 rounded-xl"
							aria-label={speech.listening ? "Stop listening" : "Listen"}
							disabled={read.isPending}
							onClick={() => (speech.listening ? speech.stop() : speech.listen())}
						>
							{speech.listening ? <Square strokeWidth={1.75} /> : <Mic strokeWidth={1.75} />}
						</Button>
					) : null}
					<Button
						type="submit"
						variant="secondary"
						className="shrink-0"
						disabled={speech.listening || read.isPending || phrase.trim() === ""}
					>
						Fill in
					</Button>
				</form>
			) : null}
			<p
				role="status"
				className={cn(
					"text-center text-[13px] text-subtle-foreground",
					!status && "sr-only",
					(snap.isError || read.isError || speech.failed) && "text-muted-foreground",
				)}
			>
				{status}
			</p>
		</div>
	);
}
