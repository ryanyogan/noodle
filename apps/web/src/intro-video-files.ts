// The one-minute intro video (#54): where its files are, and whether they are there yet.
// The files are static, in apps/web/public/intro/ (apps/video/README.md, "Hosting"). This module
// imports nothing, so the E2E specs can read the switch too.

/**
 * Whether the video's files are in apps/web/public/intro/. While this is false nothing a Parent
 * sees changes: the get-started wizard keeps its "coming soon" card and sign-in shows no button.
 * Set it to true in the commit that adds the files.
 */
export const INTRO_VIDEO_READY: boolean = false;

/**
 * Whether the phone cut has its own poster (poster-vertical.png). Until it does, the phone cut
 * shows the wide poster, which the browser fits inside the tall frame.
 */
export const INTRO_VERTICAL_POSTER_READY: boolean = false;

export const INTRO_FILES = {
	wide: "/intro/intro.mp4",
	vertical: "/intro/intro-vertical.mp4",
	poster: "/intro/poster.png",
	posterVertical: "/intro/poster-vertical.png",
	captions: "/intro/intro.vtt",
} as const;

/** A phone held upright: narrower than Tailwind's `md` (48rem) and taller than it is wide. */
export const INTRO_PHONE_QUERY = "(max-width: 47.99rem) and (orientation: portrait)";

export type IntroCut = {
	src: string;
	poster: string;
	/** The cut's own size in pixels, which gives the frame its shape before anything loads. */
	width: number;
	height: number;
};

/** The cut for this screen: the vertical one on an upright phone, the wide one everywhere else. */
export function introCut(
	phone: boolean,
	verticalPoster: boolean = INTRO_VERTICAL_POSTER_READY,
): IntroCut {
	if (!phone) {
		return { src: INTRO_FILES.wide, poster: INTRO_FILES.poster, width: 1920, height: 1080 };
	}
	return {
		src: INTRO_FILES.vertical,
		poster: verticalPoster ? INTRO_FILES.posterVertical : INTRO_FILES.poster,
		width: 1080,
		height: 1920,
	};
}
