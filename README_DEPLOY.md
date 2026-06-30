# Claude Central — Auto-Deploy Setup

This document explains how to set up automatic deployment of the Claude Central Command dashboard to the server at `command.digitalmaster.no` via GitHub Actions.

---

## Repository Structure Required

The workflow expects the following layout in `Goda753/claude-central`:

```
claude-central/
├── .github/
│   └── workflows/
│       └── deploy.yml          ← copy github-actions-deploy.yml here
├── command/
│   ├── config.php              ← DB connection + helpers
│   ├── api.php                 ← REST API (all endpoints)
│   └── index.php               ← Dashboard UI
└── README.md
```

The workflow only triggers when files inside `command/` are changed. A push that only touches `README.md` or other files will not trigger a deploy.

---

## Step 1 — Generate or Export the SSH Key

The server uses an ed25519 key pair. If you already have a key installed on the server (`semenvoi@46.250.221.12`), export the **private** key:

```powershell
# On Windows — read the private key you use for the server
Get-Content ~/.ssh/your_semenvoi_key
```

Copy the full output including the `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----` lines.

If you need to generate a new key pair:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/digitalmaster_deploy
# Then add the PUBLIC key to the server:
ssh-copy-id -i ~/.ssh/digitalmaster_deploy.pub semenvoi@46.250.221.12
```

---

## Step 2 — Add the GitHub Secret

1. Go to `https://github.com/Goda753/claude-central/settings/secrets/actions`
2. Click **New repository secret**
3. Name: `DIGITALMASTER_SSH_KEY`
4. Value: paste the full private key content (all lines including header/footer)
5. Click **Add secret**

The secret is referenced in the workflow as `${{ secrets.DIGITALMASTER_SSH_KEY }}`.

---

## Step 3 — Add the Workflow File

Place `github-actions-deploy.yml` at `.github/workflows/deploy.yml` in the repo root:

```bash
# From the repo root
mkdir -p .github/workflows
cp /path/to/github-actions-deploy.yml .github/workflows/deploy.yml
git add .github/workflows/deploy.yml
git commit -m "Add auto-deploy workflow for Claude Central"
git push
```

---

## Step 4 — Automatic Deploy (on push)

Any push to `main` that includes changes to files under `command/` will automatically:

1. Checkout the repo
2. Install the SSH key from the secret
3. Add the server fingerprint to known_hosts (keyscan)
4. SCP `config.php`, `api.php`, and `index.php` to `/home/semenvoi/command.digitalmaster.no/`
5. Run a health check: `GET https://command.digitalmaster.no/api.php?action=health`
6. Fail the job (with a red X on the commit) if the health check returns anything other than `{"ok":true,...}`

---

## Step 5 — Manual Deploy (workflow_dispatch)

To trigger a deploy without pushing code:

1. Go to `https://github.com/Goda753/claude-central/actions/workflows/deploy.yml`
2. Click **Run workflow**
3. Select branch `main`
4. Optionally enter a reason (e.g. "Force redeploy after server restore")
5. Click **Run workflow**

Or via GitHub CLI:

```bash
gh workflow run deploy.yml --repo Goda753/claude-central -f reason="Emergency redeploy"
```

---

## Health Check Endpoint

The workflow verifies deployment by calling:

```
GET https://command.digitalmaster.no/api.php?action=health
```

Expected response (no auth required):

```json
{"ok": true, "service": "Claude Central Command", "ts": 1234567890}
```

If `api.php` is missing or broken, the job fails and the commit gets a red status.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Permission denied (publickey)` | Wrong key or key not on server | Re-add public key to `~/.ssh/authorized_keys` on server |
| `No such file or directory` on SCP | `command/` files missing from repo | Make sure `config.php`, `api.php`, `index.php` are committed |
| Health check fails | `api.php` error or DB down | SSH to server and check PHP error logs |
| Workflow not triggered | Push didn't touch `command/` | Add `workflow_dispatch` trigger and run manually |
| Host key verification failed | Server IP changed | Delete cached known_hosts in GitHub or update `ssh-keyscan` target |

---

## Server Details

- **Host:** `46.250.221.12`
- **User:** `semenvoi`
- **Deploy path:** `/home/semenvoi/command.digitalmaster.no/`
- **Dashboard:** https://command.digitalmaster.no/
- **API:** https://command.digitalmaster.no/api.php
