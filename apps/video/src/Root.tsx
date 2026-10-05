/**
 * The intro video (#54): 60 seconds at 30 frames a second, in two cuts made from the same scenes.
 * `Intro` is 1920×1080 and uses the desktop stills; `IntroVertical` is 1080×1920 and uses the
 * phone stills. A scene finds out which cut it is in from the frame's shape (`useLayout`).
 */
import { AbsoluteFill, Composition, Sequence } from "remotion";
import { Background, CaptionLayer } from "./parts";
import { EndCard, Hook } from "./scenes/Cards";
import { PlanWaterfall } from "./scenes/PlanWaterfall";
import { SHOTS_FROM, SHOTS_TO, ShotsTrack } from "./scenes/Shots";
import { FPS, FRAMES, frames, scene } from "./story";

function Intro() {
	const hook = scene("hook");
	const plan = scene("plan");
	const end = scene("end");
	return (
		<AbsoluteFill>
			<Background />
			<Sequence
				name="1 Hook"
				from={frames(hook.from)}
				durationInFrames={frames(hook.to - hook.from)}
			>
				<Hook />
			</Sequence>
			<Sequence
				name="2 The Plan"
				from={frames(plan.from)}
				durationInFrames={frames(plan.to - plan.from)}
			>
				<PlanWaterfall />
			</Sequence>
			<Sequence name="3–7 The app" from={SHOTS_FROM} durationInFrames={SHOTS_TO - SHOTS_FROM}>
				<ShotsTrack />
			</Sequence>
			<Sequence
				name="8 End card"
				from={frames(end.from)}
				durationInFrames={frames(end.to - end.from)}
			>
				<EndCard />
			</Sequence>
			<CaptionLayer />
		</AbsoluteFill>
	);
}

export function Root() {
	return (
		<>
			<Composition
				id="Intro"
				component={Intro}
				durationInFrames={FRAMES}
				fps={FPS}
				width={1920}
				height={1080}
			/>
			<Composition
				id="IntroVertical"
				component={Intro}
				durationInFrames={FRAMES}
				fps={FPS}
				width={1080}
				height={1920}
			/>
		</>
	);
}
