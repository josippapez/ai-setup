---
name: better-design
description: "Library of 39 vetted web design skills: GSAP and ScrollTrigger animation, scroll storytelling, word-by-word text reveals, Three.js and WebGL scenes, UI polish (hover and press states, shadows, borders, blur, spacing, typography), UI and design reviews (Vercel interface guidelines, generic AI-look audits) and animation performance. Use before writing, changing or reviewing frontend UI, motion, a landing page or a 3D effect."
---

# better-design

The 39 skills below are not listed one by one, to keep them out of every session's context. Pick from the index and read them.

1. Pick the one to three entries that fit the task. Prefer the most specific one: `staggered-word-reveal` over `gsap` for a headline reveal.
2. Read each pick's `${CLAUDE_PLUGIN_ROOT}/library/<name>/SKILL.md` with the Read tool, passing `limit: 3000` so a long file comes back whole in one call.
3. Follow it as if it had been invoked as a skill. Files it links to, such as `references/...`, sit next to its `SKILL.md`.

## Index

### Motion and GSAP

- `gsap-core`: official GSAP core API: to/from, easing, duration, stagger, matchMedia, reduced motion.
- `gsap-timeline`: official, sequencing with timelines and the position parameter.
- `gsap-scrolltrigger`: official ScrollTrigger: scroll-linked animation, pinning, scrub, parallax.
- `gsap-react`: official GSAP in React or Next.js: useGSAP, refs, context, cleanup.
- `gsap-performance`: official, smooth 60fps GSAP: transforms, batching, will-change, jank.
- `gsap`: short practical GSAP guide with common pitfalls (HTML, CSS, JS, React).
- `animation-systems`: product-grade motion like Stripe or Linear: principles, easing and duration defaults, choreography.
- `apple-design`: Apple-style fluid, physical motion: springs, gestures, drag, sheets, interruptible transitions.
- `find-animation-opportunities`: read-only scan for places that should animate, with exact values.
- `optimize-web-animations`: profile and fix slow pages and animations, rAF loops, memory leaks.

### Scroll and text effects

- `cinematic-scroll-storytelling`: scroll-driven landing pages with Lenis, ScrollTrigger, sticky stacks, parallax.
- `cinematic-gsap-lenis-motion-system`: premium editorial motion system with GSAP, ScrollTrigger and Lenis.
- `gsap-scrolltrigger-storytelling`: sticky product storytelling with progressive UI reveals.
- `staggered-word-reveal`: headline words fade and rise one by one when they enter the viewport.
- `masked-reveal`: words reveal through an overflow mask on scroll.
- `scroll-scrubbed-word-reveal`: words reveal in step with scroll progress, links and wrapping kept.

### 3D and WebGL

- `threejs`: interactive Three.js scenes: renderer, camera, lights, GLTF, controls, performance.
- `threejs-geometry`: built-in and custom geometry, BufferGeometry, instancing.
- `threejs-materials`: PBR and other materials, textures, material performance.
- `threejs-lighting`: light types, shadows, environment lighting.
- `threejs-shaders`: GLSL, ShaderMaterial, uniforms, custom effects.
- `globe-particles`: glowing 3D particle globe with an orbital ring.
- `webgl-landing-steering`: steer a WebGL-heavy landing page toward a visual goal without losing clarity or speed.

### Page and layout direction

- `build-awwwards-quality-sites`: art-direct distinctive, motion-rich marketing and portfolio sites.
- `editorial-portfolio-chapters`: studio and portfolio sites where project work leads the story.
- `image-first-grid-layout`: image-led grid with full-bleed photos and guide lines.
- `container-lines`: vertical container guide lines with small corner squares.
- `atmosphere-background`: dark atmospheric background with light folds and a glow bloom.

### Polish and details

- `make-interfaces-feel-better`: polish components: hover and press states, shadows, borders, type, icons, micro-interactions.
- `emil-design-eng`: Emil Kowalski's UI polish and animation decisions.
- `baseline-ui`: fast cleanup pass for spacing, hierarchy and typography.
- `beautiful-shadows`: layered Tailwind shadow utilities for cards, panels and popovers.
- `css-border-gradient`: subtle gradient borders for cards, pricing panels and buttons.
- `progressive-blur`: stepped backdrop-filter blur fading from an edge.

### Reviews and audits

- `web-interface-guidelines`: review UI code against Vercel's web interface guidelines.
- `improve-ui`: read-only audit of a product surface that writes fix plans for another agent.
- `audit-ai-design-slop`: evidence-backed review for generic AI-generated design and UI defects.
- `no-ai-design-slop`: avoid generic AI-generated design while building or revising.
- `stitched-full-page-capture`: reliable full-page screenshots of lazy-loaded or scroll-animated pages.

## Overlaps

- `gsap` and `gsap-core` both cover GSAP basics. `gsap-core` has the fuller API detail.
- `optimize-web-animations` profiles a whole page. `gsap-performance` is GSAP only.
- `audit-ai-design-slop` reviews, `no-ai-design-slop` prevents. They share a `REFERENCES.md`.
