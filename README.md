# Document Vault

A modern, installable **PWA** to store, view, download and share your personal
documents (IDs, licenses, PDFs, scans). Documents live in **your own Google
Drive** — there is no backend and no server that ever sees your files.

- 📱 Native-feeling mobile UI (Ionic + React)
- 🔐 Google sign-in, minimal `drive.file` scope (the app only sees what it creates)
- 📸 Add pages via camera, gallery, or file upload
- 🗂️ Multi-page documents (e.g. license **front + back**)
- 👁️ In-app viewer for images and PDFs
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
- **Tokens** are short-lived and kept **in memory only** (never in
  localStorage), refreshed silently by Google Identity Services.
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
   - Create, then **copy the Client ID** (looks like
     `1234-abc.apps.googleusercontent.com`).

> Note: Do **not** add an Authorized redirect URI — the token flow doesn't use one.

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
Google Identity Services ──token──► authStore (in-memory)
                                       │ getAccessToken()
                                       ▼
                            driveClient (REST v3, fetch)
                                       ▼
                        documentsService (folder-per-document)
                                       ▼
                    documentsStore ──► Ionic React UI
```

- **Data layout in Drive:** a `Document Vault` root folder; each document is a
  subfolder; each page/part is a file inside it, with the label stored in the
  file's Drive `appProperties`. Document title/category/date live in the
  folder's `appProperties`.

See [src/](src/) for the code, and the tests in [tests/](tests/).
