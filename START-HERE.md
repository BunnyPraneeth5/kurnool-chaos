# Start here (for Bunny)

This folder has everything Claude Code needs to build Kurnool Chaos. You can delete this file once the build is running.

## What's in here
| File | What it is |
|---|---|
| `CLAUDE.md` | Rules file. Claude Code reads it automatically every session. |
| `docs/PRD.md` | What v1 is and is not |
| `docs/ARCHITECTURE.md` | Stack, data shapes, multiplayer design, database schema |
| `docs/MAP-SPEC.md` | Map area, landmarks with Telugu names, airport, roads, buildings |
| `TASKS.md` | 23 tasks in 6 phases, each with acceptance checks |
| `PROGRESS.md` | Session log. Claude Code updates it at the end of every session. |
| `DECISIONS.md` | Every decision we made and why |
| `prompts/PROMPTS.md` | Ready prompts to paste into Claude Code |
| `reference/port-meridian-demo.html` | The original single-file game. Open it in a browser to see where we started. |

## Before you start (5 min)
1. **Node.js 20 or newer.** Run `node -v` in a terminal.
2. **Git.** Run `git --version`.
3. **GitHub CLI (optional).** Run `gh --version`. If it's installed and logged in, Claude Code can create the repo for you. If not, you make an empty repo called `kurnool-chaos` on github.com when it asks.
4. **Claude Code.** Run `claude --version`.
5. **Verify the Telugu names** in `docs/MAP-SPEC.md` (landmark table). Fix any spelling directly in the file.

## Session 1
1. Open a terminal in this folder:
   `cd C:\Users\karup\projects\Games\kurnool-chaos`
2. Run `claude`.
3. Optional: pick the model with `/model`. Use the strongest one you have for session 1 (the map pipeline is the hardest part). A lighter model is fine later for small fixes and tuning.
4. Paste **prompt 1 (Kickoff)** from `prompts/PROMPTS.md`.
5. It will give you a critique list. Approve or reject each point. Then paste **prompt 3 (Refine)** with the numbers you approved.
6. Paste **prompt 4 (Start a work session)**. It starts task 1.1.
7. When a task is done and you're happy, paste **prompt 5**. Repeat.
8. When you stop for the day, paste **prompt 6 (End a session)**. Don't skip this. It's what lets the next session pick up cleanly.

## Every session after that
1. `cd` into the folder, run `claude`
2. Paste **prompt 4**
3. Loop prompt 5 until you stop
4. Paste **prompt 6** before closing

## Testing on your phone while building
- Claude Code runs `npm run dev -- --host`. The terminal shows a "Network" address like `http://192.168.x.x:5173`.
- Open that on your phone. Phone and laptop must be on the same Wi-Fi.
- If Windows asks about firewall access for Node, allow it on private networks.

## Accounts you'll need during the build
- **Supabase (task 5.1):** free project called `kurnool-chaos` at supabase.com. You'll copy the project URL and the publishable key into `.env.local` and into Vercel. Claude Code tells you exactly where.
- **Vercel (task 2.6):** import the GitHub repo at vercel.com, framework preset Vite, deploy. Then add the two Supabase env vars at task 5.1.

## The "Bunny checks"
Some tasks stop and wait for you:
- **1.3:** confirm the map area and landmark positions look right
- **2.6:** drive around the live link and report streets that look wrong
- **3.2:** check Telugu spellings on the signboards
- **6.2:** play with friends and collect bugs

Use prompts 7 (bug report), 8 (street looks wrong) and 9 (tune vehicle feel) for feedback. Specific reports get fixed faster than "it feels off".

## If it goes sideways
- Claude Code starts changing random files or going in circles: paste **prompt 10**.
- Something broke after a big change: `git log` and `git checkout <file>` to roll back, or ask Claude Code to revert the last commit.
- A mistake keeps repeating: tell Claude Code to add it to the Gotchas section in `CLAUDE.md`.
