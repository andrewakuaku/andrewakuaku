# Andrew Akuaku. Portfolio

A static portfolio site in plain **HTML, CSS, and JavaScript**. no build step, no framework. Forms are wired to a **Google Apps Script** backend that writes to a Sheet, emails me on submit, and emails applicants back when I approve or reject them from the Sheet. Lives at **[andrewakuaku.com](https://andrewakuaku.com)** (custom domain via the `CNAME` file).

---

## Table of contents

1. [Repository layout](#repository-layout)
2. [Run locally](#run-locally)
3. [How the forms work](#how-the-forms-work)
4. [Approval emails (the status column)](#approval-emails-the-status-column)
5. [Apps Script backend setup](#apps-script-backend-setup)
   - [One-time: bind a Sheet and configure properties](#one-time-bind-a-sheet-and-configure-properties)
   - [Wire up the approval trigger](#wire-up-the-approval-trigger)
   - [Optional: edit code locally with clasp](#optional-edit-code-locally-with-clasp)
6. [Spam protection (reCAPTCHA v3)](#spam-protection-recaptcha-v3)
7. [Deploying the site](#deploying-the-site)
8. [Sensitive data. what's where](#sensitive-data--whats-where)

---

## Repository layout

Pages use directory-based **clean URLs**. each page is an `index.html` inside a folder, so it's reachable at `/portfolio/`, `/community/`, etc. (no `.html` in the address bar).

```
.
├── index.html               # landing
├── portfolio/index.html     # project grid + skills filter
├── community/index.html     # community pitch + membership tiers + apply drawer
├── contact/index.html       # contact-page wrapper that opens a drawer form
├── project-*/index.html     # detail page per project (calhhs, mural, baobab,
│                            # hcl, be, drewq)
├── css/styles.css           # all styles, design tokens at the top
├── js/main.js               # mobile nav, scroll-hide header + brand morph,
│                            # scroll reveals, drawers, form submit, year stamp
├── favicon.svg              # the AA mark, served at /favicon.svg
├── CNAME                    # custom domain for GitHub Pages (andrewakuaku.com)
├── assets/
│   ├── photos/              # hero photography
│   ├── projects/            # screenshots + per-project videos
│   ├── logos/               # institution logos (asu, calhhs, knust, …)
│   └── logo/                # the AA brand mark, 4 colourways × 5 sizes (PNG)
├── apps-script/
│   ├── Code.gs              # form handler + approval emails (server-side)
│   ├── appsscript.json      # Apps Script manifest
│   └── .clasp.json.example  # template. copy to .clasp.json, paste scriptId
└── README.md
```

## Run locally

The site is static. Either open `index.html` directly, or serve the folder so the root-relative imports (`/assets/`, `/css/`, `/js/`) and clean URLs resolve cleanly:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

The forms will hit the live Apps Script endpoint configured in `js/main.js → SHEETS_ENDPOINT`. so submissions from `localhost` write to the same Sheet as production. If you'd rather not pollute the real Sheet during development, point the constant at a separate test deployment.

## How the forms work

Two forms talk to one Apps Script Web App:

- **Contact** (`index.html` and `contact/index.html` drawers). `data-sheet="Contact"` writes to a `Contact` tab.
- **Community application** (`community/index.html` drawer). `data-sheet="Community"` writes to a `Community` tab. The tier buttons (Apply as Student / Graduate / Professional) carry a `data-membership` value that pre-selects the matching option in the drawer's `membership` dropdown.

Both forms `POST` `multipart/form-data` to the `/exec` URL. Apps Script (`doPost`):

1. Takes a script lock so concurrent submissions don't clobber the header row.
2. Verifies the **reCAPTCHA v3** token against Google's siteverify API (skipped silently if no secret is configured; rejects scores under 0.5).
3. Picks (or creates) a tab named after the `formName` field.
4. Auto-maintains the header row from the field names. adding new columns as new fields appear, and reserving a `status` column on the far right.
5. Appends the submission as a new row.
6. Emails a human-readable summary to `NOTIFY_EMAIL`, with `Reply-To` set to the visitor's email so I can reply directly from Gmail.
7. Returns `{"result":"success"}` (or `{"result":"error", "message": "…"}`).

All three community tiers (Students, Graduates, Professionals) submit the same way. there's no payment step. The tier just goes into the Sheet row so I know which one the applicant picked.

> The client uses a `no-cors` fetch, so it can't read the response body. the Sheet row is the source of truth. `doPost` wraps its reply in `HtmlService` rather than `ContentService` because Apps Script silently drops `ContentService` POST responses for some projects (returns a 405 Drive page even when the write succeeded).

## Approval emails (the status column)

Every form tab gets a `status` column (added automatically on the next submission, with an **Approved / Rejected** dropdown applied to rows 2–1000). Toggling a cell to one of those values emails the applicant in that row:

- **Approved** → a welcome email. For Community applicants it includes the **WhatsApp group invite** matching their tier (links live in `WHATSAPP_LINKS` at the top of `Code.gs`. keyed by `students` / `graduates` / `professionals`).
- **Rejected** → a polite decline.

This runs off an **installable `onEdit` trigger** (`onEditApproval`) bound to the Spreadsheet, so it fires whether the cell is edited from the web UI, the mobile app, or another script. Re-setting a cell to the same value re-sends the email. that's intentional (resend on demand). See [Wire up the approval trigger](#wire-up-the-approval-trigger).

Handy editor functions for testing:

- `testNotify` — sends yourself the on-submit notification (also grants the MailApp scope).
- `testStatusEmail` — sends an approval/rejection email for a given row of the `Community` tab without touching the trigger. Edit `TEST_ROW` / `TEST_STATUS` at the top of the function first.

## Apps Script backend setup

Everything below assumes you (or whoever's deploying) is the script owner. The deployment runs as the owner, so visitors never see an OAuth prompt.

### One-time: bind a Sheet and configure properties

1. **Create the Sheet** at <https://sheets.new>. Name it anything (e.g. *Portfolio submissions*). Copy its ID from the URL. it's the long string between `/d/` and `/edit`.
2. **Create the script project** at <https://script.google.com> → *New project*. Paste `apps-script/Code.gs` and `apps-script/appsscript.json` from this repo, or use `clasp push` (see below).
3. **Deploy as a Web app**: *Deploy → New deployment → Web app*.
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - Click **Deploy**, click through the "Google hasn't verified this app" warning (it's your own script, click *Advanced → Go to project (unsafe) → Allow*), and copy the `/exec` URL.
4. **Wire the URL into `js/main.js`** → `SHEETS_ENDPOINT`. You can sanity-check a deployment by opening its `/exec` URL in a browser. `doGet` returns `{"result":"success","message":"Portfolio forms endpoint is live."}`.
5. **Add Script Properties** in *Project Settings → Script Properties*:

   | Property             | Value                                                                                  | Required for                          |
   |----------------------|----------------------------------------------------------------------------------------|---------------------------------------|
   | `SHEET_ID`           | The bare ID, or the full Sheet URL. the script extracts the ID either way.            | All form writes                       |
   | `NOTIFY_EMAIL`       | Where notifications go (e.g. your gmail). also the `Reply-To` on approval emails.     | Email-on-submit + approval emails     |
   | `RECAPTCHA_SECRET`   | reCAPTCHA v3 *secret* key from <https://www.google.com/recaptcha/admin>.               | Spam protection (skipped if missing)  |

6. **Trigger the OAuth scope grant** for sending email. From the editor, pick the `testNotify` function in the dropdown above the run button → **Run** → click through the "unverified" warning once → **Allow** (the new scope listed will be *"Send email as you"*). After this the deployment can send mail on form submissions too.

### Wire up the approval trigger

The approval/rejection emails need a Spreadsheet-bound `onEdit` trigger. it isn't created by deploying.

1. Open the Apps Script editor.
2. Pick **`installApprovalTrigger`** from the function dropdown → **Run**.
3. Authorize when prompted (one-time scope grant).

It's safe to run again. the function skips creation if an `onEditApproval` trigger already exists. Update the `WHATSAPP_LINKS` object in `Code.gs` with your own group invites before relying on the Approved email.

### Re-deploying after edits

Updating an **existing** Web App deployment keeps the same `/exec` URL:

*Deploy → Manage deployments → (pencil) → Version: New version → Deploy.*

Creating a brand-new deployment gives a brand-new URL you'd have to repaste into `js/main.js`. Don't do that unless you mean to.

### Optional: edit code locally with clasp

The `apps-script/` directory is set up for [clasp](https://github.com/google/clasp) so you can edit, version, and push from this repo instead of pasting into the script editor.

```sh
# one-time
npm install -g @google/clasp
clasp login                                  # browser OAuth; creds in ~/.clasprc.json
cp apps-script/.clasp.json.example apps-script/.clasp.json
# edit .clasp.json and paste your scriptId   (script.google.com URL contains it)

# every edit
cd apps-script
clasp push                                   # uploads Code.gs + appsscript.json
clasp deployments                            # list IDs
clasp redeploy <DEPLOYMENT_ID> -d "what changed"
# same /exec URL stays live; visitors don't need to do anything
```

`.clasp.json` is gitignored. the scriptId stays local.

## Spam protection (reCAPTCHA v3)

The forms use **invisible reCAPTCHA v3** (score-based). On submit, `js/main.js` requests a token and ships it as `recaptchaToken`. Apps Script verifies it against `siteverify` with the secret, and rejects scores under 0.5 server-side.

The **site key** is hardcoded in `js/main.js`. it's public by design. The **secret key** lives only in Apps Script as the `RECAPTCHA_SECRET` Script Property. If that property isn't set, verification is skipped and the form still works (useful for local dev).

To use your own keys, generate a v3 pair at <https://www.google.com/recaptcha/admin>, swap the site key in `js/main.js`, and set the secret as the Script Property.

## Deploying the site

Any static host works. GitHub Pages, Netlify, Vercel, Cloudflare Pages. This repo deploys via **GitHub Pages** with a custom domain (the `CNAME` file pins `andrewakuaku.com`):

1. Push this repo to GitHub.
2. *Settings → Pages → Build and deployment: Deploy from a branch → main / root → Save.*
3. The site goes live within ~30 seconds. With no custom domain it's served at `https://<your-username>.github.io/<repo-name>/`; the `CNAME` file (plus a DNS record at your registrar) points a custom domain at it instead.

Every push to `main` redeploys automatically.

## Sensitive data. what's where

Public (safe to commit, served to every visitor anyway):

- `js/main.js`. `RECAPTCHA_SITE_KEY`, `SHEETS_ENDPOINT`. Public by design.
- HTML files. all copy and the reCAPTCHA site key.

Out of source control (kept in Apps Script Script Properties or the user's `$HOME`):

- `NOTIFY_EMAIL`. the inbox that receives notifications.
- `SHEET_ID`. the Sheet to write into.
- `RECAPTCHA_SECRET`. paired with the public site key.
- `apps-script/.clasp.json`. pointer to the script project. Gitignored; ship `.clasp.json.example`.
- `~/.clasprc.json`. clasp OAuth credentials. Lives in your home directory; gitignored as a safety net.

Note: the WhatsApp invite links in `WHATSAPP_LINKS` (`Code.gs`) ride along in the committed script. they're not secrets exactly, but anyone with the file has the group links. rotate them in the WhatsApp admin if that matters to you.

If you fork or copy this repo, the only "secret" that's hardcoded in the published JS is the reCAPTCHA *site* key. replace it with your own and the rest of the stack will use whatever Script Properties you set.
