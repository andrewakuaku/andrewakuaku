# Andrew Akuaku — Portfolio

A static portfolio site in plain **HTML, CSS and JavaScript** — no build step, no framework.

- **`index.html`** — landing page (hero, featured work, mentorship teaser, contact form)
- **`portfolio.html`** — project grid + about/skills
- **`mentorship.html`** — mentorship offering, plans, and application form
- **`css/styles.css`** — all styling, including the signature **cutout-card** component
- **`js/main.js`** — mobile nav, scroll reveals, and form submission
- **`apps-script/Code.gs`** — Google Sheets backend for the forms

## Design

The card style is adapted from the *be* landing page: the **inverted-corner cutout** —
a pill CTA notched into a card corner, where the pill's panel is filled with the page
background and two small fillet SVGs bridge its edges so the notch reads as one smooth
concave curve. The palette was reworked to a neutral/modern indigo scheme
(`--accent: #4f46e5`); colors and fonts live in `:root` at the top of `css/styles.css`.

## Run locally

It's static — open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Connecting the forms to Google Sheets

The contact and mentorship forms post to a **Google Apps Script web app** that appends
rows to a Google Sheet. One Sheet holds both forms — each writes to its own tab
(`Contact`, `Mentorship`), named by the form's `data-sheet` attribute.

1. **Create a Sheet** at <https://sheets.new>. Give it any name.
2. **Open the script editor:** in the Sheet, *Extensions → Apps Script*.
3. **Paste the code:** replace the default `Code.gs` contents with `apps-script/Code.gs`
   from this repo, then save.
4. **Deploy:** *Deploy → New deployment → type "Web app"*.
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
   - Click **Deploy**, authorize when prompted, and copy the **Web app URL**
     (ends in `/exec`).
5. **Wire it up:** open `js/main.js` and set `SHEETS_ENDPOINT` to that URL.

Submit each form once — the tabs and header rows are created automatically from the
field names. To confirm the endpoint is live, open the `/exec` URL in a browser; it
should return `{"result":"success", ...}`.

> **Note on CORS:** the form is sent as `FormData` (not JSON), which avoids a CORS
> preflight, so submissions work from any static host. If you later switch to a JSON
> body you'll need to handle preflight separately.

### Re-deploying after edits

Apps Script keeps the same URL only if you update the **existing** deployment:
*Deploy → Manage deployments → (edit) → New version → Deploy*. Creating a brand-new
deployment gives a new URL you'd have to paste into `main.js` again.

### Pushing from this repo with `clasp`

The `apps-script/` directory is wired up for [clasp](https://github.com/google/clasp)
so you can edit `Code.gs` here and push it to script.google.com instead of
copy-pasting.

```sh
# one-time
npm install -g @google/clasp
clasp login                         # opens a browser; auth stored in ~/.clasprc.json

# every time you edit Code.gs
cd apps-script
clasp push                          # uploads Code.gs + appsscript.json
clasp deployments                   # find the deployment ID (one starting "AKfy…")
clasp redeploy <DEPLOYMENT_ID>      # bumps the existing /exec URL to the new version
```

`apps-script/.clasp.json` already points at the Sheets-bound script project, and
`apps-script/appsscript.json` is the local copy of the manifest. If you've
customised the server-side manifest (extra OAuth scopes, webapp settings, etc.),
run `clasp pull` once first so your local file matches before pushing.

## Spam protection (Google reCAPTCHA v3)

The forms use **invisible reCAPTCHA v3** (score-based) so submissions look
unchanged to humans but are scored 0.0–1.0 and rejected server-side below
0.5. The site key is hardcoded in `js/main.js` (it's public — same key the
source app uses); the **secret** lives in Apps Script as a Script Property
so it never reaches the browser.

1. In the Apps Script project (the same one bound to your Sheet), open
   *Project Settings* (gear icon).
2. Scroll to **Script properties** → **Add script property**.
3. Add: `Property = RECAPTCHA_SECRET`, `Value = <your reCAPTCHA v3 secret>`.
   (You can use the same secret the source app uses, or generate a new key
   pair at <https://www.google.com/recaptcha/admin>.)
4. Save. Verification kicks in immediately on the next deployment of
   `Code.gs` (or on the next request if you didn't change the script).

If the property is missing, verification is skipped (`ok: true,
reason: 'no-secret-configured'`) so local development still works.

## Connecting Stripe (paid memberships)

The community application form redirects to Stripe Checkout for paid tiers
after a successful submission to the Sheet. We use **Stripe Payment Links**
so no backend is needed — Stripe hosts the checkout, handles the subscription,
and sends webhooks to you.

1. **Create a recurring price** for each paid tier in the Stripe dashboard
   (*Products → + Add product*): one for `Graduates · $25/mo` and one for
   `Professionals · $50/mo`. Set the billing to **Recurring · monthly**.
2. From each product, **Create payment link** (the "Buy button" / link icon).
   Copy the resulting `https://buy.stripe.com/…` URL.
3. Open `js/main.js` and paste the URLs into `STRIPE_PAYMENT_LINKS`:
   ```js
   const STRIPE_PAYMENT_LINKS = {
     "Graduates: $25/mo":     "https://buy.stripe.com/your_graduates_link",
     "Professionals: $50/mo": "https://buy.stripe.com/your_professionals_link",
   };
   ```
4. The form appends `?prefilled_email=…&client_reference_id=…` to the URL
   when redirecting, so the Stripe checkout pre-fills the applicant's email
   and you can tie the Stripe customer back to the Sheet row.

Free (Students) tier skips Stripe entirely — the application is the whole flow.

## Deploy the site

Any static host works — GitHub Pages, Netlify, Vercel, Cloudflare Pages. For GitHub
Pages: push to a repo and enable Pages on the `main` branch root.
