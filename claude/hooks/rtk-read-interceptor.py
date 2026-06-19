#!/usr/bin/env python3
"""PreToolUse hook: intercept Read tool calls and pipe through rtk read for token savings."""
import sys
import json
import subprocess
import os

CODE_EXT = {
    '.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cjs', '.mcts',
    '.json', '.jsonc', '.md', '.yaml', '.yml', '.css', '.html',
    '.py', '.sh', '.bash', '.toml', '.xml', '.mdx',
}

def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get('tool_name') != 'Read':
        sys.exit(0)

    inp = data.get('tool_input', {})
    file_path = inp.get('file_path', '')
    if not file_path:
        sys.exit(0)

    _, ext = os.path.splitext(file_path)
    if ext.lower() not in CODE_EXT:
        sys.exit(0)  # Let non-code files (PDFs, images) use native Read

    if not os.path.isfile(file_path):
        sys.exit(0)

    # Only intercept when no explicit offset/limit requested — those targeted reads
    # are intentional and should not be filtered.
    if inp.get('offset') or inp.get('limit'):
        sys.exit(0)

    try:
        result = subprocess.run(
            ['rtk', 'read', file_path],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0 and result.stdout.strip():
            output = {
                'hookSpecificOutput': {
                    'hookEventName': 'PreToolUse',
                    'decision': 'block',
                    'permissionDecisionReason': (
                        f'[rtk read: {os.path.basename(file_path)}]\n'
                        + result.stdout
                    )
                }
            }
            print(json.dumps(output))
            sys.exit(0)
    except Exception:
        pass

    # Fallback: allow Read to run normally
    sys.exit(0)

main()
