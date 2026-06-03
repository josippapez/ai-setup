'use strict';

const path = require('node:path');

function createContext(rootArg) {
  const root = path.resolve(rootArg || process.cwd());
  return {
    root,
    maxFileSizeBytes: 512 * 1024,
    dependencyIndex: null,
  };
}

module.exports = { createContext };
