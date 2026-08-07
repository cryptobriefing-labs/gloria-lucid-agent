# DEPLOY.md

> **THIS REPOSITORY IS PUBLIC.** Infrastructure identifiers are deliberately not
> written down here: no account number, no role ARN, no security group id, no
> host address, no SSH user or port, no on-box absolute path. Every one of them
> is referenced by the name of a GitHub Actions variable, and the value lives in
> repo settings where only people with access can read it. **Keep it that way
> when you edit this file.** The values themselves are in the deploy handover
> note held by the repo owner.

```
Owner:        <UNASSIGNED>        # DECISION PENDING D1, Diego's call. Do not fill in without agreement.
Backup owner: <UNASSIGNED>
Tier:         S                   # box service. No staging box, and that is the correct answer.
Runtime:      One EC2 instance, referenced by the SSH_HOST variable.
              Directory:  $APP_DIRECTORY variable
              systemd:    $APP_NAME variable (a .service unit, User=ubuntu)
              ExecStart:  the bun binary at $BUN_BIN, running `bun run src/index.ts`
              Listens on PORT from the host .env (3004).
Production:   https://lucid.itsgloria.ai  (Cloudflare Tunnel to 127.0.0.1:3004)
Staging:      none, Tier S.
Branch:       master. NOT main. See "The branch is master".
```

**Status: the pipeline in this file is AUTHORED BUT NEVER RUN.** It has not been
exercised once. Read "Before the first deploy" at the bottom before merging
anything that would trigger it.

---

## The branch is `master`

This repo's default branch is `master`. The workflow triggers on `master` and
nothing in this change renames it. Renaming a default branch during a freeze is
its own change with its own blast radius, and `cb-dev-workflow-186` section 1.1
is explicit: `master` is accepted where it already exists, rename it later as its
own change or never.

If you copy this workflow to another repo, **change the trigger branch first.**

---

## The one sanctioned deploy path

Production is deployed ONLY by `.github/workflows/prod.yml`, triggered by a push
to `master`, plus a manual `workflow_dispatch` for the case where you need to
force a restart without a code change.

Nothing else deploys this repo. If you deployed it another way, that is an
incident, not a shortcut. Tell the owner.

**The transport is `rsync`, never `git pull` on the box.** The runtime directory
has never been a git clone and must never become one. A `.git` on a runtime host
invites `git pull` or `git checkout` during an incident. That is how a sibling
runtime in this estate lost two commits and five stashes on 2026-07-16.
`scripts/drift-check.sh` fails the deploy if a `.git` appears there.

### What the workflow does, in order

| # | Step | Note |
|---|---|---|
| 1 | OIDC assume-role, get runner public IP | No long-lived AWS keys. The IP lookup is validated so a DNS failure reads as a DNS failure |
| 2 | Open port 22 to the runner's single `/32` | Just-in-time. Revoked in step 11 under `if: always()` |
| 3 | Fingerprint `src/**` and `package.json` + `bun.lock` on the box | Taken BEFORE anything is written |
| 4 | `rsync src/` and `rsync scripts/` **with `--delete`** | Bounded blast radius. Neither holds anything untracked |
| 5 | `rsync ./` top level **without `--delete`**, `node_modules/` and `.env` excluded | See "node_modules is load-bearing" |
| 6 | `scripts/check-env.sh` | Read-only gate. Runs BEFORE any restart |
| 7 | `bun install --frozen-lockfile` **only if `package.json` or `bun.lock` changed** | See "Why the install is conditional and frozen" |
| 8 | `systemctl restart` **only if `src/**` or the dep files changed**, or `force_restart` | See "Why the restart is conditional" |
| 9 | `scripts/health-check.sh` | **Unconditional.** Runs whether or not step 8 restarted |
| 10 | Parity check, then `scripts/drift-check.sh` | Box equals git, and the box holds nothing extra |
| 11 | Discord notify, revoke the `/32`, wipe `~/.ssh` | Revoke and cleanup are `if: always()` |

### `node_modules` is load-bearing, and the deploy protects it three ways

The runtime `node_modules` is **583 MB** and is what the service runs on. A
deploy must never blow it away and must never force a full reinstall. Three
independent protections:

1. It is gitignored, so it is not in the rsync source at all.
2. It is named in `--exclude` on the top-level rsync anyway, belt and braces.
3. The top-level rsync carries **no `--delete`**, so even a broken exclude list
   cannot remove it. `--delete` is used only on `src/` and `scripts/`, two
   directories that contain nothing but git-tracked TypeScript.

`scripts/drift-check.sh` additionally fails the deploy if `node_modules` has gone
missing, so the failure reads as "node_modules is missing" rather than as a
confusing crash in the health check.

### Why the install is conditional, and why it is frozen

`bun install` runs only when `package.json` or `bun.lock` actually changed.

It runs with `--frozen-lockfile` and there is **deliberately no fallback** to a
plain `bun install`. `package.json` pins three dependencies to the dist-tag
`latest`:

```
"@lucid-agents/core": "latest",
"@lucid-agents/express": "latest",
"@lucid-agents/payments": "latest",
```

An unfrozen install would resolve those afresh on every deploy and put whatever
npm published that morning underneath a live paid agent endpoint. If the frozen
install fails, `bun.lock` and `package.json` genuinely disagree and a human
reconciles them in a PR by running `bun install` locally and committing the
updated lockfile. The deploy must not paper over it.

**Replacing those three `latest` specifiers with real version ranges is the
proper fix and is a follow-up, not part of this pipeline.**

`package-lock.json` is also tracked and is vestigial: the service runs under bun,
not npm, and the pipeline never reads it.

### Why the restart is conditional

A restart drops in-flight HTTP requests to a live, paid agent endpoint. The
workflow fingerprints the runtime-relevant tree on the box before the sync,
compares after, and restarts only when something the running process loads has
changed.

"Something the running process loads" is `src/**` plus `package.json` and
`bun.lock`, because the `ExecStart` runs `bun run src/index.ts`. **`scripts/` is
deliberately excluded**: `register-8004.ts` and `update-uri-8004.ts` are one-shot
on-chain admin scripts run by a human and never imported by the service, so a
change there must not restart production.

**The health check runs either way.** A deploy that restarted nothing still has
to prove the service is alive, or a green run tells you nothing about production.

---

## Forbidden

Do NOT do any of the following, ever, for any reason, including urgency:

- delete, move or rebuild `node_modules/` as part of a deploy
- run `bun install` **without** `--frozen-lockfile` on the box (see above)
- `scp` or `rsync` individual files to the runtime directory outside the pipeline
- edit any file on the production host, including "just this one line", including
  as root
- run `git init`, `git pull`, `git checkout`, `git stash`, `git clean` or
  `git reset` inside the runtime directory. It is not a clone and must not become
  one
- delete, truncate, recreate or `echo >>` the host `.env`. The systemd unit has
  **no `EnvironmentFile`**, so bun loading `.env` from the working directory is
  the ONLY way this service is configured. Overwriting it takes the agent down
- add `--delete` to the top-level rsync. `node_modules/` and `.env` live there
- create `.bak`, `.pre`, `.old` or dated sidecar copies of a file as a substitute
  for a commit
- add, remove or edit the live systemd unit or the Cloudflare Tunnel config
  without committing the same change to this repo
- write a secret value into any file that git tracks.
  `PAYMENTS_RECEIVABLE_ADDRESS` and `GLORIA_API_TOKEN_DEV` in particular
- **write an infrastructure identifier into any file that git tracks.** This repo
  is public. Host addresses, account numbers, role ARNs, security group ids and
  on-box absolute paths belong in GitHub Actions variables, referenced by name

If you need to do one of these to recover an outage, do it, then open a PR the
same day that captures exactly what you did.

---

## Runtime files that are NOT in git, and why

| Path (relative to `$APP_DIRECTORY`) | Why | Where the real copy lives |
|---|---|---|
| `.env` | Secrets and runtime config, 13 keys. **Load-bearing in an unusual way:** the systemd unit carries no `EnvironmentFile`, so bun auto-loading this file from the working directory is how the service is configured, including `PORT=3004` | The box. Key names in `.env.example`, which matches the host exactly as of 2026-08-07 |
| `node_modules/` | 583 MB of installed dependencies. Built on the box by `bun install` | The box. Rebuilt only when `bun.lock` changes |
| `dist/`, `.data/` | Gitignored build output and local state. Neither exists on the box today | n/a |

That list is complete as of 2026-08-07 and `scripts/drift-check.sh` enforces it:
anything else appearing at the top level fails the deploy.

Not in this list because it is not this repo's: the live systemd unit. **This
repo does not carry a copy of it.** Adding one, as `gloria-mcp` does in its
`deploy/` directory, is a worthwhile follow-up. If you add one, remember it will
contain absolute paths, and this repo is public.

---

## Rollback

```
Anchor:      the previous commit sha on `master`, plus a dated tarball on the host
Last tested: NEVER TESTED
```

Take the anchor before the first deploy. `~/freeze-backups/` does not exist on
the host yet, so create it. **Exclude `node_modules`** or the tarball is 583 MB
of reproducible data. `$HOST` below is your ssh alias for the production box.

```
ssh "$HOST" 'mkdir -p ~/freeze-backups'
```

```
ssh "$HOST" "tar -C \$(dirname \"$APP_DIRECTORY\") --exclude='*/node_modules' -czf ~/freeze-backups/gloria-lucid-agent-\$(date +%Y%m%d-%H%M%S).tgz \$(basename \"$APP_DIRECTORY\")"
```

Verify it is readable before proceeding. **An untested backup is not a backup.**

```
ssh "$HOST" 'tar -tzf ~/freeze-backups/gloria-lucid-agent-<stamp>.tgz | head'
```

To roll back, revert the commit on `master` and let the pipeline redeploy:

```
git revert <bad-sha>
```

```
git push origin master
```

If the pipeline itself is what is broken, roll back by hand from a clone at the
previous sha, then fix the pipeline in a PR the same day:

```
rsync -rlz --delete --no-times --no-perms src/ "$HOST:$APP_DIRECTORY/src/"
```

```
ssh "$HOST" "sudo systemctl restart \"\$APP_NAME\" && cd \"$APP_DIRECTORY\" && ./scripts/health-check.sh"
```

---

## Health check

`scripts/health-check.sh`, run by the pipeline on every deploy and runnable by
hand at any time. It writes nothing, so run it whenever you want the truth:

```
ssh "$HOST" 'bash -s' < scripts/health-check.sh
```

Four assertions, and the specific failure each one catches:

| # | Assertion | What it catches that a weaker check would miss |
|---|---|---|
| 1 | `systemctl is-active` on the unit is `active` | The unit failed to start at all, for example a missing bun binary |
| 2 | `GET http://127.0.0.1:3004/.well-known/agent-card.json` returns 200, parses as JSON, has a non-empty `.name`, and has **at least one entry in `.skills`** | A TypeScript error in `src/` (bun exits, port closes, curl gets 000); a broken or half-installed `@lucid-agents` dependency; **and the subtle one: the express app booting while the agent framework registers nothing, which returns a perfectly valid 200 with an empty skills array and is invisible to a status-code-only check** |
| 3 | `NRestarts` did not increase during a settle window | **The crash loop.** The unit is `Restart=on-failure` with `RestartSec=5`, so a process that starts, serves one request and dies is `active` again five seconds later and looks healthy to any point-in-time check |
| 4 | `systemctl is-active` is still `active` after the settle window | A death that begins after assertion 2 passed |

Measured on the production host 2026-08-07, live: `name=Gloria version=1.0.0
skills=4`.

---

## Parity check

Proves the box byte-matches the deployed commit. This is the Tier S substitute
for a staging environment: there is no second box to compare against, so the
check is "does production match the commit".

Run from a clean clone at the deployed sha:

```
rsync -rln --checksum --itemize-changes --no-times --no-perms --exclude='.git/' --exclude='.github/' --exclude='node_modules/' --exclude='.env' --exclude='dist/' --exclude='.data/' ./ "$HOST:$APP_DIRECTORY/"
```

Expected: **no output at all.** Any line means drift.

**Stated limitation:** `rsync --dry-run` reports only what it would send. It
cannot see receiver-only files, so this proves "everything in git matches the
box", not "the box has nothing extra". The extras half is
`scripts/drift-check.sh`, which the pipeline runs immediately after.

```
Last run: 2026-08-07, read-only, from the tip of `master`.
Result:   src/ byte-identical. package.json and bun.lock byte-identical.
          Box missing LICENSE, README.md and scripts/update-uri-8004.ts, none
          of which is loaded by the service.
```

---

## Before the first deploy

In order. Nothing here has been done.

1. Assign an owner. Fill in `Owner:` above. DECISION PENDING D1.
2. Create the `Production` GitHub Environment and populate the variables and
   secrets listed below. **The values are not in this file and must not be added
   to it.**
   **Confirm first that the deploy IAM role's trust policy allows
   `repo:cryptobriefing/gloria-lucid-agent:*`.** If it is scoped to the repos
   that already use it, step 1 of every run fails with
   `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
3. Take and verify the tarball rollback anchor (above). Test the rollback once.
4. Set the environment's deployment branch policy to `master` only. **This repo
   is public**, so unlike the private repos in this org, classic branch
   protection on `master` is also available today on the Free plan and should be
   turned on.
5. Merge this PR, then let it deploy once. The first deploy is a **no-op for the
   running service**: `src/`, `package.json` and `bun.lock` are already
   byte-identical, so no install and no restart fire, and only three inert files
   are written. That makes it a safe first exercise.
6. **Then break it deliberately once.** Stop the unit and confirm the health
   check fails. An untested gate is not a gate.

### What the `Production` environment needs

Names only. **Do not write the values into this file or into the workflow.**

| Kind | Name | What it is |
|---|---|---|
| var | `AWS_REGION` | The region the instance is in |
| var | `AWS_ROLE_ARN` | The OIDC deploy role. Same one the org's existing EC2 pipeline already uses |
| var | `AWS_INSTANCE_SG_ID` | The security group the just-in-time port 22 rule is added to and removed from |
| var | `SSH_HOST` | The instance's public DNS name |
| var | `SSH_PORT` | The SSH port |
| var | `SSH_USERNAME` | The deploy user on the box |
| var | `APP_DIRECTORY` | Absolute path to the runtime directory |
| var | `APP_NAME` | The systemd unit name, including `.service` |
| var | `BUN_BIN` | Absolute path to the bun binary |
| secret | `SSH_PRIVATE_KEY` | A deploy key authorized for the deploy user. **Not created by this PR** |
| secret | `DISCORD_WEBHOOK` | The deploy-notification webhook |

`BUN_BIN` is a variable rather than a hardcoded path for two reasons, and both
matter. **bun is not on `PATH` for a non-login SSH command**: `which bun` over
ssh returns nothing on this box, and the systemd unit works only because it sets
an explicit `Environment=PATH`. And this repo is public, so the path does not
belong in a committed file. The workflow asserts the binary is executable before
it tries to use it, so a wrong value fails loudly at the top of the deploy step.

Three facts the owner needs before configuring this, none of which belong in a
public file as values:

- **The security group is shared with a second production box.** Opening port 22
  for the runner opens it on both for the duration of a deploy.
- **`SSH_HOST` is a public DNS name derived from a public IPv4.** If that address
  is not an Elastic IP, a stop/start of the instance silently invalidates the
  variable.
- Every AWS value here is identical to what the org's existing, working EC2
  deploy pipeline already has configured for this same estate. Copy from there
  rather than looking anything up.
