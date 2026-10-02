import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";
import { removeStaleTestParents } from "./parents";

setup.describe.configure({ mode: "serial" });

setup("clerk testing token", async () => {
	await clerkSetup();
});

setup("remove test Parents left by earlier runs", async () => {
	await removeStaleTestParents();
});
