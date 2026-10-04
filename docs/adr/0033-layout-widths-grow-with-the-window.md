# The page's widths grow with the window, and related sections sit side by side

Status: proposed (2026-10-03, #73, phase 73L; the Parent approves before it is rolled out to every page)

## Context

ADR-0024 gave every page one of three layouts and four fixed sizes. On a 1920 px screen the shell still capped the page at 1200 px, the rail at 360 px and the list pane at 360 px, so This Month, Accounts and Goals were a narrow strip with a wide empty margin on the right, and every section was one long column. The Parent: "pretty much all of the desktop UIs feel really crammed and not taking advantage of the area", with Reports (the wide 1440 px cap, cards in a grid) as the example of space well used.

## Decision

- **The cap is a token that grows**: `--shell-max` is 1200 px below 1440 px, 1440 px from 1440 px and 1680 px from 1920 px. A `wide` route (Reports, Explore) has `--shell-max-wide`, 1440 px and 1800 px from 1920. Why these: at 1440 the space beside the sidebar (about 1180 px) is already under the old cap, so 1440 only stops the cap from binding there; at 1920 a 1680 px cap leaves about 1600 px of content with a margin on each side, near the line length where a two-column main is still easy to scan, and Reports stays a little wider than the rest as the one dashboard.
- **The rail and the list pane widen too**: rail 320 / 360 (≥1280) / 380 (≥1440) / 440 (≥1920); list pane 360 / 400 (≥1440) / 460 (≥1920). Steps at the same breakpoints as the cap, not `clamp()` on the viewport, so a column's width is one of a few known numbers and screenshots and alignment checks stay stable.
- **SectionGrid** puts related sections side by side: one column, two from 1280 px (xl), three from 1680 px where a page opts in (`columns={3}`). Each cell starts with its heading, so the headings of a row share a top.
- **DetailColumns** gives a picked item's page two columns once the detail pane itself is 48 rem wide (a container query on the pane, not the window), since the pane's width depends on the list beside it.
- **Column tops line up heading to heading, and cards line up card to card.** Nothing sits between a heading and its card in one column that the other column lacks; This Month's bars' key moved under the Buckets list for that reason. One "?" per section heading; other help goes into it, a Term link, or under the card.

## Consequences

- At 1920 the pages fill about 40 % more width; at 1440 the rail and list pane are 20–40 px wider.
- This Month's main splits into two stacks from 1680 px (was 1920) now that the cap allows it.
- Not yet done in this phase: Accounts' Bank Connections rows and status grid, Goals' card grid and a Goal's page using DetailColumns, and the Cover row's own "?" on This Month. The rollout to the other pages follows the Parent's approval.
