# better-design

39 vendored web design, motion, and 3D skills. Nothing here is written by this repo: every
`skills/<name>/` folder is a verbatim copy of an upstream SKILL.md (plus its markdown references),
pinned by commit and sha256 in `skills-lock.json`.

The starting set is the 25 skills used in `dj-blog`. The additions are cross-cutting picks from
[aura.build/skills](https://www.aura.build/skills) — things that apply to any UI work rather than
one visual effect: Vercel's interface guidelines, Emil Kowalski's design-engineering set, ibelick's
UI review skills, GreenSock's official GSAP skills, and MengTo's shadow and gradient-border skills.

## Sources

| Repo | Skills | Names |
| --- | --- | --- |
| [MengTo/Skills](https://github.com/MengTo/Skills) | 23 | `animation-systems`, `atmosphere-background`, `audit-ai-design-slop`, `beautiful-shadows`, `build-awwwards-quality-sites`, `cinematic-gsap-lenis-motion-system`, `cinematic-scroll-storytelling`, `container-lines`, `css-border-gradient`, `editorial-portfolio-chapters`, `globe-particles`, `gsap`, `gsap-scrolltrigger-storytelling`, `image-first-grid-layout`, `masked-reveal`, `no-ai-design-slop`, `optimize-web-animations`, `progressive-blur`, `scroll-scrubbed-word-reveal`, `staggered-word-reveal`, `stitched-full-page-capture`, `threejs`, `webgl-landing-steering` |
| [greensock/gsap-skills](https://github.com/greensock/gsap-skills) | 5 | `gsap-core`, `gsap-performance`, `gsap-react`, `gsap-scrolltrigger`, `gsap-timeline` |
| [CloudAI-X/threejs-skills](https://github.com/CloudAI-X/threejs-skills) | 4 | `threejs-geometry`, `threejs-lighting`, `threejs-materials`, `threejs-shaders` |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | 3 | `apple-design`, `emil-design-eng`, `find-animation-opportunities` |
| [ibelick/ui-skills](https://github.com/ibelick/ui-skills) | 2 | `baseline-ui`, `improve-ui` |
| [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) | 1 | `make-interfaces-feel-better` |
| [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) | 1 | `web-interface-guidelines` |

## Overlaps to know about

- `gsap` (MengTo, a short pragmatic guide) and `gsap-core` (GreenSock, official and far longer) both
  answer "how do I animate with GSAP". Either is fine; the official set wins on API detail.
- `optimize-web-animations` (MengTo) profiles a whole page; `gsap-performance` is GSAP-specific.
- `audit-ai-design-slop` reviews, `no-ai-design-slop` prevents. They share a REFERENCES.md.
- `frontend-design@claude-plugins-official` is already enabled globally, so Anthropic's
  `frontend-design` skill is deliberately not vendored here.

## Updating

`skills-lock.json` is both the manifest and the lock. Each entry names the upstream repo, ref, and
directory; the sync script fills in the resolved `commit` and a sha256 per vendored file.

```bash
node scripts/sync-skills.mjs            # re-fetch everything, rewrite both trees, update the lock
node scripts/sync-skills.mjs --check    # report drift only, exit 1 if anything moved
```

Both trees means `skills/` here and the OpenCode mirror at `opencode/skills/`, written from the same
fetch. OpenCode reads the same `name` / `description` / `license` frontmatter, so the files are
byte-identical and there is nothing to port; `--check` fails if either tree stops matching. The
other skills under `opencode/skills/` are hand-ported and have drifted from their Claude sources —
these 39 are kept out of that by construction.

Add a skill by appending an entry (repo, ref, dir) and running the script. It vendors markdown only:
upstream folders also carry `demo/` pages with multi-megabyte images and `agents/openai.yaml` files
for other harnesses, none of which Claude Code reads.

The anonymous GitHub API allows 60 requests/hour and a full sync needs two per repo. Set
`GITHUB_TOKEN` (`GITHUB_TOKEN="$(gh auth token)"`) if you hit the cap.

## Cost

39 skill descriptions is roughly 12.7 KB of frontmatter, about 3.2k tokens in every session's skill
listing. Disable the plugin in `settings.json` when you are not doing UI work.
