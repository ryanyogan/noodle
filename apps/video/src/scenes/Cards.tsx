/** Scenes 1 and 8, drawn in code: the Hook that opens the video and the End card that closes it. */
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Centered, CLAMP, Logo, useEnter, useLayout } from "../parts";
import { APP_URL, headline } from "../story";
import { tokens } from "../tokens";

/** 0–5 s. The mark draws itself, then the line comes up under it. */
export function Hook() {
	const frame = useCurrentFrame();
	const { durationInFrames } = useVideoConfig();
	const { vertical } = useLayout();
	const drawn = useEnter(6, 40);
	const line = useEnter(34, 30);
	const out = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], CLAMP);
	return (
		<Centered style={{ opacity: out, gap: vertical ? 80 : 64, padding: "0 90px" }}>
			<div style={{ opacity: interpolate(frame, [0, 10], [0, 1], CLAMP) }}>
				<Logo size={vertical ? 132 : 120} drawn={drawn} />
			</div>
			<h1
				style={{
					margin: 0,
					fontSize: vertical ? 84 : 88,
					lineHeight: 1.12,
					fontWeight: 600,
					letterSpacing: "-0.03em",
					maxWidth: vertical ? 880 : 1500,
					opacity: line,
					transform: `translateY(${(1 - line) * 16}px)`,
				}}
			>
				{headline("hook")}
			</h1>
		</Centered>
	);
}

/** 58–60 s. The logo, the main button's look with "Start your Plan", and where to find the app. */
export function EndCard() {
	const frame = useCurrentFrame();
	const { vertical } = useLayout();
	const button = useEnter(6, 20);
	return (
		<Centered
			style={{ opacity: interpolate(frame, [0, 10], [0, 1], CLAMP), gap: vertical ? 72 : 56 }}
		>
			<Logo size={vertical ? 108 : 96} />
			<div
				style={{
					padding: "30px 64px",
					borderRadius: tokens.radiusControl * 2,
					backgroundColor: tokens.brand,
					color: tokens.primaryForeground,
					fontSize: 64,
					fontWeight: 600,
					letterSpacing: "-0.02em",
					boxShadow: tokens.elevationCard,
					transform: `scale(${0.96 + 0.04 * button})`,
				}}
			>
				{headline("end")}
			</div>
			<div style={{ fontSize: 44, fontWeight: 500, color: tokens.mutedForeground }}>{APP_URL}</div>
		</Centered>
	);
}
