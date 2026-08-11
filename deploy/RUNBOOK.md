# Backend Deploy Runbook — Droplet-Side Steps

These steps cannot be automated from CI (no SSH access from this environment). Run them by hand,
in order, over an SSH session on the droplet. Each step lists the expected result.

## 1. One-time droplet setup

Install Docker Engine if it's not already present:

```bash
curl -fsSL https://get.docker.com | sudo sh
docker --version
```
Expected: prints a Docker version string.

Let the deploy SSH user run docker without `sudo`:

```bash
sudo usermod -aG docker $USER
# log out and back in for the group change to take effect
docker ps
```
Expected: `docker ps` runs without a permission error (empty table is fine).

Confirm `/opt/route-editor/.env` exists and holds the backend runtime vars (`MTD_API_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). It is now mounted via `--env-file`, which is
**stricter** than pydantic-settings tolerated before: it requires plain `KEY=value` lines, no
`export`, no quotes around values, and no inline comments. This is the most likely first-cutover
failure — check it explicitly:

```bash
cat /opt/route-editor/.env
```
Expected: every line is `KEY=value` with no `export`, no surrounding quotes, no trailing `# comment`.

## 2. GHCR authentication on the droplet

Normal CI-triggered deploys log in with the workflow's own run-scoped `GITHUB_TOKEN` — no PAT is
needed for the day-to-day path.

A credential IS needed when pulling by hand (rollback, first cutover) if the package is private —
which is the default for a newly created GHCR package regardless of repo visibility. Two options:

**a. Make the package public once** (simplest — pulls then need no auth):

GitHub → Packages → `backend` → Package settings → Change visibility → Public.

**b. Keep it private and log in once on the droplet:**

```bash
echo <PAT> | docker login ghcr.io -u <github-username> --password-stdin
chmod 600 ~/.docker/config.json
```
Use a classic PAT scoped to `read:packages` ONLY. Note this writes the credential to
`~/.docker/config.json` in base64 (not encrypted) — hence the `chmod 600`.

After a droplet reboot the unit starts from the locally cached image and does not pull, so a
missing credential does not break reboots.

## 3. Install the unit

Back up the old (venv-based) unit first — this is the rollback path if the container cutover
goes sideways:

```bash
sudo cp /etc/systemd/system/route-editor-api.service{,.venv.bak}
```

Install the new unit and reload systemd:

```bash
sudo cp deploy/route-editor-api.service /etc/systemd/system/route-editor-api.service
sudo systemctl daemon-reload
```
Expected: no errors from either command.

## 4. First cutover

No deploy has written `/opt/route-editor/image.env` yet, so seed it by hand with the SHA of the
first commit that lands this change on `main`:

```bash
echo "BACKEND_IMAGE=ghcr.io/akshay-p-123/route-editor/backend:<sha>" | sudo tee /opt/route-editor/image.env
docker pull "$BACKEND_IMAGE"
sudo systemctl restart route-editor-api
```

Verify, in order:

```bash
systemctl status route-editor-api      # expected: active (running)
docker ps                              # expected: shows route-editor-api
curl -fsS localhost:8000/health        # expected: {"status":"ok"}
```

Then load the live frontend and confirm a route still loads end to end.

For live logs (container stdout now surfaces through journald since `docker run` runs in the
foreground):

```bash
sudo journalctl -u route-editor-api -f
```

## 5. Rollback

**To a prior build:** set `BACKEND_IMAGE` in `/opt/route-editor/image.env` to the older SHA tag,
pull it, restart:

```bash
echo "BACKEND_IMAGE=ghcr.io/akshay-p-123/route-editor/backend:<prior-sha>" | sudo tee /opt/route-editor/image.env
docker pull "$BACKEND_IMAGE"
sudo systemctl restart route-editor-api
```
There is deliberately no automation for this — it's a manual three-command procedure.

**Off containers entirely** (if the container approach itself needs to be abandoned):

```bash
sudo cp /etc/systemd/system/route-editor-api.service.venv.bak /etc/systemd/system/route-editor-api.service
sudo systemctl daemon-reload
sudo systemctl restart route-editor-api
```

## 6. Known follow-ups (not work for this pass)

- Frontend deploy is still manual; `frontend/Dockerfile` remains unused by automation.
- Old `backend/venv` on the droplet is now dead weight and can be deleted after the cutover is
  confirmed stable.
- `-p 8000:8000` still binds all interfaces, matching the pre-container behavior. Narrowing to
  `127.0.0.1:8000:8000` would be a real hardening win but risks breaking the Next.js BFF if it
  reaches the backend across the droplet's own interface — out of scope for this pass.
