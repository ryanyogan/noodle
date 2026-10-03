-- Ends the practice (Plaid Sandbox) Bank Connections in production, once, at the switch to
-- production Plaid (#70; docs/runbooks/plaid-production.md). PREPARED, NOT RUN: the lead runs it
-- at step 3 of the runbook, after reviewing it, with
--
--   npx wrangler d1 execute noodle --remote --file scripts/plaid-retire-sandbox.sql
--
-- from apps/web. It does exactly what Disconnect does after Plaid's /item/remove (#61,
-- removeBankConnection in packages/db/src/bank-connections.ts): each Account is unpaired and kept
-- by hand, with every Transaction, statement, balance and Goal it has; the Bank Connection is
-- marked disconnected and its access token deleted. Sandbox access tokens mean nothing to
-- production Plaid, so there's nothing to remove there.
--
-- Only Bank Connections made before the switch are touched: replace BOTH __SWITCH_MS__ below with
-- the moment of the switch in Unix milliseconds (`date +%s%3N`), taken before the PLAID_ENV deploy.
-- Left as it is, the placeholder is a SQL error and nothing changes. A real bank connected after
-- the switch is never touched, and running it again changes nothing (a disconnected Bank
-- Connection's credential is '' already).
--
-- Read-only, first, to see what it will end:
--   npx wrangler d1 execute noodle --remote --command "SELECT id, household_id, institution, status, created_at FROM bank_connections WHERE credential <> ''"

UPDATE accounts
SET bank_connection_id = NULL, external_id = NULL
WHERE bank_connection_id IN (
	SELECT id FROM bank_connections
	WHERE provider = 'plaid' AND credential <> '' AND created_at < __SWITCH_MS__
);

UPDATE bank_connections
SET status = 'disconnected',
	credential = '',
	external_id = 'removed:' || id,
	cursor = NULL,
	notice = NULL,
	new_accounts = 0,
	sync_started_at = NULL,
	sync_pending = 0
WHERE provider = 'plaid' AND credential <> '' AND created_at < __SWITCH_MS__;
