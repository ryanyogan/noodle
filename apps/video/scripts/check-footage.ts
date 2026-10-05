/** Stops a render before it starts when a still is missing, and names every missing one. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Cut, footageFile, STILLS } from "../src/footage";

const root = join(import.meta.dirname, "../public");
const cuts: Cut[] = ["desktop", "phone"];
const missing = STILLS.flatMap((name) => cuts.map((cut) => footageFile(name, cut))).filter(
	(file) => !existsSync(join(root, file)),
);

if (missing.length > 0) {
	console.error(
		`Missing footage in apps/video/public/:\n${missing.map((file) => `  ${file}`).join("\n")}\n\nCapture it with: bun run --cwd apps/web video:capture`,
	);
	process.exit(1);
}
console.log(`All ${STILLS.length * cuts.length} stills are in public/footage/`);
