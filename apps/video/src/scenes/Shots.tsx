/**
 * Scenes 3 to 7 (13–58 s): This Month, With Plaid, Without Plaid, Goals and Explore, and Get the
 * most from it. Each is a run of shots from src/story.ts. A shot is a still from the app, which
 * the camera moves in on slowly with a ring round what the caption is about, or the Bucket bar
 * drawn in code. Every shot fills the same stage, and each one fades in over the one before.
 */
import type { ReactNode } from "react";
import {
	AbsoluteFill,
	Img,
	interpolate,
	Sequence,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { focusFor, footageFile, type Rect, type StillName, VIEWPORT } from "../footage";
import { CLAMP, fontFamily, money, useEnter, useLayout } from "../parts";
import { bucketOn, frames, SCENES, type Shot } from "../story";
import { tokens } from "../tokens";

/** How long one shot takes to fade in over the last, in frames. */
const FADE = 10;

/** The scenes that are cut from shots, in order, as one run. */
export const SHOTS: Shot[] = SCENES.flatMap((scene) => scene.shots);
export const SHOTS_FROM = frames(SHOTS[0]?.from ?? 0);
export const SHOTS_TO = frames(SHOTS.at(-1)?.to ?? 0);

/**
 * The frame every shot sits in, with the app's card edge and shadow. `card` is for a drawing: in
 * the vertical cut it is a wide card in the middle of the stage instead of a phone's tall shape.
 */
function Stage({ children, card = false }: { children: ReactNode; card?: boolean }) {
	const { width, top, stageWidth, stageHeight, vertical } = useLayout();
	const wide = card && vertical;
	const boxWidth = wide ? width - 100 : stageWidth;
	const boxHeight = wide ? 720 : stageHeight;
	return (
		<div
			style={{
				position: "absolute",
				top: top + (stageHeight - boxHeight) / 2,
				left: (width - boxWidth) / 2,
				width: boxWidth,
				height: boxHeight,
				borderRadius: vertical ? 40 : 22,
				overflow: "hidden",
				backgroundColor: tokens.card,
				border: `1px solid ${tokens.borderStrong}`,
				boxShadow: tokens.elevationPop,
			}}
		>
			{children}
		</div>
	);
}

/** How much of the stage's width and height a subject may take once the camera has moved in. */
const FILL = { w: 0.8, h: 0.86 };

/**
 * The camera on a still, `move` (0 to 1) of the way in on its focus. The still is drawn as wide as
 * the stage times the scale; where the stage is flatter than the still (the wide cut) only a band
 * of its height shows. Gives the still's size and place in the stage in px, and `tall` when the
 * focus is too tall to fit in the band (it is then shown from its top).
 */
function camera(
	focus: Rect | undefined,
	stage: { width: number; height: number },
	shape: number,
	most: number,
	move: number,
) {
	// The share of the still's height in view when it is exactly as wide as the stage.
	const band = Math.min(1, stage.height / (stage.width * shape));
	const end = focus
		? Math.max(1.04, Math.min(most, FILL.w / focus.w, (FILL.h * band) / focus.h))
		: 1.04;
	const tall = !!focus && focus.h > band / end;
	const scale = 1 + (end - 1) * move;
	const w = 1 / scale;
	const h = band / scale;
	const clamp = (value: number, size: number) => Math.min(1 - size, Math.max(0, value));
	const x = clamp((focus ? focus.x + focus.w / 2 : 0.5) - w / 2, w);
	// A page with no subject is read from its top, and so is a subject taller than the band.
	const y = clamp(!focus ? 0 : tall ? focus.y - 0.02 : focus.y + focus.h / 2 - h / 2, h);
	const width = stage.width * scale;
	const height = width * shape;
	return { width, height, left: -x * width, top: -y * height, tall };
}

function StillShot({ still, ring }: { still: StillName; ring: boolean }) {
	const { cut, stageWidth, stageHeight } = useLayout();
	const focus = focusFor(still, cut);
	const move = useEnter(FADE, 70);
	const ringIn = useEnter(FADE + 14, 20);
	// A phone's still is already shown large, and moving in far on it cuts its lines of text off at
	// the sides. A computer's still fills the stage's width, so a little is enough there too.
	const view = camera(
		focus,
		{ width: stageWidth, height: stageHeight },
		VIEWPORT[cut].height / VIEWPORT[cut].width,
		cut === "phone" ? 1.12 : 1.2,
		move,
	);
	// A ring round nearly the whole still points at nothing, and one that runs out of view is half a ring.
	const ringed = ring && focus && !view.tall && focus.w * focus.h < 0.7;
	return (
		<Stage>
			{/* The ring is inside the layer that moves, so it stays on its subject. */}
			<div
				style={{
					position: "absolute",
					left: 0,
					top: 0,
					width: view.width,
					height: view.height,
					transform: `translate(${view.left}px, ${view.top}px)`,
				}}
			>
				{/* A still that is missing stops the render: Img waits for the file and throws when it can't load. */}
				<Img
					src={staticFile(footageFile(still, cut))}
					style={{ display: "block", width: "100%", height: "100%" }}
				/>
				{ringed ? (
					<div
						style={{
							position: "absolute",
							left: `${focus.x * 100}%`,
							top: `${focus.y * 100}%`,
							width: `${focus.w * 100}%`,
							height: `${focus.h * 100}%`,
							boxSizing: "border-box",
							border: `4px solid ${tokens.brand}`,
							borderRadius: 16,
							boxShadow: `0 0 0 8px ${tokens.brandSoft}`,
							opacity: ringIn,
						}}
					/>
				) : null}
			</div>
		</Stage>
	);
}

/**
 * A Bucket's bar filling as money is spent, with the Pace line, in the look and the colour of the
 * app's own Groceries bar, and with that row's numbers on the day the video is made.
 */
function BucketShot() {
	const { vertical } = useLayout();
	const spend = useEnter(FADE + 6, 50);
	const paceIn = useEnter(FADE + 40, 20);
	const bucket = bucketOn(new Date());
	const spent = bucket.spent * spend;
	const size = vertical ? 60 : 56;
	const small = vertical ? 42 : 38;
	return (
		<Stage card>
			<AbsoluteFill
				style={{
					fontFamily,
					color: tokens.foreground,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<div style={{ width: vertical ? "84%" : "72%" }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							fontSize: size,
							fontWeight: 600,
							letterSpacing: "-0.02em",
						}}
					>
						<span style={{ display: "flex", alignItems: "center", gap: 20 }}>
							<span
								style={{
									width: size,
									height: size,
									borderRadius: tokens.radiusControl,
									backgroundColor: tokens.bucketBlue,
								}}
							/>
							{bucket.name}
						</span>
						<span style={{ fontVariantNumeric: "tabular-nums" }}>
							{money(bucket.available - spent)} left
						</span>
					</div>
					<div
						style={{
							position: "relative",
							height: 32,
							marginTop: 120,
							borderRadius: 999,
							backgroundColor: tokens.surface3,
						}}
					>
						<div
							style={{
								position: "absolute",
								top: 0,
								bottom: 0,
								left: 0,
								width: `${(spent / bucket.available) * 100}%`,
								borderRadius: 999,
								backgroundColor: tokens.bucketBlue,
							}}
						/>
						<div
							style={{
								position: "absolute",
								left: `${bucket.pace * 100}%`,
								top: -14,
								bottom: -14,
								width: 5,
								marginLeft: -2.5,
								borderRadius: 3,
								backgroundColor: tokens.foreground,
								opacity: paceIn,
							}}
						/>
						<div
							style={{
								position: "absolute",
								left: `${bucket.pace * 100}%`,
								bottom: 56,
								transform: "translateX(-50%)",
								whiteSpace: "nowrap",
								fontSize: small,
								fontWeight: 500,
								color: tokens.mutedForeground,
								opacity: paceIn,
							}}
						>
							Pace
						</div>
					</div>
					<div
						style={{
							marginTop: 36,
							fontSize: small,
							color: tokens.mutedForeground,
							fontVariantNumeric: "tabular-nums",
						}}
					>
						{money(spent)} spent of {money(bucket.available)}
					</div>
				</div>
			</AbsoluteFill>
		</Stage>
	);
}

/** Fades a shot in; the very last shot also fades out, back to the page ground. */
function Fade({ children, out }: { children: ReactNode; out: boolean }) {
	const frame = useCurrentFrame();
	const { durationInFrames } = useVideoConfig();
	const fadeIn = interpolate(frame, [0, FADE], [0, 1], CLAMP);
	const fadeOut = out
		? interpolate(frame, [durationInFrames - FADE, durationInFrames], [1, 0], CLAMP)
		: 1;
	return <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>{children}</AbsoluteFill>;
}

/** Every shot from 13 s to 58 s. Its own frame 0 is `SHOTS_FROM` in the video. */
export function ShotsTrack() {
	return (
		<>
			{SHOTS.map((shot, index) => {
				const last = index === SHOTS.length - 1;
				const length = frames(shot.to) - frames(shot.from);
				return (
					<Sequence
						key={`${shot.from}-${shot.kind}`}
						from={frames(shot.from) - SHOTS_FROM}
						// A shot stays under the next one while that fades in.
						durationInFrames={last ? length : length + FADE}
						name={shot.kind === "still" ? shot.still : "Bucket bar"}
					>
						<Fade out={last}>
							{shot.kind === "still" ? (
								<StillShot still={shot.still} ring={shot.ring ?? false} />
							) : (
								<BucketShot />
							)}
						</Fade>
					</Sequence>
				);
			})}
		</>
	);
}
