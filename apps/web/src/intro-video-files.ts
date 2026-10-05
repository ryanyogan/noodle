// The one-minute intro video (#54): where its files are, and whether they are there yet.
// The files are static, in apps/web/public/intro/ (apps/video/README.md, "Hosting"). This module
// imports nothing, so the E2E specs can read the switch too.

/**
 * Whether the video's files are in apps/web/public/intro/ (they are, since #54's last step). If
 * this is false the get-started wizard shows a "coming soon" card and sign-in shows no button.
 */
export const INTRO_VIDEO_READY: boolean = true;

/**
 * Whether the phone cut has its own poster (poster-vertical.png). Without one, the phone cut
 * shows the wide poster, which the browser fits inside the tall frame.
 */
export const INTRO_VERTICAL_POSTER_READY: boolean = true;

/**
 * Which render the files are. The files keep their names from one render to the next, so this
 * number goes on the end of every address (`?v=1`): add one to it in the commit that replaces the
 * files, or browsers and Cloudflare may go on showing the old film.
 */
export const INTRO_FILES_VERSION = 1;

const version = `?v=${INTRO_FILES_VERSION}` as const;

export const INTRO_FILES = {
	wide: `/intro/intro.mp4${version}`,
	vertical: `/intro/intro-vertical.mp4${version}`,
	poster: `/intro/poster.png${version}`,
	posterVertical: `/intro/poster-vertical.png${version}`,
	captions: `/intro/intro.vtt${version}`,
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
