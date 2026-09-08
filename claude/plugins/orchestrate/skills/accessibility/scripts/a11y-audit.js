/**
 * Web accessibility audit harness.
 *
 * Injected into a running web app page (dev server or deployed) and run from the
 * chrome-devtools MCP. Two passes, and only the second is trusted for focus indicators.
 *
 *   __a11yAudit()      Screening pass. axe-core violations, tab order, accessible names, and a
 *                      programmatic focus probe. The focus probe OVER-REPORTS: it calls controls
 *                      unindicated that do paint under real keyboard focus, and it flags tablist
 *                      and radiogroup containers that merely delegate focus to a child.
 *   __a11yWalkStart()  Real-keyboard walk. Arms a focusin listener; then send real Tab keypresses,
 *   __a11yWalkRead()   one per control, and read the result in a single call. This is the oracle.
 *
 * Screen with the first, confirm every negative with the second.
 *
 * Usage from the browser console or an MCP evaluate call:
 *   await import('http://127.0.0.1:4399/a11y-audit.js'); // or inject as a <script>
 *   await window.__a11yAudit();          // screening
 *   window.__a11yWalkStart();            // then Tab for real, once per control
 *   window.__a11yWalkRead();             // then read
 *
 * axe-core is taken from `axe.min.js` next to this file on the same server — the plugin's own
 * pinned copy, so a run needs no network. If that is not there (the install hook has not run yet),
 * it falls back to the same version on the CDN.
 *
 * Two knobs, both set on window BEFORE this file loads:
 *   __A11Y_AXE_URL   force a specific axe-core URL, skipping both defaults.
 *   __A11Y_IGNORE    CSS selector for chrome that is not part of the audited product (dev
 *                    overlays, devtools panels). Matching elements and their descendants are
 *                    excluded from the tab sweep and the walk.
 *
 * The full loop is in the accessibility skill (SKILL.md, "Scanning a live page").
 */
(function () {
  // Keep in step with the axe-core pin in the plugin's package.json.
  const CDN_AXE = 'https://cdn.jsdelivr.net/npm/axe-core@4.13.0/axe.min.js';
  // currentScript is only readable while this IIFE first runs, which is now.
  const self = (document.currentScript && document.currentScript.src) || '';
  const LOCAL_AXE = self ? self.replace(/[^/]*$/, 'axe.min.js') : '';
  const AXE_URL = window.__A11Y_AXE_URL || LOCAL_AXE || CDN_AXE;
  const TAGS = [
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
    'best-practice',
  ];
  const TABBABLE =
    'a[href],button,input,select,textarea,summary,details,iframe,[tabindex],[contenteditable="true"],audio[controls],video[controls]';
  // TanStack Router/Query devtools are the overlay we hit most; override for anything else.
  const IGNORE =
    window.__A11Y_IGNORE ||
    '.tsqd-parent-container,[class*="tsqd-"],.TanStackRouterDevtools,[class*="tsrd-"]';

  const inject = (url) =>
    new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = res;
      s.onerror = () => rej(new Error('axe load failed from ' + url));
      document.head.appendChild(s);
    });

  let axeFrom = '';
  const loadAxe = () => {
    if (window.axe) {
      axeFrom = axeFrom || 'already on the page';
      return Promise.resolve();
    }
    return inject(AXE_URL)
      .then(() => {
        axeFrom = AXE_URL;
      })
      .catch((e) => {
        if (AXE_URL === CDN_AXE) throw e;
        return inject(CDN_AXE).then(() => {
          axeFrom = CDN_AXE + ' (local copy missing)';
        });
      });
  };

  const visible = (el) => {
    const s = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return (
      s.visibility !== 'hidden' &&
      s.display !== 'none' &&
      (b.width > 0 || b.height > 0)
    );
  };

  const nameOf = (el) =>
    (
      el.getAttribute('aria-label') ||
      el.getAttribute('alt') ||
      el.getAttribute('title') ||
      (el.innerText || '').trim().slice(0, 50) ||
      el.getAttribute('placeholder') ||
      ''
    ).replace(/\s+/g, ' ');

  const isDevtools = (el) =>
    !!el.closest(IGNORE) || /tanstack|devtools/i.test(nameOf(el));

  /**
   * Is this computed outline/box-shadow actually painting something a sighted user can see?
   * A ring whose every layer is fully transparent counts as no indicator.
   */
  const paints = (outlineStyle, outlineWidth, outlineColor, boxShadow) => {
    const opaque = (c) =>
      !!c && !/rgba\([^)]*,\s*0\s*\)/.test(c) && c !== 'transparent';
    const hasOutline =
      outlineStyle !== 'none' &&
      parseFloat(outlineWidth) > 0 &&
      opaque(outlineColor);
    const hasShadow =
      boxShadow !== 'none' &&
      (boxShadow.match(/rgba?\([^)]*\)/g) || []).some(opaque);
    return hasOutline || hasShadow;
  };

  /** Wait out any focus-ring transition on this element, capped so a long transition cannot hang the sweep. */
  const settle = (el) => {
    const t = getComputedStyle(el);
    const longest = (t.transitionDuration + ',' + t.transitionDelay)
      .split(',')
      .map((v) => parseFloat(v) * (v.includes('ms') ? 1 : 1000) || 0)
      .reduce((a, b) => Math.max(a, b), 0);
    return new Promise((r) => setTimeout(r, Math.min(longest + 60, 600)));
  };

  /**
   * The element plus the two nearest ancestors. A visually-hidden control (a 1x1 file input in a
   * dropzone label) is legitimately indicated by a :focus-within ring on its wrapper, so a check
   * that only looks at the control itself reports a false "no focus indicator".
   */
  const focusChain = (el) => {
    const chain = [el];
    let p = el.parentElement;
    for (let i = 0; i < 2 && p && p !== document.body; i++, p = p.parentElement)
      chain.push(p);
    return chain;
  };

  const namedBy = (el) => {
    if (el.getAttribute('aria-label')) return 'aria-label';
    if (el.getAttribute('aria-labelledby')) return 'aria-labelledby';
    if (el.labels && el.labels.length) return 'label';
    if ((el.innerText || '').trim()) return 'text';
    if (el.getAttribute('title')) return 'title';
    if (el.getAttribute('alt')) return 'alt';
    return 'NONE';
  };

  const focusSnapshot = (el) => {
    const s = getComputedStyle(el);
    const outline =
      s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor;
    return {
      on: el.tagName.toLowerCase(),
      outline,
      boxShadow: s.boxShadow,
      key: outline + ' | ' + s.boxShadow + ' | ' + s.borderColor,
      paints: paints(
        s.outlineStyle,
        s.outlineWidth,
        s.outlineColor,
        s.boxShadow,
      ),
    };
  };

  /**
   * Real-keyboard focus walk. Programmatic .focus() is not a trustworthy oracle for focus
   * indicators: it reports paints correctly for most controls but produces false negatives for
   * some (a header user-menu button among them, verified by hand). This records the computed
   * style at each genuine focus change instead.
   *
   * Usage: call startWalk(), press Tab for real as many times as there are controls, call
   * readWalk() once to collect. Focus styles here are what a keyboard user actually gets.
   */
  window.__a11yWalkStart = () => {
    window.__a11yWalk = [];
    if (window.__a11yWalkHandler)
      document.removeEventListener('focusin', window.__a11yWalkHandler, true);
    window.__a11yWalkHandler = (e) => {
      const el = e.target;
      if (!el || el === document.body || isDevtools(el)) return;
      setTimeout(() => {
        const snaps = focusChain(el).map(focusSnapshot);
        const painted = snaps.find((snap) => snap.paints);
        window.__a11yWalk.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          testid: el.getAttribute('data-testid') || '',
          name: nameOf(el),
          namedBy: namedBy(el),
          focusVisible: el.matches(':focus-visible'),
          focusIndicator: painted
            ? painted.on + ': ' + painted.outline + ' | ' + painted.boxShadow
            : 'NONE',
        });
      }, 350);
    };
    document.addEventListener('focusin', window.__a11yWalkHandler, true);
    if (document.activeElement && document.activeElement.blur)
      document.activeElement.blur();
    return 'walk armed';
  };

  window.__a11yWalkRead = () => ({
    url: location.href,
    steps: window.__a11yWalk || [],
    noFocusIndicator: (window.__a11yWalk || [])
      .filter((s) => s.focusIndicator === 'NONE')
      .map((s) => s.tag + ':' + (s.testid || s.name)),
  });

  window.__a11yAudit = async function (opts) {
    const o = opts || {};
    await loadAxe();
    const result = await window.axe.run(o.context || document, {
      runOnly: { type: 'tag', values: TAGS },
    });

    const tabbables = [...document.querySelectorAll(TABBABLE)].filter(
      (el) =>
        visible(el) &&
        !el.disabled &&
        el.getAttribute('aria-hidden') !== 'true' &&
        el.tabIndex >= 0 &&
        !isDevtools(el),
    );

    const restore = document.activeElement;
    const tabOrder = [];
    for (const el of tabbables) {
      const chain = focusChain(el);
      const before = chain.map(focusSnapshot);
      el.focus();
      // Controls carrying `transition-all` animate their focus ring in. A synchronous read
      // catches frame 0 and reports a fully transparent ring, so wait for the transition.
      await settle(el);
      let after = chain.map(focusSnapshot);
      let painted = after.find(
        (snap, i) => snap.paints && snap.key !== before[i].key,
      );
      // Retry once on a negative. The first control focused on a page sometimes still reads its
      // pre-focus ring, and a false "no focus indicator" is the expensive direction to get wrong.
      if (!painted) {
        await new Promise((r) => setTimeout(r, 250));
        after = chain.map(focusSnapshot);
        painted = after.find(
          (snap, i) => snap.paints && snap.key !== before[i].key,
        );
      }
      tabOrder.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        type: el.getAttribute('type') || '',
        tabIndex: el.tabIndex,
        name: nameOf(el),
        namedBy: namedBy(el),
        focusVisibleMatched: el.matches(':focus-visible'),
        focusIndicator: painted
          ? painted.on + ': ' + painted.outline + ' | ' + painted.boxShadow
          : 'NONE',
        focusChanged: after.some((snap, i) => snap.key !== before[i].key),
      });
    }
    if (restore && restore.focus) restore.focus();

    const lm = {};
    for (const s of [
      'header',
      'nav',
      'main',
      'footer',
      'aside',
      'form',
      '[role="banner"]',
      '[role="navigation"]',
      '[role="main"]',
      '[role="contentinfo"]',
      '[role="complementary"]',
      '[role="search"]',
      '[role="dialog"]',
      '[role="alert"]',
      '[aria-live]',
    ])
      lm[s] = document.querySelectorAll(s).length;

    return {
      url: location.href,
      axeVersion: window.axe.version,
      axeFrom,
      title: document.title,
      lang: document.documentElement.lang || '(missing)',
      violations: result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        wcag: v.tags.filter((t) => /^wcag\d/.test(t)),
        n: v.nodes.length,
        targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')),
      })),
      incomplete: result.incomplete.map((v) => ({
        id: v.id,
        n: v.nodes.length,
        targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      })),
      passCount: result.passes.length,
      headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(
        (h) => h.tagName + ': ' + (h.innerText || '').trim().slice(0, 60),
      ),
      landmarks: Object.fromEntries(
        Object.entries(lm).filter(([, v]) => v > 0),
      ),
      tabbableCount: tabbables.length,
      tabOrder,
      positiveTabIndex: tabOrder.filter((k) => k.tabIndex > 0).length,
      unnamedControls: tabOrder
        .filter((k) => k.namedBy === 'NONE')
        .map((k) => k.tag + (k.type ? '[' + k.type + ']' : '')),
      noFocusIndicator: tabOrder
        .filter((k) => k.focusIndicator === 'NONE')
        .map((k) => k.tag + ':' + k.name),
    };
  };
})();
