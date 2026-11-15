# How the jobs in this repo run

This file tells you what runs automatically in this repo, what each job needs, and what you must keep if you move the jobs off GitHub Actions.

## Summary

| Workflow file | Starts when | What it does |
|---|---|---|
| `sync-upstream.yml` | A `web-repo-updated` event from `MSP-2.0`. Also every day at 06:00 UTC. Also by hand. | Merges `MSP-2.0` `master` into this repo. If there is a conflict, it keeps the desktop version. It opens a PR on the `sync-upstream` branch and turns on auto-merge. |
| `release.yml` | A push to `master` or a `v*` tag. Also by hand. | Builds the Tauri app for macOS (Apple Silicon and Intel), Linux and Windows. It publishes a GitHub Release and uploads `latest.json` for auto-updates. |
| `test.yml` | Push and PR | Tests only. |

## How the jobs connect

1. A push to `master` in `MSP-2.0` starts `notify-desktop.yml` there. It sends a `web-repo-updated` event to this repo with the `DESKTOP_SYNC_TOKEN` secret (in `MSP-2.0`).
2. That event starts `sync-upstream.yml`. It opens a sync PR and turns on auto-merge.
3. When the required checks pass, the PR merges into `master`.
4. The push to `master` starts `release.yml`, and the release goes to users through auto-update.

## Secrets

GitHub does not show secret values again, so keep a copy of each in your password manager.

| Secret | Repo | What it is |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | this repo | Private key that signs the update files (`.sig`). **The most important secret.** The installed apps check updates with the matching public key in `src-tauri/tauri.conf.json`. If you lose this key, installed apps cannot get updates. Users must then install the app again by hand. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | this repo | Password for the signing key |
| `SYNC_PAT` | this repo | Personal access token that opens the sync PR and turns on auto-merge. Give it **Contents**, **Pull requests** and **Workflows: Read and write** on this repo. |
| `DESKTOP_SYNC_TOKEN` | `MSP-2.0` | Token that sends the `web-repo-updated` event to this repo |

## Moving the jobs

### The sync job
This job is only git and the GitHub CLI. You can run it on a server with a timer. Copy the steps from `sync-upstream.yml`. The conflict step has comments that explain a special case (a file that this repo deleted). Read them before you change the step.

### The release job
**Keep this job on GitHub Actions.** It builds on macOS, Windows and Linux. A Linux server cannot build the macOS and Windows apps. This repo is public, so the build minutes are free.

Also, auto-update depends on GitHub Releases. The installed apps read updates from the endpoint in `src-tauri/tauri.conf.json`:

```
https://github.com/ChadFarrow/MSP-2.0-Desktop-App/releases/latest/download/latest.json
```

The download URLs in `latest.json` also point to GitHub Releases. If you move the releases, the apps that people already installed continue to read the old endpoint. Only new installs get a new endpoint.

### Build one platform by hand
```bash
npm ci
TAURI_SIGNING_PRIVATE_KEY="$(cat key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=... \
  npx tauri build
```
`release.yml` also writes the version into `src-tauri/tauri.conf.json` before the build (base version + run number, or the tag).
