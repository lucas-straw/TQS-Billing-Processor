# Rollback Playbook

The billing processor deploys automatically to Azure App Service `tesfortqscode` on every push to `main` (workflow `.github/workflows/main_tesfortqscode.yml`). Each shipped version is a single PR merged into `main`. To roll a release back, revert the merge commit — Azure auto-redeploys the previous state.

## Released versions

| Version | Released | Merge SHA | PR | Notes |
|---|---|---|---|---|
| v1.2.0 | 2026-04-27 | `57d3a15` | [#4](https://github.com/lucas-straw/TQS-Billing-Processor/pull/4) | Mid-period agreement coverage + in-app changelog |
| v1.3.0 | 2026-04-27 | `d7f5c05` | [#5](https://github.com/lucas-straw/TQS-Billing-Processor/pull/5) | Additional-hours producing-facility routing |
| v1.4.0 | 2026-04-28 | `6c8a429` | [#6](https://github.com/lucas-straw/TQS-Billing-Processor/pull/6) | Test-account block fixes + per-item dynamic dates |
| v1.5.0 | 2026-04-28 | `dee7e9b` | [#7](https://github.com/lucas-straw/TQS-Billing-Processor/pull/7) | Pre-Bill Reconciliation Phase 1 (foundation) |

Update this table when shipping new versions.

## Verifying what's currently live

1. Open the deployed URL.
2. Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) to bypass cached HTML.
3. Header shows `vX.Y.Z · Changelog`. Click it to see the entry list.
4. Cross-check against the merge SHA in the GitHub Actions run on the live deploy.

## Rolling back one version

`git revert` creates a new commit that undoes a previous one — clean, no force-push, no history rewrite.

### If the merge was a squash commit (single-line on main, e.g. v1.4.0)

```bash
git checkout main
git pull origin main
git revert <sha>            # opens editor; save to confirm
git push origin main
```

### If the merge was a regular merge commit (has two parents, e.g. v1.2.0/v1.3.0/v1.5.0)

`-m 1` tells revert to keep the mainline parent.

```bash
git checkout main
git pull origin main
git revert -m 1 <sha>
git push origin main
```

### Tell which it is

```bash
git show --no-patch <sha>
```
Multiple `Merge:` parents → regular merge (use `-m 1`). Single parent → squash (no `-m`).

The Azure workflow runs on the push and redeploys within a few minutes. Watch the Actions tab — green checkmark = the revert is live.

## Rolling back more than one version

Revert in reverse chronological order (newest first), pushing between each. Each revert is a separate forward-only commit.

```bash
git revert -m 1 <v1.5.0 sha>
git push origin main
# wait for green deploy, smoke test
git revert <v1.4.0 sha>     # squash, no -m needed
git push origin main
# etc.
```

If you'd rather do it as a single deploy:

```bash
git revert -m 1 --no-commit <v1.5.0 sha>
git revert --no-commit <v1.4.0 sha>
git commit -m "Rollback to v1.3.0"
git push origin main
```

## Rolling back from the Azure side (no git changes)

Azure App Service keeps deployment history. Portal → App Service `tesfortqscode` → Deployment Center → Deployments tab → pick a previous deployment → "Redeploy". This is the fastest if you need to roll back immediately while you investigate; the git side stays as-is, so the next push to `main` will redeploy whatever's there.

If you redeploy from Azure, also `git revert` afterward so git and Azure don't drift.

## What to do if the deploy fails

1. Check the Actions tab for error logs.
2. If the build itself failed, no rollback needed — `main` is still pointing at the broken commit but Azure didn't redeploy. Push a fix or a revert.
3. If the build succeeded but the app is broken, follow the rollback steps above.

## Manual tag creation (optional, for named release points)

Tags didn't push from the build environment due to a proxy restriction. You can create tags locally (so the SHAs are named) and push them from your own machine:

```bash
git fetch origin
git tag -a v1.2.0 57d3a15 -m "v1.2.0 — Mid-period agreement coverage + changelog UI"
git tag -a v1.3.0 d7f5c05 -m "v1.3.0 — Additional-hours producing-facility routing"
git tag -a v1.4.0 6c8a429 -m "v1.4.0 — Test-account block fixes + per-item dynamic dates"
git tag -a v1.5.0 dee7e9b -m "v1.5.0 — Pre-Bill Reconciliation Phase 1"
git push origin v1.2.0 v1.3.0 v1.4.0 v1.5.0
```

Or via the GitHub UI: Releases → "Draft a new release" → pick the merge SHA as the target → set tag `v1.X.Y`.

Once tags exist, redeploys can target them by SHA from the Azure Deployment Center, and `git checkout v1.4.0` works as expected.
