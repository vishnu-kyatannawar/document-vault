# Document Vault

A modern, installable **PWA** to store, view, download and share your personal
documents (IDs, licenses, PDFs, scans). Documents live in **your own Google
Drive** — there is no backend and no server that ever sees your files.

- 📱 Native-feeling mobile UI (Ionic + React)
- 🔐 Google sign-in, minimal `drive.file` scope (the app only sees what it creates)
- 📸 Add pages via camera, gallery, or file upload
- 🗂️ Multi-page documents (e.g. license **front + back**)
- 👁️ In-app viewer for images and PDFs
- 🟢 Open any document, page or folder directly in **Google Drive** — files are
  stored as-is (plain JPEG/PDF), never transformed or encrypted by the app
- ⬇️ Download and 🔗 share to WhatsApp (and any app) via the native share sheet
- ⚡ Offline app shell, installable to your home screen

Live at: `https://vishnu-kyatannawar.github.io/document-vault/`

---

## Security model

- **No secrets in the app.** The OAuth **Client ID is public** by design; there
  is **no client secret** anywhere in the bundle.
- **Minimal scope:** `https://www.googleapis.com/auth/drive.file` — the app can
  only read/write files **it created**. It can never see the rest of your Drive.
- **Your data, your Drive.** Files are stored in a `Document Vault` folder in
  your account, encrypted at rest by Google. Uninstalling the app doesn't touch
  them; you can browse them in Drive directly.
- **Sign-in is a redirect, not a popup.** The app sends the browser to
  `accounts.google.com` and Google sends it straight back with a short-lived
  access token (OAuth 2.0 implicit flow, no client secret, no backend). Because
  the visit to Google is a first-party navigation, it also works in installed
  home-screen apps on iOS/Android and in browsers that block third-party
  cookies — which is why the app no longer uses the Google Identity Services
  popup/iframe.
- **You stay signed in.** The access token (valid ~1 hour), its expiry and your
  name/email/avatar are cached in the app's `localStorage` so reopening the app
  is instant. When the token has expired the app bounces through Google
  silently (`prompt=none`) and comes back signed in — no tap needed as long as
  you're still signed in to Google. The cache is cleared on sign-out. The token
  only ever grants `drive.file` access, and the strict CSP below limits what any
  injected script could do with it.
- **CSP** restricts script/connect/frame to `self` + Google endpoints only.
- The Client ID is **origin-locked** to the GitHub Pages URL in Google Cloud, so
  it can't be reused from another site.

> Optional future upgrade (not enabled): client-side end-to-end encryption
> before upload. It maximises privacy but means files can't be viewed from the
> Drive UI and a lost passphrase = lost documents.

---

## One-time Google Cloud setup

You must create your own OAuth Client ID (free). It takes ~5 minutes.

1. Go to <https://console.cloud.google.com/> → **Create project** → name it
   `Document Vault`.
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create.
   - Fill app name + your email for support/developer contact.
   - **Scopes** → Add → select `.../auth/drive.file` (and `openid`, `email`,
     `profile`). `drive.file` is a **non-sensitive** scope, so no Google
     verification review is required.
   - **Test users** → add your own Google account (or **Publish** the app).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**:
     - `https://vishnu-kyatannawar.github.io`
     - `http://localhost:5173` (for local dev)
   - **Authorized redirect URIs** (must match exactly, trailing slash included):
     - `https://vishnu-kyatannawar.github.io/document-vault/`
     - `http://localhost:5173/document-vault/` (for local dev)
   - Create, then **copy the Client ID** (looks like
     `1234-abc.apps.googleusercontent.com`).

> If you see Google's **`redirect_uri_mismatch`** page when signing in, the
> redirect URI above is missing or differs from the app's URL. Add it and try
> again (it can take a minute to propagate).

---

## Run locally

```bash
pnpm install
cp .env.example .env          # then paste your Client ID into .env
pnpm dev                      # http://localhost:5173/document-vault/
```

Other scripts:

```bash
pnpm test        # unit tests (Vitest)
pnpm build       # type-check + production build into dist/
pnpm preview     # serve the production build locally
```

---

## Deploy to GitHub Pages

1. In the repo: **Settings → Pages → Build and deployment → Source =
   GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables → New variable**:
   - Name: `VITE_GOOGLE_CLIENT_ID`
   - Value: your Client ID.
3. Push to `main`. The workflow in
   [.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs tests,
   builds, and deploys automatically.

The build copies `index.html` → `404.html` so deep links / refreshes work on
GitHub Pages' static hosting.

---

## Architecture

```
Google OAuth (redirect) ──token──► authStore (localStorage cache)
                                       │ getAccessToken()
                                       ▼
                            driveClient (REST v3, fetch)
                                       ▼
                        documentsService (folder-per-document)
                                       ▼
                    documentsStore ──► Ionic React UI
```

- **Data layout in Drive:** a `Document Vault` root folder; groups are nested
  subfolders; each document is a subfolder named after its title; each
  page/part is the original image/PDF file inside it, with the label stored in
  the file's Drive `appProperties`. Document title, created date, expiry and
  reminder window live in the folder's `appProperties`; notes live in the
  folder's Drive `description`. Renaming a document or a page renames the Drive
  folder/file too, so the vault reads the same in the Drive app.
- **Open in Google Drive:** every id the app holds is a real Drive id, so
  "Open in Google Drive" links (document page header, group rows, profile
  sheet) are built locally and open Drive's own viewer in a new tab — or the
  Drive app on a phone.

See [src/](src/) for the code, and the tests in [tests/](tests/).
