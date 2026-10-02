# The get-started wizard saves as it goes, and a Workflow reads the spending behind it

Status: accepted (2026-10-02, #53)

## Context

A new Household got a name form and then an empty This Month with a checklist. The Parents are new to budgeting (ADR-0018) and needed to be walked through: how spending comes in, take-home pay, bills, Buckets, one Goal, the other Parent. Reading a bank's or a statement's history, filing it and drafting a Plan from it takes longer than a Parent should wait at a spinner. The issue also asked for the final writes (take-home pay, Commitments, Buckets, Goal) to run as Workflow steps when the Parent presses Done.

## Decision

- **Setup is seven steps at `/setup`**, outside the app shell: Hello, Take-home pay, Bills, Buckets, a Goal, Invite, Done. A new Household lands there from `/welcome`. The Get started checklist on This Month stays as the fallback.
- **Progress is one D1 row per Household** (`setup_progress`: step, answers, skipped steps, finished at), saved after every step. Leaving and coming back resumes on the same step with the same answers. Every row and answer carries a client-made id, so going Back and on again changes what was written instead of adding to it.
- **Slow work runs in a `SetupWorkflow`**, started when Hello chooses a bank or a statement. It waits for the first history to land, files it with the same pipeline as any Import, and drafts the Plan. Each job writes its status to `setup_jobs` and tells the Household's screens through `HouseholdAgent` (ADR-0007). The wizard's header reads those rows ("Reading your spending… 1 of 3 done"). Every job is idempotent.
- **Suggestions fill in, and never replace.** When the plan draft lands, steps 2 to 4 fill what the Parent hasn't typed and mark it "Suggested from your spending". Each bill and Bucket remembers whether a Parent touched it, so a draft that arrives after a step was saved still fills the untouched rows.
- **Steps write through the Plan's own server functions as the Parent goes** (`setTakeHomePay`, `addCommitment`, `addBucket`, `addPersonalAllowance`, `addGoal`). Done writes nothing: it reads the month again, checks that the answers are on the Plan (`setupUnsaved`), and only then marks setup finished. If something is missing it names the step and links back to it. This differs from the issue, which put the final writes in the Workflow. Alternative: the Workflow does the writes at Done; rejected because it would need a second copy of the write logic running without the Parent's session (a Personal Allowance belongs to the signed-in Parent, ADR-0003), and the Plan would stay empty until Done. Writing as you go also means a dropped connection leaves a Plan that is whole up to the last finished step.
- **The statement path links out.** The step shows a card that opens Accounts in a new tab, where the Account is added and the statement uploaded as usual. The wizard stays in its tab and fills in as the Workflow reads. The bank path is the same today: the bank is connected on Accounts. Alternative: upload and Plaid Link inside the wizard; left for later, since both flows need an Account to be chosen or paired first (ADR-0020).
- **One Workflow instance per run.** The instance id is `setup-<household>` for the first run and `setup-<household>-<run>` after. "Run setup again" on Household goes back to Hello with the answers kept and adds one to `run` (kept in the answers, so no migration), so choosing a bank or statement again starts a new instance, while starting twice within a run finds the one already there (`createBatch` skips an existing id).
- **The other Parent gets `/joined`, not the wizard.** Joining shows "Here's your Household": the Parents, take-home pay, counts of bills, Buckets and Goals, and a field for their own Personal Allowance.
- **Who is asked to continue.** This Month shows "Continue setup" while setup is started and not finished, or when the Household is brand new. A Household with no progress row that already has take-home pay was set up before the wizard (or through the checklist) and counts as finished.

## Consequences

- A Parent who leaves midway has a partly built Plan, by design. This Month shows what's there and offers the way back.
- Done can't show writes "completing", because there are none. It shows the Plan as it stands, ending in Free to Spend, and that figure is the one This Month then shows.
- With the fakes (`AI_MODEL=stub`) the Workflow's logic (`runSetup`) runs in the Worker after the response instead of as a Workflow instance, so E2E covers the jobs and the wizard's use of them, not Cloudflare's own retry and resume. Unit tests cover a step replayed.
- Two tabs are needed on the statement and bank paths. If suggestions land after setup is finished, nothing applies them yet; the plan draft on This Month still offers them one by one.
