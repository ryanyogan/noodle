/**
 * Takes the subjects' measured places from the capture (public/footage/footage.json) into
 * src/measured.json, which src/footage.ts reads: the camera and the ring then go to where each
 * subject really is in these stills. Without a footage.json the last measured places stay.
 */
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const from = join(import.meta.dirname, "../public/footage/footage.json");
const to = join(import.meta.dirname, "../src/measured.json");

if (existsSync(from)) {
	copyFileSync(from, to);
	console.log("Subjects' places taken from public/footage/footage.json");
} else {
	console.log("No public/footage/footage.json: keeping src/measured.json as it is");
}
