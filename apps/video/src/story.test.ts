import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { timestamp, toScript, toVtt } from "./captions";
import { type Cut, FOCUS, focusFor, focusFromBox, STILLS } from "./footage";
import { bucketOn, CUES, FRAMES, PLAN, SCENES, SECONDS } from "./story";
import { cssTokens } from "./tokens";

const here = import.meta.dirname;

describe("the story", () => {
	it("follows the storyboard's times", () => {
		expect(SCENES.map((scene) => [scene.id, scene.from, scene.to])).toEqual([
			["hook", 0, 5],
			["plan", 5, 13],
			["this-month", 13, 22],
			["with-plaid", 22, 32],
			["without-plaid", 32, 42],
			["goals-explore", 42, 50],
			["get-the-most", 50, 58],
			["end", 58, 60],
		]);
		expect(FRAMES).toBe(1800);
	});

	it("has captions from 0 to 60 seconds with no gap and no overlap", () => {
		expect(CUES[0]?.from).toBe(0);
		expect(CUES.at(-1)?.to).toBe(SECONDS);
		for (const [index, cue] of CUES.entries()) {
			expect(cue.to, cue.text).toBeGreaterThan(cue.from);
			const next = CUES[index + 1];
			if (next) expect(next.from, next.text).toBe(cue.to);
		}
	});

	it("keeps each scene's captions and shots inside the scene", () => {
		for (const scene of SCENES) {
			expect(scene.cues[0]?.from, scene.id).toBe(scene.from);
			expect(scene.cues.at(-1)?.to, scene.id).toBe(scene.to);
			if (scene.shots.length === 0) continue;
			expect(scene.shots[0]?.from, scene.id).toBe(scene.from);
			expect(scene.shots.at(-1)?.to, scene.id).toBe(scene.to);
			for (const [index, shot] of scene.shots.entries()) {
				const next = scene.shots[index + 1];
				if (next) expect(next.from, scene.id).toBe(shot.to);
			}
		}
	});

	it("keeps captions to two short lines", () => {
		for (const cue of CUES) {
			const lines = cue.text.split("\n");
			expect(lines.length, cue.text).toBeLessThanOrEqual(2);
			for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(56);
		}
	});

	it("only shows stills the footage contract has, and rings only where a focus is set", () => {
		for (const scene of SCENES) {
			for (const shot of scene.shots) {
				if (shot.kind !== "still") continue;
				expect(STILLS).toContain(shot.still);
				if (shot.ring) {
					expect(focusFor(shot.still, "desktop"), shot.still).toBeDefined();
					expect(focusFor(shot.still, "phone"), shot.still).toBeDefined();
				}
			}
		}
	});

	it("keeps every focus inside its still", () => {
		for (const [name, cuts] of Object.entries(FOCUS)) {
			for (const rect of Object.values(cuts)) {
				expect(rect.x, name).toBeGreaterThanOrEqual(0);
				expect(rect.y, name).toBeGreaterThanOrEqual(0);
				expect(rect.x + rect.w, name).toBeLessThanOrEqual(1);
				expect(rect.y + rect.h, name).toBeLessThanOrEqual(1);
			}
		}
	});

	it("takes a measured subject over the guess, with room round it, inside the still", () => {
		const cuts: Cut[] = ["desktop", "phone"];
		for (const name of STILLS) {
			for (const cut of cuts) {
				const rect = focusFor(name, cut);
				if (!rect) continue;
				expect(rect.x, name).toBeGreaterThanOrEqual(0);
				expect(rect.y, name).toBeGreaterThanOrEqual(0);
				expect(rect.x + rect.w, name).toBeLessThanOrEqual(1);
				expect(rect.y + rect.h, name).toBeLessThanOrEqual(1);
			}
		}
		const sheet = focusFromBox({ x: 0, y: 0.238, width: 1, height: 0.762 }, "phone");
		expect(sheet?.x).toBeGreaterThan(0);
		expect((sheet?.x ?? 0) + (sheet?.w ?? 0)).toBeLessThan(1);
		const button = focusFromBox({ x: 0.5, y: 0.5, width: 0.1, height: 0.04 }, "desktop");
		expect(button?.x).toBeLessThan(0.5);
		expect(button?.w).toBeGreaterThan(0.1);
		expect(focusFromBox(undefined, "desktop")).toBeUndefined();
		expect(focusFromBox({ x: 0.2, y: 0.2, width: 0, height: 0 }, "desktop")).toBeUndefined();
	});

	it("draws a Plan and a Bucket that add up", () => {
		const assigned = PLAN.steps.reduce((sum, step) => sum + step.amount, 0);
		expect(PLAN.takeHomePay - assigned).toBe(PLAN.freeToSpend);
		const bar = bucketOn(new Date(2026, 9, 18));
		expect(bar.spent).toBeLessThan(bar.available * bar.pace);
	});
});

describe("captions and script", () => {
	it("writes WebVTT times", () => {
		expect(timestamp(0)).toBe("00:00:00.000");
		expect(timestamp(25.5)).toBe("00:00:25.500");
		expect(timestamp(60)).toBe("00:01:00.000");
		expect(toVtt(CUES).startsWith("WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\n")).toBe(true);
	});

	it("has script.md up to date with the story (run `bun run captions`)", () => {
		expect(readFileSync(join(here, "../script.md"), "utf8")).toBe(toScript(SCENES));
	});
});

describe("tokens", () => {
	it("match the app's light tokens in globals.css", () => {
		const css = readFileSync(join(here, "../../../packages/ui/src/styles/globals.css"), "utf8");
		for (const [name, value] of Object.entries(cssTokens)) {
			// The first declaration of a token is the light one (:root comes before the dark block).
			const found = css.match(new RegExp(`\\n\\t${name}:\\s*([^;]+);`));
			expect(found?.[1]?.replace(/\s+/g, " "), name).toBe(value);
		}
	});
});
