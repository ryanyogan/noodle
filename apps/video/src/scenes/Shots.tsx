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
import { focusFor, footageFile, type Rect, type StillName } from "../footage";
import { CLAMP, fontFamily, money, useEnter, useLayout } from "../parts";
import { BUCKET, frames, SCENES, type Shot } from "../story";
import { tokens } from "../tokens";

/** How long one shot takes to fade in over the last, in frames. */
const FADE = 10;

/** The scenes that are cut from shots, in order, as one run. */
export const SHOTS: Shot[] = SCENES.flatMap((scene) => scene.shots);
export const SHOTS_FROM = frames(SHOTS[0]?.from ?? 0);
export const SHOTS_TO = frames(SHOTS.at(-1)?.to ?? 0);

/** The frame every shot sits in: the footage's shape, with the app's card edge and shadow. */
function Stage({ children }: { children: ReactNode }) {
	const { width, top, stageWidth, stageHeight, vertical } = useLayout();
	return (
		<div
			style={{
				position: "absolute",
				top,
				left: (width - stageWidth) / 2,
				width: stageWidth,
				height: stageHeight,
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

/**
 * How far to move in on a focus: until it takes about four fifths of the stage, and never more
 * than half as big again (the stills have the pixels for that, so nothing is blown up soft).
 */
function zoomFor(focus: Rect | undefined, most: number): number {
	if (!focus) return 1.04;
	return Math.max(1.04, Math.min(most, 0.8 / Math.max(focus.w, focus.h)));
}

/** The part of the still in view at `scale`: centred on (cx, cy) as far as the still's edges allow. */
function windowAt(scale: number, cx: number, cy: number) {
	const size = 1 / scale;
	const clamp = (value: number) => Math.min(1 - size, Math.max(0, value));
	return { x: clamp(cx - size / 2), y: clamp(cy - size / 2) };
}

function StillShot({ still, ring }: { still: StillName; ring: boolean }) {
	const { cut } = useLayout();
	const focus = focusFor(still, cut);
	const move = useEnter(FADE, 70);
	const ringIn = useEnter(FADE + 14, 20);
	// A phone's still is already shown large, and moving in far on it cuts its lines of text off at the sides.
	const scale = 1 + (zoomFor(focus, cut === "phone" ? 1.12 : 1.5) - 1) * move;
	const view = windowAt(
		scale,
		focus ? focus.x + focus.w / 2 : 0.5,
		focus ? focus.y + focus.h / 2 : 0.5,
	);
	// A ring round nearly the whole still points at nothing.
	const ringed = ring && focus && focus.w * focus.h < 0.7;
	return (
		<Stage>
			{/* The ring is inside the layer that grows, so it stays on its subject; its line is thinned to match. */}
			<div
				style={{
					position: "absolute",
					inset: 0,
					transform: `translate(${-view.x * scale * 100}%, ${-view.y * scale * 100}%) scale(${scale})`,
					transformOrigin: "0 0",
				}}
			>
				{/* A still that is missing stops the render: Img waits for the file and throws when it can't load. */}
				<Img
					src={staticFile(footageFile(still, cut))}
					style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
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
							border: `${4 / scale}px solid ${tokens.brand}`,
							borderRadius: 16 / scale,
							boxShadow: `0 0 0 ${8 / scale}px ${tokens.brandSoft}`,
							opacity: ringIn,
						}}
					/>
				) : null}
			</div>
		</Stage>
	);
}

/** A Bucket's bar filling as money is spent, with the Pace line, in the look of the app's own bar. */
function BucketShot() {
	const { vertical } = useLayout();
	const spend = useEnter(FADE + 6, 50);
	const paceIn = useEnter(FADE + 40, 20);
	const spent = BUCKET.spent * spend;
	const size = vertical ? 44 : 48;
	return (
		<Stage>
			<AbsoluteFill
				style={{
					fontFamily,
					color: tokens.foreground,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<div style={{ width: "80%" }}>
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
						<span style={{ display: "flex", alignItems: "center", gap: 18 }}>
							<span
								style={{
									width: size,
									height: size,
									borderRadius: tokens.radiusControl,
									backgroundColor: tokens.bucketGreen,
								}}
							/>
							{BUCKET.name}
						</span>
						<span style={{ fontVariantNumeric: "tabular-nums" }}>
							{money(BUCKET.available - spent)} left
						</span>
					</div>
					<div
						style={{
							position: "relative",
							height: 24,
							marginTop: 96,
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
								width: `${(spent / BUCKET.available) * 100}%`,
								borderRadius: 999,
								backgroundColor: tokens.bucketGreen,
							}}
						/>
						<div
							style={{
								position: "absolute",
								left: `${BUCKET.pace * 100}%`,
								top: -12,
								bottom: -12,
								width: 4,
								marginLeft: -2,
								borderRadius: 2,
								backgroundColor: tokens.foreground,
								opacity: paceIn,
							}}
						/>
						<div
							style={{
								position: "absolute",
								left: `${BUCKET.pace * 100}%`,
								bottom: 46,
								transform: "translateX(-50%)",
								whiteSpace: "nowrap",
								fontSize: 34,
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
							marginTop: 30,
							fontSize: 34,
							color: tokens.mutedForeground,
							fontVariantNumeric: "tabular-nums",
						}}
					>
						{money(spent)} spent of {money(BUCKET.available)}
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
