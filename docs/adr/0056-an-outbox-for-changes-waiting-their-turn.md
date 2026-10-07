# An outbox on the device, so a change waiting its turn is not lost with the page

Decided 2026-10-06 (issue 128, phase 128b; reviewed and narrowed the same day, phase 128c). Amended 2026-10-06 (issue 129): a Rule stated from a card joins, see "A Rule stated from a card" below.

Changes to Transactions from one screen go to the server one at a time, in the order they were made (`reviewWrites`, ADR-0041). A request already sent is marked `keepalive` and outlives the page (`keep-saving.ts`). One still waiting its turn behind an unanswered one has not been sent, and a page that is gone sends nothing. A Parent who decided several Review cards on a slow connection and then closed the tab, reloaded, or left for another whole page lost every change but the first, without a word: on the next visit the screen showed the older state. Shown on untouched code by `e2e/splits.spec.ts` ("a change still waiting its turn…"), all three ways of leaving.

## Decision

Each such change is written down on the device when it is made, crossed off when the server answers, and what is left is sent again when the app next opens (`apps/web/src/outbox.ts`, `waiting-writes.ts`).

- **Where**: `localStorage`, one key per Household and Parent (`noodle.outbox.<household>.<parent>`), a JSON list in the order the changes were made. What is kept is what the write was asked with: the Transaction as the screen had it and its new values. No credentials. It is gone as soon as the server answers.
- **Whose**: only the signed-in Parent's, in their Household. Opening the app as anyone else on that device drops the other key unsent.
- **Which writes**: the ones that wait their turn and that the server can tell a repeat of, marked `meta: { outbox: … }`: a Transaction's edit, split, rename or delete, a Review card's decision, several confirmed at once, an Undo back into Review (each says the version it was made on, ADR-0041), and filing without a Bucket (it only ever takes what still waits in Review). Every other write is sent the moment it is made, so `keepalive` already covers it.
- **A Rule stated from a card too** (since issue 129; it was first kept out, because it names no version). The server takes each statement once, by the ID the card made for it: see below.
- **Sent again how**: by the same function its screen uses, in the same queue, in order, with the version written down for it: the one on the row the Parent was looking at, or, if this page's own earlier change to that Transaction had been answered by then, the version that answer gave (`carryVersions`; a page's memory of its own answers is gone with the page, and without this an Undo left behind its answered decision was refused as "changed on another screen"). Never a version read fresh from the server. The server already tells the cases apart (ADR-0041): a repeat of a change that did land (only its answer was lost) finds the Transaction one version on with its values and answers "saved"; a change made on a version that has since moved on is answered "changed elsewhere", dropped, and said with the usual message, once. It is never forced. A change that waited behind another to the same Transaction goes with the version the repeat of the first one answered.
- **What the Parent sees**: "Saved what was still waiting when you left." once, and the figures refetch. Nothing is drawn before the answer: the page shows what the server has until then.
- **No answer when sent again** (no connection): it stays for the next time the app opens, three times in all, then it is dropped and said: "Couldn’t save a change you made earlier, so it has been left out."
- **Not for ever**: one made more than seven days ago is dropped unsent when the app opens, and said once: "A change you made over a week ago was never saved, so it has been left out." Said rather than silent, because the Parent saw it on screen as done. A week-old decision is not what they would do on today's figures, and it bounds what a restored snapshot or a Start fresh can meet. No more than 100 are written down at once; one past that is sent as ever, only not kept.
- **A failure on the page the change was made on** is crossed off: the Parent was told and the screen put back, as before. Unless the page is going (`beforeunload`, `pagehide`): a request that fails then was cut off, not answered, and stays written down.
- **No storage** (private browsing, blocked, full, unreadable): nothing is written down and everything else works as it did.

No migration and no server change for the Transaction writes. The Rule's statement has both (migration 0077).

## A Rule stated from a card (issue 129)

A Rule has no version to be made on, and stating one is "replace the merchant's Rule and file what matches": sent again days later as it stood, it would have put back a Rule deleted since, or pointed the merchant's Rule back at the old Bucket over a newer choice by either Parent, and filed everything unassigned that matches. So it was sent once, and one still waiting when the page went was lost.

Now the server remembers each statement by the `ruleId` the card made (`rule_statements`, `stateRule` in `packages/db/src/rules.ts`), for the Parent who made it:

- **The same ID again** changes nothing and files nothing, and is answered with what the first one did (how many it filed, whether a snapshot was taken). It does not matter what happened to the Rule since: removed, it stays removed; pointed at another Bucket, it stays there.
- **An ID never seen, sent from the page it was made on**, is stated as ever: it replaces the merchant's Rule and files what matches.
- **An ID never seen, sent again by a later page** (`again`, up to a week after it was made): where the merchant has no Rule, it is made and files what matches, which is what the Parent asked for. Where the merchant has a Rule made since that files somewhere else, that one is the newer choice: it is left alone, the statement is dropped and said once ("Lego Store has a newer Rule, so the one you made earlier has been left out."). Where the Rule there already files into the same place, it is kept as it is (its For is not touched) and what matches is filed.
- A week old, it is dropped unsent and said, like every other change written down.

A statement is kept a month, well past the week a device keeps one. Statements are the Household's own rows: a Start fresh clears them and a snapshot carries them with its Rules.

Not chosen: **a version on each Rule**, as Transactions have. A statement that replaces "the merchant's Rule, whichever it is" has no single row whose version it could name when the merchant had no Rule, and a deleted Rule has no row left to hold one.

## Considered

- **Sending what waits as the page is hidden** (`pagehide`, `keepalive`). Phase 128a tried it; its spec stayed red and the cause was not found. It also has to guess the version each waiting change will be sent on, with no answer to go by, and a phone that drops a tab from memory fires nothing. Not done.
- **A "still saving" prompt on `beforeunload`.** Phones ignore it. Not added.
- **One request carrying the whole chain.** A new server function per combination, and still nothing for a page that goes before it is sent.
- **IndexedDB.** The entries are a few hundred bytes of JSON and must be written in the same tick as the tap; `localStorage` is synchronous.

## Consequences

- A Parent's own decisions sit on their device, readable by anyone with the unlocked device, until answered: normally well under a second. A device signed out with changes unsent keeps them until someone signs in there.
- Two tabs of one Parent: a tab opened while another still has changes unanswered sends those again too. The server takes each once (the repeat is recognised, or refused as changed elsewhere), so nothing is written twice, but the "changed on another screen" message can show where the other screen was their own tab.
- A Rule's statement and its filing are two steps. If the server stops between them, the statement is on record with nothing filed, and its repeat answers "filed none": the Rule is there and files the merchant from then on, and what was waiting stays in Review to be decided by hand.
- Filing without a Bucket names no version. Sent again, it files only what still waits in Review for that Parent, so one that landed, or that anyone decided since, is left alone; a card someone put back into Review in between (an Undo) is filed without a Bucket again. Nothing assigned is ever changed by it and no figure moves.
- A change the server refuses for another reason than the version (its Bucket has left the Plan since) is not told apart from no connection: it is tried on three openings, said each time, then dropped.
- Rows that are gone (deleted, a Start fresh, another Household's): an edit is answered "changed elsewhere" and dropped; a delete is answered as done. Nothing is created by a repeat.
- A navigation that starts and never happens (a download) counts as "the page is going" for ten seconds; a change that fails in that window stays written down although the Parent was told it was undone, and is sent when the app next opens.
