/** The parts every scene shares: the font, the frame's layout, the page ground, the logo and the caption line. */
import { loadFont } from "@remotion/google-fonts/Geist";
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { type Cut, VIEWPORT } from "./footage";
import { CUES, frames } from "./story";
import { tokens } from "./tokens";

// Geist, the app's typeface, in the three weights the video uses. The render waits for it to load.
export const { fontFamily } = loadFont("normal", {
	weights: ["400", "500", "600"],
	subsets: ["latin"],
});

export const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** A spring with no bounce, so things settle instead of wobbling (ADR-0008's quiet motion). */
export const CALM = { damping: 200 } as const;

export function money(dollars: number): string {
	return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

/**
 * Where things go in the frame. Both cuts keep a band at the bottom for the caption line; the
 * stage above it holds a still from the app (in the footage's own shape) or a drawing.
 */
export function useLayout() {
	const { width, height } = useVideoConfig();
	const vertical = height > width;
	const cut: Cut = vertical ? "phone" : "desktop";
	const captionHeight = vertical ? 330 : 190;
	const top = vertical ? 70 : 48;
	const stageHeight = height - top - captionHeight;
	// The phone cut's stage has a phone still's own shape. The wide cut's is flatter than a computer
	// still, so a still fills most of the frame's width and the camera shows a band of its height.
	const stageWidth = vertical
		? Math.round((stageHeight * VIEWPORT[cut].width) / VIEWPORT[cut].height)
		: Math.round(width * 0.88);
	return { width, height, vertical, cut, captionHeight, top, stageHeight, stageWidth };
}

/** 0 to 1, starting `delay` frames into the current sequence. */
export function useEnter(delay: number, durationInFrames = 30): number {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	return spring({ frame: frame - delay, fps, config: CALM, durationInFrames });
}

/** The page ground: the app's near-white page with its one faint accent wash at the top. */
export function Background() {
	return (
		<AbsoluteFill
			style={{
				backgroundColor: tokens.background,
				backgroundImage: `linear-gradient(to bottom, ${tokens.glow}, transparent 45%)`,
			}}
		/>
	);
}

/** Noodle's mark, as in packages/ui's logo.tsx. `drawn` (0–1) draws the noodle, then the dot appears. */
export function LogoMark({ size, drawn = 1 }: { size: number; drawn?: number }) {
	const dot = interpolate(drawn, [0.85, 1], [0, 1], CLAMP);
	return (
		<svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
			<rect width="64" height="64" rx="16" fill={tokens.foreground} />
			<path
				d="M18 44V26a8 8 0 0 1 16 0v11a8 8 0 0 0 16 0V20"
				fill="none"
				stroke={tokens.background}
				strokeWidth="7"
				strokeLinecap="round"
				strokeLinejoin="round"
				pathLength={1}
				strokeDasharray="1 1"
				strokeDashoffset={1 - Math.min(1, drawn / 0.85)}
				opacity={drawn > 0.01 ? 1 : 0}
			/>
			<circle cx="50" cy="20" r="5.5" fill={tokens.logoDot} opacity={dot} />
		</svg>
	);
}

export function Logo({ size, drawn = 1 }: { size: number; drawn?: number }) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: size * 0.36 }}>
			<LogoMark size={size} drawn={drawn} />
			<span
				style={{
					fontSize: size * 0.72,
					fontWeight: 600,
					letterSpacing: "-0.02em",
					color: tokens.foreground,
				}}
			>
				Noodle
			</span>
		</div>
	);
}

/** Centres its children in the whole frame, in the app's type. */
export function Centered({ children, style }: { children: ReactNode; style?: CSSProperties }) {
	return (
		<AbsoluteFill
			style={{
				fontFamily,
				color: tokens.foreground,
				alignItems: "center",
				justifyContent: "center",
				textAlign: "center",
				...style,
			}}
		>
			{children}
		</AbsoluteFill>
	);
}

/**
 * The caption line: the story's words, burned into the band at the bottom of the frame. A cue
 * marked `headline` is drawn by its own scene instead. The vertical cut is narrower, so there a
 * caption wraps where it needs to rather than at the wide cut's line break.
 */
export function CaptionLayer() {
	const frame = useCurrentFrame();
	const { vertical, captionHeight } = useLayout();
	const cue = CUES.find(
		(each) => !each.headline && frame >= frames(each.from) && frame < frames(each.to),
	);
	if (!cue) return null;
	const from = frames(cue.from);
	const to = frames(cue.to);
	const opacity = interpolate(frame, [from, from + 6, to - 6, to], [0, 1, 1, 0], CLAMP);
	const lift = interpolate(frame, [from, from + 6], [8, 0], CLAMP);
	return (
		<AbsoluteFill style={{ justifyContent: "flex-end" }}>
			<div
				style={{
					height: captionHeight,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					padding: vertical ? "0 70px" : "0 120px",
				}}
			>
				<p
					style={{
						margin: 0,
						fontFamily,
						fontSize: vertical ? 46 : 44,
						lineHeight: 1.3,
						fontWeight: 500,
						letterSpacing: "-0.01em",
						color: tokens.foreground,
						textAlign: "center",
						whiteSpace: vertical ? "normal" : "pre-line",
						opacity,
						transform: `translateY(${lift}px)`,
					}}
				>
					{vertical ? cue.text.replaceAll("\n", " ") : cue.text}
				</p>
			</div>
		</AbsoluteFill>
	);
}
