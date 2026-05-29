# Andrew Akuaku — Portfolio

A static portfolio site in plain **HTML, CSS, and JavaScript** — no build step, no framework. Forms are wired to a **Google Apps Script** backend that writes to a Sheet, emails me, and (optionally) marks paid memberships once Stripe sends the webhook.

---

## Table of contents

1. [Repository layout](#repository-layout)
2. [Run locally](#run-locally)
3. [How the forms work](#how-the-forms-work)
4. [Apps Script backend setup](#apps-script-backend-setup)
   - [One-time: bind a Sheet and configure properties](#one-time-bind-a-sheet-and-configure-properties)
   - [Optional: edit code locally with clasp](#optional-edit-code-locally-with-clasp)
5. [Spam protection (reCAPTCHA v3)](#spam-protection-recaptcha-v3)
6. [Paid memberships (Stripe)](#paid-memberships-stripe)
7. [Deploying the site](#deploying-the-site)
8. [Sensitive data — what's where](#sensitive-data--whats-where)

---

## Repository layout

```
.
├── index.html               # landing
├── portfolio.html           # project grid + skills filter
├── community.html           # community pitch + membership tiers + apply drawer
├── contact.html             # contact-page wrapper that opens a drawer form
├── thanks.html              # post-payment landing (Stripe redirect target)
├── project-*.html           # detail page per project (calhhs, mural, baobab,
│                            # hcl, be, drewq)
├── css/styles.css           # all styles, design tokens at the top
├── js/main.js               # mobile nav, scroll reveals, form submit, marquee
├── assets/
│   ├── photos/              # hero photography
│   └── projects/            # screenshots, project-specific videos
├── apps-script/
│   ├── Code.gs              # form handler + Stripe webhook (server-side)
│   ├── appsscript.json      # Apps Script manifest
│   └── .clasp.json.example  # template — copy to .clasp.json, paste scriptId
└── README.md
```

## Run locally

The site is static. Either open `index.html` directly, or serve the folder so relative imports (`/assets/`, `/css/`) resolve cleanly:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

The forms will hit the live Apps Script endpoint configured in `js/main.js → SHEETS_ENDPOINT` — so submissions from `localhost` write to the same Sheet as production. If you'd rather not pollute the real Sheet during development, point the constant at a separate test deployment.

## How the forms work

Two forms talk to one Apps Script Web App:

- **Contact** (`contact.html` drawer) — `data-sheet="Contact"` writes to a `Contact` tab.
- **Community application** (`community.html` drawer) — `data-sheet="Mentorship"` writes to a `Mentorship` tab and, for paid tiers, redirects to a Stripe Payment Link after the row is saved.

Both forms `POST` `multipart/form-data` to the `/exec` URL. Apps Script:

1. Verifies the **reCAPTCHA v3** token against Google's siteverify API (skipped silently if no secret is configured).
2. Picks (or creates) a tab named after the `formName` field.
3. Auto-maintains the header row from the field names — adding new columns as new fields appear.
4. Appends the submission as a new row.
5. Emails a human-readable summary to `NOTIFY_EMAIL`, with `Reply-To` set to the visitor's email so I can reply directly from Gmail.
6. Returns `{"result":"success"}` (or `{"result":"error", "message": "…"}`).

For a paid `Graduates` / `Professionals` application, `js/main.js` then redirects to the Stripe Payment Link with `?prefilled_email=<email>&client_reference_id=<email>`. After payment, Stripe POSTs `checkout.session.completed` back to the same `/exec` URL — Apps Script verifies the session via the Stripe API, finds the matching application row by email, and stamps `paidAt` + `stripeSessionId` columns on it.

## Apps Script backend setup

Everything below assumes you (or whoever's deploying) is the script owner. The deployment runs as the owner, so visitors never see an OAuth prompt.

### One-time: bind a Sheet and configure properties

1. **Create the Sheet** at <https://sheets.new>. Name it anything (e.g. *Portfolio submissions*). Copy its ID from the URL — it's the long string between `/d/` and `/edit`.
2. **Create the script project** at <https://script.google.com> → *New project*. Paste `apps-script/Code.gs` and `apps-script/appsscript.json` from this repo, or use `clasp push` (see below).
3. **Deploy as a Web app**: *Deploy → New deployment → Web app*.
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - Click **Deploy**, click through the "Google hasn't verified this app" warning (it's your own script, click *Advanced → Go to project (unsafe) → Allow*), and copy the `/exec` URL.
4. **Wire the URL into `js/main.js`** → `SHEETS_ENDPOINT`.
5. **Add Script Properties** in *Project Settings → Script Properties*:

   | Property             | Value                                                                                  | Required for                          |
   |----------------------|----------------------------------------------------------------------------------------|---------------------------------------|
   | `SHEET_ID`           | The bare ID, or the full Sheet URL — the script extracts the ID either way.            | All form writes                       |
   | `NOTIFY_EMAIL`       | Where notifications go (e.g. your gmail).                                              | Email-on-submit                       |
   | `RECAPTCHA_SECRET`   | reCAPTCHA v3 *secret* key from <https://www.google.com/recaptcha/admin>.               | Spam protection (skipped if missing)  |
   | `STRIPE_SECRET_KEY`  | `sk_test_…` (test mode) or `sk_live_…` (production).                                   | Stripe webhook → mark rows paid       |

6. **Trigger the OAuth scope grant** for sending email. From the editor, pick the `testNotify` function in the dropdown above the run button → **Run** → click through the "unverified" warning once → **Allow** (the new scope listed will be *"Send email as you"*). After this the deployment can send mail on form submissions too.

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

`.clasp.json` is gitignored — the scriptId stays local.

## Spam protection (reCAPTCHA v3)

The forms use **invisible reCAPTCHA v3** (score-based). On submit, `js/main.js` requests a token and ships it as `recaptchaToken`. Apps Script verifies it against `siteverify` with the secret, and rejects scores under 0.5 server-side.

The **site key** is hardcoded in `js/main.js` — it's public by design. The **secret key** lives only in Apps Script as the `RECAPTCHA_SECRET` Script Property. If that property isn't set, verification is skipped and the form still works (useful for local dev).

To use your own keys, generate a v3 pair at <https://www.google.com/recaptcha/admin>, swap the site key in `js/main.js`, and set the secret as the Script Property.

## Paid memberships (Stripe)

The community membership has three tiers (`community.html`):

| Tier            | Price         | Flow                                                              |
|-----------------|---------------|-------------------------------------------------------------------|
| Students        | Free          | Application → thank-you message. No Stripe.                       |
| Graduates       | $15 / month   | Application → Stripe Payment Link → `/thanks.html`.               |
| Professionals   | $25 / month   | Application → Stripe Payment Link → `/thanks.html`.               |

To enable the paid flow:

1. **Create products in Stripe** (Test mode first — toggle at the top of the dashboard).
   - *Products → Add product*. Set them up as **Recurring · monthly** at $15 and $25.
2. **For each product → Create payment link**.
   - In the link settings, set *After payment → Don't show confirmation page → Redirect customers to* → your site's `https://<your-domain>/thanks.html` (Stripe accepts http://localhost during development).
3. **Paste the two URLs into `js/main.js → STRIPE_PAYMENT_LINKS`**. The keys must match the membership labels:
   ```js
   const STRIPE_PAYMENT_LINKS = {
     "Graduates: $15/mo":     "https://buy.stripe.com/your_graduates_link",
     "Professionals: $25/mo": "https://buy.stripe.com/your_professionals_link",
   };
   ```
4. **Add the webhook endpoint** in Stripe → *Developers → Webhooks → Add endpoint*:
   - URL: your Apps Script `/exec` URL (same one the forms post to).
   - Events: just `checkout.session.completed`.
   - No signing-secret config needed — Apps Script re-fetches the session from the Stripe API to verify it, which is why `STRIPE_SECRET_KEY` is required.
5. **Test end-to-end** with Stripe's test card `4242 4242 4242 4242` (any future date / any CVC / any ZIP). You should see:
   - Redirect to `/thanks.html`
   - A new row in the *Mentorship* tab with `paidAt` and `stripeSessionId` columns populated within ~30s of payment.
   - A `[Portfolio] New Graduates application — Daisy Lee` email.
   - A Stripe receipt to the applicant.

When you're ready for real payments, flip the Stripe dashboard to Live mode, re-create the products + Payment Links + webhook there, swap `STRIPE_SECRET_KEY` to `sk_live_…`, and swap the URLs in `js/main.js`.

## Deploying the site

Any static host works — GitHub Pages, Netlify, Vercel, Cloudflare Pages. For GitHub Pages:

1. Push this repo to GitHub.
2. *Settings → Pages → Build and deployment: Deploy from a branch → main / root → Save.*
3. The site goes live within ~30 seconds at `https://<your-username>.github.io/<repo-name>/`. A custom domain can be set on the same page.

Every push to `main` redeploys automatically.

## Sensitive data — what's where

Public (safe to commit, served to every visitor anyway):

- `js/main.js` — `RECAPTCHA_SITE_KEY`, `SHEETS_ENDPOINT`, `STRIPE_PAYMENT_LINKS`. Public by design.
- HTML files — all copy and the reCAPTCHA site key.

Out of source control (kept in Apps Script Script Properties or the user's `$HOME`):

- `NOTIFY_EMAIL` — the inbox that receives notifications.
- `SHEET_ID` — the Sheet to write into.
- `RECAPTCHA_SECRET` — paired with the public site key.
- `STRIPE_SECRET_KEY` — `sk_test_…` / `sk_live_…`. Never paste into source.
- `apps-script/.clasp.json` — pointer to the script project. Gitignored; ship `.clasp.json.example`.
- `~/.clasprc.json` — clasp OAuth credentials. Lives in your home directory; gitignored as a safety net.

If you fork or copy this repo, the only "secret" that's hardcoded in the published JS is the reCAPTCHA *site* key — replace it with your own and the rest of the stack will use whatever Script Properties you set.
