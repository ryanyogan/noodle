import { env } from "cloudflare:workers";
import type { Email } from "./templates";

// Sending email through Cloudflare Email Service's `send_email` binding (ADR-0026). It never
// throws: the caller gets ok, or a plain failure it can show ("Couldn't send"), and carries on.
//
// With AI_MODEL=stub (E2E), or in local dev without the binding, nothing is sent: each email is
// kept in a dev outbox instead (outbox.ts), which tests read through /api/dev/outbox.

export type SendResult = { ok: true } | { ok: false; reason: "not-set-up" | "failed" };

type EmailEnv = { EMAIL?: SendEmail; EMAIL_FROM?: string; STATEMENTS: R2Bucket };

const emailEnv = () => env as unknown as EmailEnv;

/** Sends `email` to one address, from Noodle's own (EMAIL_FROM, shown as "Noodle"). */
export async function sendEmail(to: string, email: Email): Promise<SendResult> {
	const { EMAIL, EMAIL_FROM } = emailEnv();
	if (__AI_STUB__ || (import.meta.env.DEV && !EMAIL)) {
		const { recordInOutbox } = await import("./outbox");
		return recordInOutbox(emailEnv().STATEMENTS, to, email);
	}
	if (!EMAIL || !EMAIL_FROM) return { ok: false, reason: "not-set-up" };
	try {
		await EMAIL.send({
			to,
			from: { email: EMAIL_FROM, name: "Noodle" },
			subject: email.subject,
			text: email.text,
			html: email.html,
		});
		return { ok: true };
	} catch (error) {
		console.error("Couldn't send an email", error);
		return { ok: false, reason: "failed" };
	}
}
