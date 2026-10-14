# Moving HashirHub to another computer

Use this when you want to work on HashirHub from a different computer (for example, moving from the laptop to the PC). It takes about 30 minutes, most of it waiting for installs.

**Your clients are not affected.** The live site, the database and all their data are online. This only moves the place where the app is developed.

## What lives where

| Thing | Where it lives | Moves by |
|---|---|---|
| The code and its history | GitHub: `invento1/inventory-app` | downloading it again (Step 3) |
| The database, users, the invite function | Supabase: project `inventory-app` | nothing to do |
| The live site | GitHub Pages | nothing to do |
| The keep-alive job, deploy job and their two secrets | GitHub | nothing to do |
| `.env` (two Supabase settings) | **old computer only** | copy it (Step 1) |
| The design reference image | **old computer only** | copy it (Step 1) |
| The old HashirHub app, used as a reference | **old computer only** | copy it (Step 1) |
| The onboarding PDF | **old computer only** | copy it (Step 1) |
| GitHub and Supabase sign-ins | old computer's password store | sign in again (Steps 3 and 6) |
| Git name and email | old computer's settings | set again (Step 4) |
| Claude's chat history | old computer | optional copy (Step 8) |

## On the old computer

### Step 1. Make sure everything is saved online, then collect the local-only files

Ask Claude: **"prepare the move kit"**. It checks that all work is pushed to GitHub and gathers the local-only files into a folder on the Desktop called `HashirHub-move-kit`. Or do it by hand:

1. In the project folder run `git status`. It must say **"nothing to commit, working tree clean"** and must not say "ahead". If it does, run `git push` first.
2. Copy these into one folder on a USB stick (or a private cloud folder):
   - `Desktop\supabase\.env`
   - `Desktop\supabase\public\refernce image made by chatgpt.png`
   - the folder `Desktop\adil-business-solutions` (the old HashirHub app)
   - `Desktop\HashirHub - Onboarding a New Client.pdf`

**Keep this folder private.** Never email it to a client or put it on GitHub. The reference image shows your account details, and the project on GitHub is public.

## On the new computer

### Step 2. Install the tools

Install each with its default options:

1. **Git**: https://git-scm.com/download/win
2. **Node.js** (the "LTS" version): https://nodejs.org
3. **GitHub CLI**: https://cli.github.com
4. **Google Chrome** (Claude uses it to test the app)
5. **VS Code**: https://code.visualstudio.com, then add the **Claude Code** extension and sign in to Claude

Close and reopen any terminal after installing, so it can see the new tools.

### Step 3. Sign in to GitHub and download the project

Open a terminal (in VS Code: Terminal → New Terminal) and run these one at a time:

```
gh auth login -h github.com -p https -w -s workflow
```

Your browser opens. Sign in as **invento1** and approve. Then:

```
gh auth setup-git
cd %USERPROFILE%\Desktop
gh repo clone invento1/inventory-app supabase
cd supabase
npm install
```

This creates `Desktop\supabase`, the same folder name as on the old computer.

### Step 4. Set the name that goes on your changes

```
git config --global user.name "hashirhub-uk"
git config --global user.email "yasir.visal@gmail.com"
```

### Step 5. Put the local-only files back

From the folder you made in Step 1:

| File | Put it here |
|---|---|
| `.env` | `Desktop\supabase\` |
| `refernce image made by chatgpt.png` | `Desktop\supabase\public\` |
| `adil-business-solutions` (folder) | `Desktop\` |
| the onboarding PDF | anywhere you like |

If you lost `.env`, recreate it: copy `.env.example` to `.env` and fill in the two values from **Supabase Dashboard → Project Settings → API** (the Project URL and the `anon` key).

### Step 6. Sign in to Supabase

1. Go to **Supabase Dashboard → Account → Access Tokens** and click **Generate new token**. Copy it (it starts with `sbp_`).
2. Run these, pasting your token in place of `YOUR_TOKEN`:

```
npx supabase login --token YOUR_TOKEN
npx supabase link --project-ref qkxquryxqpwsckdezxjh
```

If `link` asks for a database password, it's the one you chose when you created the Supabase project. If you've forgotten it, reset it under **Project Settings → Database**. If `link` shows a 403 error, carry on to the checks below: on the old laptop it showed that too and everything still worked.

### Step 7. Check that everything works

Run each of these:

| Command | What you should see |
|---|---|
| `npm run dev` | a local address; open it and sign in to HashirHub. Press Ctrl+C to stop |
| `npx supabase projects list` | a row for `inventory-app` with status `ACTIVE_HEALTHY` |
| `npx supabase db query --linked "select count(*) from orgs"` | a number (your businesses) |
| `npx supabase db query --linked "select * from tenant_schema_audit()"` | no rows |
| `git push --dry-run` | "Everything up-to-date" |

Then open the project folder in VS Code, start Claude Code, and say: **"I've moved to a new computer, check the setup."** Claude reads `CLAUDE.md` and picks up from there.

### Step 8. Optional: bring Claude's chat history

Claude doesn't need it: everything important is written in `CLAUDE.md`. If you want the old conversations to be resumable anyway, copy this folder from the old computer to the same place on the new one:

```
C:\Users\<your Windows name>\.claude\projects\c--Users-yasir-Desktop-supabase
```

It only matches if the project is at the same path on both computers (`C:\Users\yasir\Desktop\supabase`), which means the same Windows user name.

## If something goes wrong

| Problem | Fix |
|---|---|
| `npm` or `npx` says "running scripts is disabled on this system" | Windows PowerShell is blocking scripts. Type `npm.cmd` and `npx.cmd` instead (for example `npm.cmd install`). To fix it for good: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` |
| `git push` is denied and names a different GitHub account (for example the one used for another project) | The computer has another account saved. See "If the computer already uses another GitHub account" below |
| `git push` says "Authentication failed" | Run the `gh auth login ...` command from Step 3 again |
| A push is rejected mentioning "workflow" | Your sign-in lacks the workflow permission. Run the Step 3 login command again exactly as written (it includes `-s workflow`) |
| `npx supabase ...` says 403 or lists a different project | You're signed in to the wrong Supabase account. Run `npx supabase login --token ...` with a token from the right account |
| The app opens but sign-in fails for everyone | Check `.env` has the right two values. If they're right, the Supabase project may be paused: Supabase Dashboard → **Restore project** |
| `npm run dev` says a command isn't found | Close the terminal and open a new one, so it sees the tools you installed |

## If the computer already uses another GitHub account

This happened on the PC: it was signed in as `bollinclinic` for another project, so pushes to HashirHub were denied. These settings are saved inside the HashirHub folder only, so the other project is not affected.

1. Add the HashirHub account next to the existing one (sign in as **invento1** in the browser; use a private window if the browser is signed in as someone else):
   ```
   gh auth login -h github.com -p https -w -s workflow
   ```
2. Tell this project which account it belongs to:
   ```
   git remote set-url origin https://invento1@github.com/invento1/inventory-app.git
   ```
3. Tell this project to get its sign-in from the GitHub tool instead of the computer's saved login:
   ```
   git config --local credential.https://github.com.helper ""
   git config --local --add credential.https://github.com.helper "!gh auth git-credential"
   ```
4. Test with `git push --dry-run`. If it still names the other account, run `gh auth switch -u invento1` and test again. Switch back with `gh auth switch -u <other account>` if the other project's pushes are then refused.

The Supabase tool holds one login at a time. If the other project uses a different Supabase account, run `npx supabase login --token ...` again with the right token when you change projects.

## Afterwards

- **Work from one computer at a time.** If you ever go back to the old one, run `git pull` there before changing anything.
- **The old computer can keep its copy** as a backup. When you're sure you no longer need it there, delete `.env` and sign out with `gh auth logout` and `npx supabase logout`.
- **Delete the move-kit folder** from the USB stick once the new computer works.
