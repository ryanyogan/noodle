/** Writes out/intro.vtt (the captions track) and script.md (the narration) from src/story.ts. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toScript, toVtt } from "../src/captions";
import { CUES, SCENES } from "../src/story";

const root = join(import.meta.dirname, "..");
mkdirSync(join(root, "out"), { recursive: true });
writeFileSync(join(root, "out/intro.vtt"), toVtt(CUES));
writeFileSync(join(root, "script.md"), toScript(SCENES));
console.log(`Wrote out/intro.vtt (${CUES.length} cues) and script.md`);
