import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { INTRO_FILES, INTRO_PHONE_QUERY, introCut } from "../intro-video-files";
import {
	INTRO_BUTTON_LABEL,
	IntroVideo,
	IntroVideoCard,
	IntroVideoDialog,
	IntroVideoPlayer,
} from "./intro-video";

// The intro video's player (#54). These tests have no browser, so they read the HTML the server
// would send; opening the Dialog and closing it are in e2e/intro-video.spec.ts.

describe("which cut plays", () => {
	it("is the wide one, with its poster, on anything but an upright phone", () => {
		expect(introCut(false)).toEqual({
			src: "/intro/intro.mp4?v=1",
			poster: "/intro/poster.png?v=1",
			width: 1920,
			height: 1080,
		});
	});
	it("is the vertical one on an upright phone", () => {
		expect(introCut(true, true)).toEqual({
			src: "/intro/intro-vertical.mp4?v=1",
			poster: "/intro/poster-vertical.png?v=1",
			width: 1080,
			height: 1920,
		});
	});
	it("shows the wide poster on a phone until the vertical poster exists", () => {
		expect(introCut(true, false).poster).toBe("/intro/poster.png?v=1");
		expect(introCut(true, false).src).toBe("/intro/intro-vertical.mp4?v=1");
	});
	it("calls a phone anything narrower than md and held upright", () => {
		expect(INTRO_PHONE_QUERY).toBe("(max-width: 47.99rem) and (orientation: portrait)");
	});
});

describe("the player", () => {
	const wide = renderToStaticMarkup(h(IntroVideoPlayer, { phone: false }));
	const vertical = renderToStaticMarkup(h(IntroVideoPlayer, { phone: true }));

	it("has the browser's controls and a poster, and fetches nothing until play", () => {
		expect(wide).toContain('src="/intro/intro.mp4?v=1"');
		expect(wide).toContain('poster="/intro/poster.png?v=1"');
		expect(wide).toContain('preload="none"');
		expect(wide).toMatch(/<video[^>]* controls=""/);
		expect(wide).toMatch(/<video[^>]* playsInline=""/i);
	});
	it("never starts by itself", () => {
		expect(wide).not.toMatch(/autoplay/i);
		expect(vertical).not.toMatch(/autoplay/i);
	});
	it("offers English captions, without switching them on", () => {
		const track = /<track[^>]*>/.exec(wide)?.[0] ?? "";
		expect(track).toContain('kind="captions"');
		expect(track).toContain(`src="${INTRO_FILES.captions}"`);
		expect(track).toMatch(/srclang="en"/i);
		expect(track).toContain('label="English"');
		// The words are drawn into the film, so the captions are offered but not switched on.
		expect(track).not.toContain("default");
	});
	it("plays the vertical cut in a tall frame on an upright phone", () => {
		expect(vertical).toContain('src="/intro/intro-vertical.mp4?v=1"');
		expect(vertical).toContain('data-cut="vertical"');
		expect(vertical).toContain("aspect-[9/16]");
		expect(wide).toContain('data-cut="wide"');
		expect(wide).toContain("aspect-video");
	});
});

describe("where it shows", () => {
	it("is a button that says how long the video is, with the player not drawn until it opens", () => {
		const html = renderToStaticMarkup(h(IntroVideoDialog));
		expect(html).toMatch(/<button[^>]*type="button"/);
		expect(html).toContain(INTRO_BUTTON_LABEL);
		expect(html).not.toContain("<video");
	});
	it("promises no sound", () => {
		expect(INTRO_BUTTON_LABEL).toBe("Watch the 1-minute intro");
		expect(INTRO_BUTTON_LABEL).not.toMatch(/listen|hear|sound/i);
	});
	it("shows nothing on sign-in until the files are in place", () => {
		expect(renderToStaticMarkup(h(IntroVideo, { ready: false }))).toBe("");
		expect(renderToStaticMarkup(h(IntroVideo, { ready: true }))).toContain(INTRO_BUTTON_LABEL);
	});
	it("keeps the wizard's coming-soon card until the files are in place", () => {
		const soon = renderToStaticMarkup(h(IntroVideoCard, { ready: false }));
		expect(soon).toContain('data-slot="intro-video"');
		expect(soon).toContain("A 1-minute intro video is coming soon.");
		expect(soon).not.toContain("<button");
		const ready = renderToStaticMarkup(h(IntroVideoCard, { ready: true }));
		expect(ready).toContain('data-slot="intro-video"');
		expect(ready).toContain(INTRO_BUTTON_LABEL);
		expect(ready).not.toContain("coming soon");
	});
});
