# CLAUDE.md

Claude Code entry for this repo. Follow [AGENTS.md](./AGENTS.md) as the project instructions.

## Runtime

Use Bun, not Node, npm, pnpm, yarn, or vite.

- `bun <file>` instead of `node` / `ts-node`
- `bun test` instead of jest / vitest
- `bun install` / `bun run <script>` / `bunx <pkg>`
- This Worker is configured through Wrangler (`.dev.vars`), not `Bun.serve()` or dotenv

Do not add express, dotenv, jest, or vite.
