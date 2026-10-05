/** Turns the story into the two text files beside the video: WebVTT captions and the narration script. */
import { type Cue, type Scene, SECONDS } from "./story";

/** 65.5 -> "00:01:05.500" */
export function timestamp(seconds: number): string {
	const ms = Math.round(seconds * 1000);
	const pad = (value: number, size: number) => String(value).padStart(size, "0");
	return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`;
}

export function toVtt(cues: Cue[]): string {
	const blocks = cues.map(
		(cue, index) => `${index + 1}\n${timestamp(cue.from)} --> ${timestamp(cue.to)}\n${cue.text}`,
	);
	return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

/** 5 -> "0:05" */
function clock(seconds: number): string {
	const whole = Math.floor(seconds);
	const tenths = Math.round((seconds - whole) * 10);
	const base = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
	return tenths === 0 ? base : `${base}.${tenths}`;
}

export function toScript(scenes: Scene[]): string {
	const parts = scenes.map((scene) => {
		const onScreen = scene.cues
			.map((cue) => `- ${clock(cue.from)}–${clock(cue.to)}: ${cue.text.replaceAll("\n", " ")}`)
			.join("\n");
		return `## ${clock(scene.from)}–${clock(scene.to)} · ${scene.title}\n\n${scene.narration}\n\nOn screen:\n\n${onScreen}`;
	});
	return `# Noodle intro: narration script

<!-- Written by \`bun run captions\` from src/story.ts. Change the words there, not here. -->

${SECONDS} seconds. Each part is read during its scene; the lines under "On screen" are the captions
burned into the video, which are also in \`out/intro.vtt\`. No voiceover is recorded yet.

${parts.join("\n\n")}
`;
}
