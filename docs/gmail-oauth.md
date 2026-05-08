# Gmail API OAuth setup

This project sends the daily AI updates email through the Gmail API. It does not use Gmail SMTP or app passwords.

## GitHub secrets

Add these repository secrets in GitHub:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET` if your OAuth client has one
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_SENDER_EMAIL`
- `AI_UPDATES_RECIPIENT` optional; defaults to `deng1543659807@gmail.com`

## Create Google OAuth credentials

1. Open Google Cloud Console.
2. Create or select a project.
3. Enable the Gmail API.
4. Configure the OAuth consent screen.
5. Create an OAuth client ID for a desktop app.
6. Copy the client ID and client secret.

## Generate a refresh token locally

In PowerShell:

```powershell
$env:GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
$env:GOOGLE_CLIENT_SECRET="your-client-secret"
npm run oauth:gmail
```

Open the printed URL, authorize Gmail send access, and copy the printed `GOOGLE_REFRESH_TOKEN` into GitHub repository secrets.

The helper uses the `https://www.googleapis.com/auth/gmail.send` scope only.
