# Linked cards are Perk Sources by themselves; pages are read with a real browser when needed

Builds on ADR-0015 (Perks are read from fetched pages, in a Workflow, and must quote them). Asked for in #96: "any linked credit card should appear in the perks… always suggest the top tier perks a card offers… you may need the browser from cloudflare".

## Every linked card is a Perk Source

Each credit-card Account that came from a Bank Connection gets a confirmed Perk Source of its own, without a Parent adding it (`ensureCardPerkSources`). It is made when the Perks are loaded and by the nightly job, and is bound to its Account by its fingerprint (`household|account:<Account ID>`), so there is one per Account, no new column, and one a Parent removed isn't made again. A card that already has a Perk Source (told by its name, as before) keeps it.

Banks often name a card only "CREDIT CARD". Plaid's `official_name` isn't stored today, so the product is told from the Account's name alone, against a short list of each issuer's common cards (`packages/domain/src/card-issuers.ts`: seven issuers, a dozen names each at most). When the name doesn't tell, the card's section says so and asks one question, "Which Chase card is this?", with that issuer's list and "Another card…". Nothing is guessed. The list's benefits pages are unverified starting points: a Perk still rests only on what the page fetched at research time says.

## A real browser, only as a fallback, and bounded

Research still tries a plain `fetch` first. When the answer is refused (401, 403 and the like), has next to no text, or is a short "turn on JavaScript / are you human" page (`needsBrowser`), the page is rendered once with Cloudflare Browser Rendering: the `content` quick action on the Worker's `BROWSER` binding (`env.BROWSER.quickAction`), which needs no API token and no extra package. Bounds:

- Only sites Noodle knows are rendered: the issuers' own domains and the catalog's products. An address a Parent pastes is only ever fetched plainly.
- One page per Perk Source per research run; a 25 second limit; the text handed to the model capped at 48,000 characters as before.
- robots.txt is read first, and a page it keeps out isn't rendered.
- A page that redirects to another site isn't read.
- The page's text is kept in D1 with its date (`perk_pages`, by address; public pages, nothing of a Household's) and reused for 7 days, so a Parent picking a plan tier, or pressing "Check again", doesn't fetch or render again. The monthly re-check always reads anew.
- The nightly re-check researches at most 20 Perk Sources; the rest are still due the next night.

Costs, honestly: Browser Rendering is billed by browser time (beyond the plan's included hours) and has a small concurrency limit; a render here is one page for at most 25 seconds, at most about 20 a night plus what Parents start by hand. Workers AI is billed by tokens: one read of at most about 12,000 tokens of page per research run, same as before. For one Household with a few cards this is a few renders a month.

Without the binding (tests, or an account without Browser Rendering) research is exactly as before: a page that can't be read asks the Parent for a link.

## Top perks first, still only what the page says

The model now also lists what a card earns more on (kind `earn`: "4X points at restaurants"), with the page's own words. The quote rule of ADR-0015 holds for every Perk, and two figures are checked by plain code: a dollar value must be the very figure in the quote, and an earning Perk is dropped unless its quote states a rate (`earnRate`). The page orders a card's Perks by what each is worth in a year, then by sort (credits, earning more, travel, protection, memberships), shows the top five and folds the rest ("Show all N perks"). The sort is told by plain code from the Perk's own name (`perkCategory`), not stored. Earning Perks never make an Overlap.

## "Worth using" is computed, not stored

For each card, plain code (`worthUsing` in `@noodle/domain`) sets its Perks against the Transactions the Viewer may see: monthly credits that went unused in the months since the card's first charge (up to twelve), yearly credits unused with a full year of charges, charges on other Accounts in the last 90 days that a Perk on this card pays back or includes, and the kinds of purchases of the last 90 days (told by statement words, from $50 a month) that the card earns more on. Each line carries the charges it rests on. It is worked out each time the Perks load, from rows already read for that page, so nothing is stored and nothing can go stale; the model isn't asked. It only ever speaks of a card the Household has, never of opening one.

Considered: `@cloudflare/puppeteer` on the same binding (a dependency and a session to manage, for one page's HTML), the Browser Rendering REST API (needs an API token as a secret), asking the model for a card's benefits address (kept out: an invented address is worse than asking the Parent), storing Plaid's `official_name` (worth doing; needs a column and the bank code, proposed to follow), and classifying merchants with the model for the kinds of purchases (statement words first; to follow if they prove too coarse).
