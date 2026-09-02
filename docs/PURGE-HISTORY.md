# Purging the committed database backups from git history

Two files with personal health data were committed and pushed:

- `app.db.bak-20260810-192738`
- `app.db.bak-20260813-084257-precopy`

They were removed from tracking in a later commit, but **still exist in the
history** of `main` (and any branch that predates the removal), so anyone
with repo access - or anyone who cloned it while it was public - can still
read them.

Removing them from history rewrites every commit hash after the point they
were added, which means a **force-push** and every other clone/branch must
be re-based or re-cloned. Do this deliberately.

## 0. Check exposure first

- Was the repo ever public? If yes, assume the data is already copied and
  treat the measurements/weights as disclosed. Rewriting history still
  removes it going forward and is worth doing.
- Close or merge open PRs first if you can - a force-push can leave them
  in a weird state.

## 1. Rewrite history with git-filter-repo

```bash
# macOS
brew install git-filter-repo

# from a fresh clone of the repo (filter-repo insists on this)
cd /tmp
git clone https://github.com/KarianneKies/fitness-tracker.git purge
cd purge

git filter-repo \
  --path app.db.bak-20260810-192738 \
  --path app.db.bak-20260813-084257-precopy \
  --invert-paths

# filter-repo drops the remote; add it back
git remote add origin https://github.com/KarianneKies/fitness-tracker.git
```

## 2. Force-push every ref

```bash
git push origin --force --all
git push origin --force --tags
```

## 3. Aftermath

- Delete and re-create any long-lived branches that still carry the old
  history (`proxy_test`, feature branches) from the rewritten `main`.
- Every existing local clone is now poisoned - delete them and re-clone.
- On GitHub: Settings -> ask support to purge cached views / or wait for
  GC. Stale blobs can linger in the web UI by SHA for a while.
- Rotate anything else that lived in those DBs if it mattered (it's health
  data, not secrets, so probably nothing to rotate - but confirm).

## 4. Prevent recurrence

Already done: `.gitignore` now covers `*.db`, `*.db.bak*`, `*.db-wal`,
`*.db-shm`. Never `git add .` in this repo without checking `git status`
first; prefer `git add -p` or explicit paths.
