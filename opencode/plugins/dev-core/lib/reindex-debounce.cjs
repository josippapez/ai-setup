'use strict';

const fs = require('node:fs');

const DEBOUNCE_MS = 2000;

function claimReindex(lockPath, now = Date.now()) {
  try {
    const stat = fs.statSync(lockPath);
    if (now - stat.mtimeMs < DEBOUNCE_MS) return false;
    // O_NOFOLLOW: a link a cloned repo planted here must not be written through.
    fs.writeFileSync(lockPath, String(now), { flag: fs.constants.O_WRONLY | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW });
    return true;
  } catch {
    try {
      fs.writeFileSync(lockPath, String(now), { flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { claimReindex, DEBOUNCE_MS };
