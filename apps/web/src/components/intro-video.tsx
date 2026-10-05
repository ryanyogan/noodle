import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@noodle/ui/components/dialog";
import { cn } from "@noodle/ui/lib/utils";
import { Play } from "lucide-react";
import { type Ref, useRef, useState, useSyncExternalStore } from "react";
import { INTRO_FILES, INTRO_PHONE_QUERY, INTRO_VIDEO_READY, introCut } from "../intro-video-files";

// The one-minute intro video's player (#54): a button that opens the shared Dialog with the
// browser's own player in it. Nothing of the video is fetched until the Dialog opens (the player
// is only drawn then, with preload="none"), so the pages that offer it load as fast as before.
// It never starts by itself: the Parent sees the poster and presses play, which is also what
// "reduce motion" asks for. This version has no sound; the words are on screen and in the captions.

export const INTRO_BUTTON_LABEL = "Watch the 1-minute intro";

/** Whether this is a phone held upright. The server, and the first paint, assume it isn't. */
function useUprightPhone() {
	return useSyncExternalStore(
		(onChange) => {
			const query = window.matchMedia(INTRO_PHONE_QUERY);
			query.addEventListener("change", onChange);
			return () => query.removeEventListener("change", onChange);
		},
		() => window.matchMedia(INTRO_PHONE_QUERY).matches,
		() => false,
	);
}

/**
 * The video itself, in a frame of the cut's shape that always fits the screen's height: the tall
 * cut on an upright phone, the wide one everywhere else.
 */
export function IntroVideoPlayer({ phone, ref }: { phone: boolean; ref?: Ref<HTMLVideoElement> }) {
	const cut = introCut(phone);
	return (
		<div
			data-slot="intro-video-frame"
			data-cut={phone ? "vertical" : "wide"}
			className={cn(
				"mx-auto overflow-hidden rounded-xl border bg-muted",
				// 11rem is the Dialog's margins, padding and heading, so the frame never needs scrolling.
				phone
					? "aspect-[9/16] w-[min(100%,calc((100dvh-11rem)*9/16))]"
					: "aspect-video w-[min(100%,calc((100dvh-11rem)*16/9))]",
			)}
		>
			{/* key: a turned phone gets the other cut as a new player, not a swapped file mid-play. */}
			<video
				key={cut.src}
				ref={ref}
				className="block size-full"
				src={cut.src}
				poster={cut.poster}
				width={cut.width}
				height={cut.height}
				preload="none"
				controls
				playsInline
				aria-label="Noodle’s 1-minute intro"
			>
				{/* Not on by default: the film has its words drawn in, so captions on top would say
				    everything twice. They stay in the player's menu for anyone who wants them. */}
				<track kind="captions" src={INTRO_FILES.captions} srcLang="en" label="English" />
			</video>
		</div>
	);
}

/** The button and the Dialog it opens. Closing the Dialog stops the video and winds it back. */
export function IntroVideoDialog({ className }: { className?: string }) {
	const [open, setOpen] = useState(false);
	const phone = useUprightPhone();
	const video = useRef<HTMLVideoElement>(null);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && video.current) {
					video.current.pause();
					video.current.currentTime = 0;
				}
				setOpen(next);
			}}
		>
			<DialogTrigger asChild>
				<Button type="button" variant="outline" className={className}>
					<Play aria-hidden="true" />
					{INTRO_BUTTON_LABEL}
				</Button>
			</DialogTrigger>
			<DialogContent data-slot="intro-video-dialog" className={phone ? undefined : "max-w-240"}>
				<DialogHeader>
					<DialogTitle>Noodle in one minute</DialogTitle>
					<DialogDescription>There’s no sound. The words are on screen.</DialogDescription>
				</DialogHeader>
				<IntroVideoPlayer phone={phone} ref={video} />
			</DialogContent>
		</Dialog>
	);
}

/** The button for sign-in. Nothing at all until the video's files are in place. */
export function IntroVideo({
	className,
	ready = INTRO_VIDEO_READY,
}: {
	className?: string;
	ready?: boolean;
}) {
	return ready ? <IntroVideoDialog className={className} /> : null;
}

/**
 * The video's card on the get-started wizard's Hello step. Until the video's files are in place
 * it is the "coming soon" card, exactly as it was.
 */
export function IntroVideoCard({ ready = INTRO_VIDEO_READY }: { ready?: boolean }) {
	if (!ready) {
		return (
			<Card data-slot="intro-video" className="p-(--card-pad) text-sm text-muted-foreground">
				A 1-minute intro video is coming soon.
			</Card>
		);
	}
	return (
		<Card
			data-slot="intro-video"
			className="flex flex-wrap items-center justify-between gap-3 p-(--card-pad) text-sm text-muted-foreground"
		>
			<span>New to Noodle? See how it works first.</span>
			<IntroVideoDialog />
		</Card>
	);
}
