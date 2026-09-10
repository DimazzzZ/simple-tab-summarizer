# Automated Chrome Web Store Publishing

This repo can publish new versions of the extension to the Chrome Web Store
automatically when the Release workflow is dispatched. The workflow lives in
[`.github/workflows/release.yml`](../.github/workflows/release.yml) — the
`publish-to-chrome-web-store` job runs after packaging and calls the Chrome
Web Store Publish API via `chrome-webstore-upload-cli`.

## What "automated" means

- Dispatching the workflow with a version (e.g. `1.2.5`) triggers the pipeline.
- The workflow runs tests, builds the ZIP, creates the git tag and GitHub
  Release, then uploads the ZIP to your Chrome Web Store item and submits
  it for review.
- Tags and releases are only ever created by CI — never by hand — so every
  release is guaranteed to have gone through the full test + validate +
  publish pipeline.
- Google still reviews each submission (typically minutes to a few days).
  The API cannot skip review. Once approved, the new version goes live
  automatically.
- If the four `CWS_*` secrets below are missing, the publish job is skipped
  gracefully — the build and GitHub Release still run.

## One-time setup

You need to generate four values and add them to the repo as **GitHub Actions
secrets** (Settings → Secrets and variables → Actions → New repository secret):

| Secret name | What it is |
|-------------|------------|
| `CWS_EXTENSION_ID` | The extension's item ID |
| `CWS_CLIENT_ID` | Google OAuth 2.0 client ID |
| `CWS_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `CWS_REFRESH_TOKEN` | Long-lived OAuth refresh token for the CWS API |

### 1. Get the extension ID

From your developer console URL:

    https://chrome.google.com/webstore/devconsole/a74c76fc-f46d-44a6-8624-5b76ead25ca9
                                                  └─────────────── item ID ──────────────┘

Save this as `CWS_EXTENSION_ID`.

### 2. Generate `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`

Follow the canonical guide maintained by the author of
`chrome-webstore-upload-cli`:

**→ [github.com/fregante/chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys)**

It walks through:

1. Creating a Google Cloud project and enabling the Chrome Web Store API.
2. Creating an OAuth 2.0 Desktop client (yields `CLIENT_ID` and `CLIENT_SECRET`).
3. Running a one-time consent flow to mint a `REFRESH_TOKEN`.

The refresh token is long-lived **only if the OAuth consent screen is in
"Production" publishing status**. If it's left in "Testing", Google expires
the refresh token after **7 days** and the publish job starts failing with
`invalid_grant` (see [Refresh token expiring after 7 days](#refresh-token-expiring-after-7-days-invalid_grant)
below). Treat all three values as secrets.

## Cutting a release

Once secrets are configured:

1. Bump `manifest.json` version and update `CHANGELOG.md`, commit, push to `main`.
2. Go to the repo's **Actions** tab → **Release** workflow → **Run workflow**.
3. Enter the new version (e.g. `1.2.5`) and click **Run workflow**.

GitHub Actions will:

1. Run the unit + E2E tests (via `reusable-checks.yml`).
2. Validate that `manifest.json` version matches the input.
3. Refuse to proceed if `v<version>` already exists on the remote (forces a real bump).
3. Build and validate `dist/simple-tab-summarizer-v1.2.5.zip`.
4. Create and push the `v1.2.5` git tag.
5. Create a GitHub Release with the ZIP attached.
6. Upload the ZIP to the Chrome Web Store and submit it for review.

You'll get an email from Google when the review completes.

## Manual publish (fallback)

If you ever need to publish without touching CI, download the ZIP artifact
from the workflow run and upload it via the developer console.

## Rotating credentials

- **Refresh token compromised**: revoke it at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions),
  then regenerate via step 3 above and update `CWS_REFRESH_TOKEN`.
- **Client secret compromised**: create a new OAuth client in the Cloud Console,
  regenerate the refresh token against the new client, and update all three
  of `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`.

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| Job skipped with "credentials not configured" | One of the four `CWS_*` secrets is missing or empty |
| `invalid_grant` from OAuth | Refresh token expired (consent screen still in "Testing" → 7-day expiry), was revoked, or the client was deleted — [regenerate it](#refresh-token-expiring-after-7-days-invalid_grant) |
| `ITEM_NOT_UPDATABLE` | Previous submission is still in review — wait for it to complete |
| `ITEM_PENDING_REVIEW` | Item is currently under review; new upload rejected until it finishes |
| Version already exists | `manifest.json` version was not bumped before tagging |

See also: [Chrome Web Store Publish API docs](https://developer.chrome.com/docs/webstore/using-api).

### Refresh token expiring after 7 days (`invalid_grant`)

If the publish job fails at the `Fetching token...` step with:

```text
Error: Bad Request
response: { error: 'invalid_grant', error_description: 'Bad Request' }
```

…the `CWS_REFRESH_TOKEN` secret is no longer accepted by Google. The upload
never started — this is purely an auth failure. The most common cause is **not**
that anyone revoked the token: it's that the Google Cloud project's **OAuth
consent screen is still in "Testing" publishing status**, and Google expires
refresh tokens issued by Testing-mode clients after **7 days**. A token that
worked at the last release simply aged out.

**Permanent fix — move the consent screen to Production:**

1. Google Cloud Console → the project used for publishing → **APIs & Services →
   OAuth consent screen**.
2. If **Publishing status** is *Testing*, click **Publish app** → confirm to
   move it to *In production*. (For a Desktop client used only by you, no
   Google verification is required — the "unverified app" warning during the
   consent flow is expected and harmless.)
3. Regenerate the refresh token (next section). Tokens minted while the app is
   *In production* are long-lived and won't age out in 7 days.

**Regenerate `CWS_REFRESH_TOKEN`:**

1. (If the old token might be compromised) revoke it at
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
2. Re-run the one-time consent flow from
   [github.com/fregante/chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys)
   using the **same** `CLIENT_ID` / `CLIENT_SECRET` you already have. It opens a
   browser consent prompt and prints a fresh refresh token.
3. Update the repo secret: **Settings → Secrets and variables → Actions →
   `CWS_REFRESH_TOKEN` → Update secret** with the new value. Leave
   `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and `CWS_EXTENSION_ID` unchanged.
4. Re-run publishing. Because the git tag and GitHub Release for this version
   already exist, do **not** re-run the whole Release workflow (it refuses to
   reuse an existing tag). Instead either:
   - **Re-run only the failed job**: Actions → the failed Release run →
     **Re-run failed jobs**. This reuses the already-built ZIP artifact and
     retries just `publish-to-chrome-web-store`; or
   - **Publish manually**: download the `simple-tab-summarizer-v<version>.zip`
     artifact from the run and upload it in the Developer Dashboard.
