# TaskAutomationToGmail

Daily AI update email automation powered by GitHub Actions and the Gmail API.

The workflow checks official update sources for ChatGPT/OpenAI, Claude Code/Anthropic, and Codex/plugin-related tooling, then sends a Chinese email summary through Gmail.

## Current Schedule

The workflow file is:

```text
.github/workflows/ai-updates-email.yml
```

Current cron:

```yaml
schedule:
  # 09:00 Asia/Shanghai is 01:00 UTC.
  - cron: "0 1 * * *"
```

GitHub Actions cron is always interpreted in UTC. Asia/Shanghai is UTC+8.

Common examples:

```yaml
# 09:00 Asia/Shanghai
- cron: "0 1 * * *"

# 09:17 Asia/Shanghai, recommended over exactly 09:00
- cron: "17 1 * * *"

# 12:00 Asia/Shanghai
- cron: "0 4 * * *"

# 14:30 Asia/Shanghai
- cron: "30 6 * * *"

# 09:00 Asia/Shanghai on weekdays only
- cron: "0 1 * * 1-5"
```

## Why a Scheduled Run May Not Execute

On 2026-05-09, the expected 09:00 Asia/Shanghai run did not create a GitHub Actions run.

Checks performed:

- The repository default branch is `main`.
- The workflow is active.
- The workflow file exists on `main`.
- The previous manual run succeeded.
- The Actions run list had no `schedule` event for 2026-05-09 09:00 Asia/Shanghai.

This means the email job did not fail inside the script. GitHub simply did not create that scheduled run.

GitHub documents that scheduled workflows can be delayed during high load, and high load includes the start of every hour. If load is high enough, queued jobs can be dropped. To reduce this risk, schedule the workflow at a non-zero minute, such as `09:17` Asia/Shanghai:

```yaml
- cron: "17 1 * * *"
```

Reference: <https://docs.github.com/actions/learn-github-actions/events-that-trigger-workflows#schedule>

For important delivery guarantees, use a more reliable scheduler such as a VPS cron, cloud function scheduler, or a workflow that runs more frequently and deduplicates sends.

## Manual Run

Use this when testing or when a scheduled run is missed:

1. Open the GitHub repository.
2. Go to `Actions`.
3. Select `Daily AI updates email`.
4. Click `Run workflow`.
5. Choose branch `main`.
6. Click the green `Run workflow` button.

Manual runs use the latest workflow on `main`.

## Recipients

Recipients are configured with the repository secret:

```text
AI_UPDATES_RECIPIENT
```

For one recipient:

```text
deng1543659807@gmail.com
```

For multiple recipients, use comma-separated email addresses:

```text
deng1543659807@gmail.com, another@example.com, third@example.com
```

The script passes this value to the email `To` header.

## Required GitHub Secrets

Open:

```text
Settings -> Secrets and variables -> Actions -> Repository secrets
```

Required secrets:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_SENDER_EMAIL
AI_UPDATES_RECIPIENT
```

Legacy SMTP secrets are no longer used by the current workflow:

```text
GMAIL_SMTP_USER
GMAIL_SMTP_APP_PASSWORD
```

They can remain in the repository secrets, but the Gmail API OAuth flow is the active sending method.

## Generate a Gmail Refresh Token

The helper script uses the Gmail send-only scope:

```text
https://www.googleapis.com/auth/gmail.send
```

Run locally in PowerShell:

```powershell
cd D:\200\TaskAutomation
$env:GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
$env:GOOGLE_CLIENT_SECRET="your-client-secret"
npm run oauth:gmail
```

Open the printed Google authorization URL, authorize the app, then copy the printed `GOOGLE_REFRESH_TOKEN` into GitHub repository secrets.

Do not commit OAuth JSON files or share refresh tokens in chat. If a refresh token is exposed, generate a new one and replace the GitHub secret.

## Local Checks

Preview the email without sending:

```powershell
$env:DRY_RUN="1"
npm run ai-updates
```

Run tests:

```powershell
npm test
```

Check the email script syntax:

```powershell
node --check scripts\ai-updates-email.js
```
