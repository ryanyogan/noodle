// Stands in for the Workers runtime module in unit tests, which never reach the Worker.
export const env = {};
export class DurableObject {}
export class WorkflowEntrypoint {}
export function waitUntil(_promise: Promise<unknown>) {}

/** cloudflare:workflows' error a step throws to fail without retrying. */
export class NonRetryableError extends Error {}
