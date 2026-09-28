import { env } from "cloudflare:workers";
import { createDb } from "@noodle/db";

export const getDb = () => createDb(env.DB);
