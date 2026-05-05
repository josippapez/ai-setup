---
applyTo: '**'
name: file-safety
description: Portable file safety rules for secrets and tracked moves.
---

# File Safety

## Environment files

- Never read `.env` files directly, even during development or testing, unless the user explicitly instructs you to inspect a specific non-secret example file such as `.env.example`.
- Do not copy `.env` files into backups, generated artifacts, commits, or prompts.

## File moves

- When moving a file tracked by git, use `git mv <source> <dest>` instead of plain `mv`.
- If a tracked file was moved accidentally with `mv`, run `git add -A` so git can detect the rename.
- Never use destructive git commands such as hard resets or forced checkouts unless the user explicitly requests them.
