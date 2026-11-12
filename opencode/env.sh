#!/usr/bin/env sh

# OpenCode reads experimental feature flags when the process starts.
export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true

# context-mode cuts tool output over this many bytes down to a search pointer. Its 4 KB default
# also cut ordinary whole-file reads; 16 KB matches its own whole-file read limit.
export CTX_REPLACE_TRIGGER_BYTES=16384
