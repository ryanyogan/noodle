/**
 * Scene 2, drawn in code (5–13 s): the Plan as a waterfall. The Take-home pay is one full bar;
 * Commitments, Buckets and Goals each take their part on the way down, and what's left is Free to
 * Spend. Each bar floats where its part falls, like the Plan page's own steps.
 */
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CLAMP, fontFamily, money, useEnter, useLayout } from "../parts";
import { PLAN } from "../story";
import { tokens } from "../tokens";

type RowProps = {
	label: string;
	amount: number;
	/** Where the bar starts and how much of the track it takes, as shares (0–1) of the Take-home pay. */
	start: number;
	share: number;
	fill: string;
	/** The frame, within the scene, when the row comes in. */
	at: number;
	takesAway?: boolean;
	strong?: boolean;
};

function Row({ label, amount, start, share, fill, at, takesAway, strong }: RowProps) {
	const enter = useEnter(at, 24);
	const grow = useEnter(at + 6, 36);
	// The vertical cut has the height for bigger rows.
	const big = useLayout().vertical ? 1.35 : 1;
	const shown = money(amount * grow);
	return (
		<div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 14}px)` }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "baseline",
					marginBottom: 14 * big,
					fontSize: (strong ? 48 : 40) * big,
					lineHeight: 1.2,
				}}
			>
				<span style={{ fontWeight: strong ? 600 : 500 }}>{label}</span>
				<span
					style={{
						fontWeight: 600,
						fontVariantNumeric: "tabular-nums",
						color: strong ? tokens.brand : takesAway ? tokens.mutedForeground : tokens.foreground,
					}}
				>
					{takesAway ? `−${shown}` : shown}
				</span>
			</div>
			<div
				style={{
					position: "relative",
					height: (strong ? 28 : 22) * big,
					borderRadius: 999,
					backgroundColor: tokens.surface3,
					overflow: "hidden",
				}}
			>
				<div
					style={{
						position: "absolute",
						top: 0,
						bottom: 0,
						left: `${start * 100}%`,
						width: `${share * grow * 100}%`,
						borderRadius: 999,
						backgroundColor: fill,
					}}
				/>
			</div>
		</div>
	);
}

const STEP_FILLS = [tokens.chartSpend, tokens.bucketBlue, tokens.mutedForeground];
/** The first step comes in with the second caption (8.5 s, 105 frames into the scene). */
const FIRST_STEP_AT = 102;
const STEP_EVERY = 30;

export function PlanWaterfall() {
	const frame = useCurrentFrame();
	const { durationInFrames } = useVideoConfig();
	const { vertical, top, stageHeight } = useLayout();
	const opacity = interpolate(
		frame,
		[0, 10, durationInFrames - 10, durationInFrames],
		[0, 1, 1, 0],
		CLAMP,
	);

	// Each step sits just below what is still left of the Take-home pay.
	let left: number = PLAN.takeHomePay;
	const steps = PLAN.steps.map((step, index) => {
		left -= step.amount;
		return {
			...step,
			start: left / PLAN.takeHomePay,
			share: step.amount / PLAN.takeHomePay,
			fill: STEP_FILLS[index] ?? tokens.chartSpend,
			at: FIRST_STEP_AT + index * STEP_EVERY,
		};
	});

	return (
		<AbsoluteFill style={{ opacity, fontFamily, color: tokens.foreground }}>
			<div
				style={{
					position: "absolute",
					top,
					height: stageHeight,
					left: 0,
					right: 0,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<div
					style={{
						width: vertical ? 960 : 1180,
						display: "flex",
						flexDirection: "column",
						gap: vertical ? 88 : 36,
					}}
				>
					<Row
						label="Take-home pay"
						amount={PLAN.takeHomePay}
						start={0}
						share={1}
						fill={tokens.brand}
						at={10}
					/>
					{steps.map((step) => (
						<Row
							key={step.label}
							label={step.label}
							amount={step.amount}
							start={step.start}
							share={step.share}
							fill={step.fill}
							at={step.at}
							takesAway
						/>
					))}
					<Row
						label="Free to Spend"
						amount={PLAN.freeToSpend}
						start={0}
						share={PLAN.freeToSpend / PLAN.takeHomePay}
						fill={tokens.brand}
						at={FIRST_STEP_AT + steps.length * STEP_EVERY}
						strong
					/>
				</div>
			</div>
		</AbsoluteFill>
	);
}
