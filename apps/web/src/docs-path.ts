/**
 * Whether an address is a page of the Docs (issue 126): exactly `/docs`, or `/docs/<slug>` where
 * the slug is lower-case letters, digits and single hyphens; either may end with one slash (the
 * build asks for `/docs/`).
 *
 * The Docs are public and built ahead of time as plain HTML, the same for everyone, so these
 * addresses alone go without Clerk: on the server (start.ts) and in the page's shell
 * (routes/__root.tsx). It is a narrow list of what may, not of what may not: anything it doesn't
 * recognise (an encoded character, dots, a deeper path, a look-alike such as
 * `/docsx`) is treated as the app, behind sign-in. Give it a URL's `pathname`, never a whole URL.
 */
export function isDocsPath(pathname: string): boolean {
	return /^\/docs(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?\/?$/.test(pathname);
}
