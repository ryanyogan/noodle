# Noodle intro video

The one-minute intro (#54), written as code with [Remotion](https://www.remotion.dev/) so it can be
made again whenever the app's look changes. It is 60 seconds at 30 frames a second, in two cuts
from the same scenes:

| Cut | Composition | Size | Footage | File |
|---|---|---|---|---|
| Wide (16:9) | `Intro` | 1920×1080 | desktop stills | `out/intro.mp4` |
| Vertical (9:16) | `IntroVertical` | 1080×1920 | phone stills | `out/intro-vertical.mp4` |

Beside them: `out/poster.png` (a frame of the wide cut's opening), `out/intro.vtt` (captions) and
`script.md` (the narration, for a voiceover to be recorded later). There is no sound yet.

## Making it again

**Normally GitHub Actions does it.** Run the `video.yml` workflow from the Actions tab: it captures
the footage from a seeded local app and renders both cuts. Nothing renders on a push; CI only
typechecks and tests this package.

To do the same on your own machine (it starts a browser and takes a few minutes), from the repo root:

```sh
bun run video
```

That is these two steps, which also run on their own:

```sh
bun run --cwd apps/web video:capture   # the stills, into apps/video/public/footage/
bun run --cwd apps/video render        # both cuts, the poster and the captions, into apps/video/out/
```

`render` first checks that every still is there (`bun run footage:check`) and stops with the list
of missing ones if not. It then runs `captions`, `render:wide`, `render:vertical` and
`render:poster`, which can each be run alone. The first render downloads Remotion's own headless
browser (`bunx remotion browser ensure` does only that); installing the repo downloads no browser.

Both cuts are H.264 at CRF 22 with no audio track. The wide cut must stay under about 15 MB; if it
doesn't, raise `--crf` in `package.json` (a higher number is a smaller file).

Other commands, none of which start a browser:

```sh
bun run --cwd apps/video typecheck
bun run --cwd apps/video test       # the timings, the captions and the tokens
bun run --cwd apps/video captions   # out/intro.vtt and script.md, from src/story.ts
```

## Where things are

- `src/story.ts`: the eight scenes, when each one runs, which stills it shows, its captions and its
  narration. **Change words and timings here**, then run `bun run captions`; a test fails if
  `script.md` is out of date.
- `src/footage.ts`: the list of stills, and for each one where its subject is (the camera moves in
  on it and the highlight ring is drawn round it). These rectangles are fractions of the still's
  width and height. They were guessed before any footage existed and are marked
  `// tune after first render`.
- `src/tokens.ts`: the app's light colours, copied from `packages/ui/src/styles/globals.css`. A test
  fails when one no longer matches.
- `src/parts.tsx`: the font, the layout of the frame, the logo and the caption line.
- `src/scenes/`: the Hook and End card, the Plan's waterfall, and the shots from the app.

The Hook, the Plan's waterfall, the Bucket bar and the End card are drawn in code. They are simple
copies of the app's parts made from the same tokens, not `@noodle/ui` components: those are styled
with Tailwind v4 classes, which Remotion's bundler (webpack) doesn't build. The font is Geist, the
app's typeface, loaded with `@remotion/google-fonts`.

## The footage

The video is cut from stills of the app; nothing is recorded by hand. The capture seeds a local app
(with the stub AI and a stubbed Plaid, never real data) and writes PNGs in the light theme to
`public/footage/`, which git ignores:

- `<name>-desktop.png`: a 1440×900 window at device scale 2 (2880×1800 px)
- `<name>-phone.png`: a 393×852 window at device scale 3 (1179×2556 px)

| Name | Shows |
|---|---|
| `setup-hello` | The get-started wizard's Hello step (captured, not used in this version) |
| `plan-overview` | The Plan |
| `month` | This Month, with Free to Spend |
| `month-bucket` | This Month, with a Bucket's bar and Pace in view |
| `accounts-bank` | Accounts, with a connected bank |
| `transactions` | Transactions |
| `review` | Review |
| `review-rule` | Review, with the "Always file … here" choice showing |
| `quick-add` | Quick Add, open |
| `import-statement` | Uploading a statement |
| `goals` | Goals |
| `goal` | One Goal |
| `explore-afford` | Explore's "Can we afford it?" |
| `check-in` | The Check-in |
| `close-month` | Closing a month |
| `household-invite` | Inviting the other Parent |

A still that is missing stops the render; it never renders a blank frame.

## Hosting

The files are **static files of the app**, in `apps/web/public/intro/`, served from the app's own
address (`/intro/intro.mp4` and so on). They are not in R2: Workers serves a static file of up to
25 MiB, and each cut must stay under about 15 MB. The app's service worker caches nothing, so it
doesn't keep a copy either.

After a render, copy the files across and commit them:

```sh
mkdir -p apps/web/public/intro
cp apps/video/out/intro.mp4 apps/video/out/intro-vertical.mp4 \
   apps/video/out/poster.png apps/video/out/intro.vtt apps/web/public/intro/
ls -l apps/web/public/intro   # every file must be under 25 MiB (26,214,400 bytes)
```

| File | What it is |
|---|---|
| `intro.mp4` | the wide cut, played on desktops, tablets and phones held sideways |
| `intro-vertical.mp4` | the vertical cut, played on a phone held upright |
| `poster.png` | the picture shown before play |
| `poster-vertical.png` | the same for the vertical cut. Optional: `render` doesn't make it yet |
| `intro.vtt` | the captions |

The app's side is `apps/web/src/intro-video-files.ts` (the paths and two switches) and
`apps/web/src/components/intro-video.tsx` (the player). The first time the files go in:

1. Set `INTRO_VIDEO_READY` to `true` in the same commit as the files. Until then the get-started
   wizard says the video is coming soon and sign-in shows no button.
2. If there is a `poster-vertical.png`, set `INTRO_VERTICAL_POSTER_READY` to `true` too. Without
   it the phone shows `poster.png` inside the tall frame.
3. Redraw the comparison pictures of sign-in and of the wizard's Hello step, which both gain the
   button (`auth-shots.spec.ts` and `setup-shots.spec.ts` in `apps/web/e2e/`).

A later render only replaces the files: same names, nothing else to change. Browsers may keep the
old film for a while, since the names don't change.

The player fetches nothing until a Parent opens it, and no film until they press play
(`preload="none"`), so sign-in loads as fast as before.

## Remotion's licence

Remotion is not MIT. It is free for individuals, non-profits and companies of up to three people;
larger companies need a paid company licence. Noodle is one family's project, so the free licence
applies. If that changes, read the terms first: <https://github.com/remotion-dev/remotion/blob/main/LICENSE.md>
(summary at <https://www.remotion.dev/docs/license>).
