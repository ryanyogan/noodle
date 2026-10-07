/**
 * Set by vite.config.ts: true when AI_MODEL=stub, so Ask and categorization run on deterministic
 * fakes instead of Workers AI and Vectorize.
 */
declare const __AI_STUB__: boolean;

/**
 * Set by vite.config.ts: names the build, the same in the Worker and in the page's script, so an
 * open page can tell a newer one was deployed (build-id.ts).
 */
declare const __BUILD_ID__: string;
