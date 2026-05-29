/**
 * Google Apps Script backend for the portfolio forms.
 *
 * It receives form POSTs and appends a row to a tab in the bound
 * Spreadsheet. The tab is named by the form's `formName` field
 * ("Contact" or "Mentorship"); a header row is created automatically
 * from the first submission's field names.
 *
 * Setup is in README.md → "Connecting the forms to Google Sheets".
 */

// ---------- config ----------
// Where notification emails go. Set this via a Script Property called
// NOTIFY_EMAIL — keeps personal addresses out of source control. If the
// property isn't set the script silently skips notifications so the form
// still works for sheet writes.
var NOTIFY_EMAIL = "";

// The Spreadsheet to write rows into. Set a Script Property named SHEET_ID
// to either (a) the bare Sheet ID, or (b) the full https://docs.google.com/
// spreadsheets/d/<ID>/edit URL — we extract the ID in case the URL was
// pasted by mistake. If the property is missing we fall back to
// getActiveSpreadsheet() for the bound-script case.
function getTargetSpreadsheet() {
  var raw = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  if (raw) {
    var match = /\/d\/([A-Za-z0-9_-]+)/.exec(raw);
    var id = match ? match[1] : String(raw).trim();
    return SpreadsheetApp.openById(id);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error("No spreadsheet configured. Set Script Property SHEET_ID to the target sheet ID, or run the script from a sheet-bound project.");
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var haveLock = false;
  try {
    // Lock acquisition inside the try so any quota / contention failure
    // returns a JSON error instead of leaving Apps Script to render an
    // opaque error page.
    lock.waitLock(20000);
    haveLock = true;

    // Stripe webhooks send JSON; portfolio forms send url-encoded. We
    // distinguish by content type and dispatch accordingly.
    if (e && e.postData && e.postData.contents) {
      var ctype = (e.postData.type || "").toLowerCase();
      if (ctype.indexOf("application/json") === 0) {
        return handleStripeEvent(e.postData.contents);
      }
    }

    var params = (e && e.parameter) ? e.parameter : {};

    // ---- reCAPTCHA v3 verification ----
    // Verifies the token sent with the form using the secret key stored as
    // a Script Property (RECAPTCHA_SECRET). If the secret isn't configured,
    // verification is skipped so the form keeps working in development.
    var captcha = verifyRecaptcha(params.recaptchaToken);
    if (!captcha.ok) {
      return json({ result: "error", message: "captcha-failed", reason: captcha.reason, score: captcha.score });
    }
    delete params.recaptchaToken; // don't store the token in the sheet

    var sheetName = params.formName || "Submissions";

    var ss = getTargetSpreadsheet();
    var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

    // Build/maintain the header row from the submitted field names.
    var fields = Object.keys(params).filter(function (k) {
      return k !== "formName";
    });

    var headers;
    if (sheet.getLastRow() === 0) {
      headers = fields;
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    } else {
      headers = sheet
        .getRange(1, 1, 1, sheet.getLastColumn())
        .getValues()[0];
      // Add any new columns we haven't seen before.
      fields.forEach(function (f) {
        if (headers.indexOf(f) === -1) {
          headers.push(f);
          sheet.getRange(1, headers.length).setValue(f).setFontWeight("bold");
        }
      });
    }

    var row = headers.map(function (h) {
      return params[h] !== undefined ? params[h] : "";
    });
    sheet.appendRow(row);

    // Email myself the submission. Wrapped so a delivery failure can't
    // make the form look broken to the visitor — the row is already saved.
    try {
      notify(sheetName, fields, params, sheet.getLastRow());
    } catch (notifyErr) {
      console.warn("notify failed: " + notifyErr);
    }

    return json({ result: "success" });
  } catch (err) {
    // Surface the stack trace too — Executions log shows it, and the JSON
    // body lets a developer eyeball what went wrong from the browser.
    return json({ result: "error", message: String(err), stack: err && err.stack });
  } finally {
    if (haveLock) lock.releaseLock();
  }
}

/** Simple GET so you can confirm the deployment is live in a browser. */
function doGet() {
  return json({ result: "success", message: "Portfolio forms endpoint is live." });
}

/**
 * Authorize the MailApp scope for this project and send a self-test email.
 * Pick this from the function dropdown in the Apps Script editor and click
 * "Run" once after adding the email-notification feature; the OAuth consent
 * screen will now include "Send email as you", and after you Allow it the
 * live /exec deployment can send mail on form submissions too.
 */
function testNotify() {
  notify("Test", ["name", "email", "message"], {
    name: "Self-test",
    email: NOTIFY_EMAIL,
    message: "If you got this email, MailApp is authorized and doPost can send notifications.",
  }, 2);
  console.log("Sent test notification to " + NOTIFY_EMAIL);
}

/**
 * Wrap the response as HtmlService instead of ContentService.
 * Background: Apps Script's POST response delivery via /macros/echo silently
 * drops ContentService responses for some script projects, returning a 405
 * "Sorry, unable to open the file" Drive page even when doPost ran fine.
 * HtmlService responses go through a different delivery path that works.
 * The client reads the body as text and parses JSON itself.
 */
function json(obj) {
  return HtmlService.createHtmlOutput(JSON.stringify(obj));
}

/**
 * Emails me a readable summary of a submission. Sender is the script
 * owner's account (Apps Script default), reply-to is the visitor's email
 * if they provided one — so I can hit Reply and answer them directly.
 */
function notify(sheetName, fields, params, rowNumber) {
  var to = PropertiesService.getScriptProperties().getProperty("NOTIFY_EMAIL") || NOTIFY_EMAIL;
  if (!to) return;

  // For paid memberships the subject calls out the tier so I know to
  // expect a Stripe payment too; everything else uses the sheet name.
  var subject;
  var membership = params.membership ? String(params.membership) : "";
  var tier = membership.split(":")[0].trim(); // "Graduates: $25/mo" → "Graduates"
  if (membership && membership.toLowerCase().indexOf("free") === -1) {
    subject = "[Portfolio] New " + tier + " application";
  } else if (membership) {
    subject = "[Portfolio] New " + tier + " application (free tier)";
  } else {
    subject = "[Portfolio] New " + sheetName + " submission";
  }

  // Pull a name and email out of the params, tolerating common casings so
  // we don't have to keep this list in sync with every form field.
  var nameKey  = pickKey(params, ["name", "fullName", "full_name"]);
  var emailKey = pickKey(params, ["email", "emailAddress", "email_address"]);
  var visitorName  = nameKey  ? String(params[nameKey]).trim()  : "";
  var visitorEmail = emailKey ? String(params[emailKey]).trim() : "";
  if (visitorName) subject += " — " + visitorName;

  // Plain-text body so the email reads fine in any client; the sheet URL
  // at the bottom jumps straight to the appended row.
  var ss = getTargetSpreadsheet();
  var sheetUrl = ss.getUrl() + "#gid=" + (ss.getSheetByName(sheetName) || ss.getActiveSheet()).getSheetId();
  if (rowNumber) sheetUrl += "&range=A" + rowNumber;

  var lines = [
    "Form: " + sheetName,
    "Received: " + new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
    "",
  ];
  fields.forEach(function (f) {
    var value = params[f];
    if (value === undefined || value === "") return;
    lines.push(humanise(f) + ": " + value);
  });
  lines.push("", "Open the row in the sheet: " + sheetUrl);

  var options = { name: "Portfolio Forms" };
  if (visitorEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(visitorEmail)) {
    options.replyTo = visitorEmail;
  }
  MailApp.sendEmail(to, subject, lines.join("\n"), options);
}

/** Find the first key in `keys` that exists on `params`. */
function pickKey(params, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (params[keys[i]] !== undefined) return keys[i];
  }
  return null;
}

/** "fullName" / "full_name" → "Full name", for friendlier email labels. */
function humanise(key) {
  return String(key)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, function (c) { return c.toUpperCase(); });
}

/**
 * Handles incoming Stripe webhook events. We can't read request headers
 * in Apps Script, so we can't verify the Stripe-Signature directly.
 * Instead we re-fetch the session from the Stripe API using the secret
 * key — if the session exists and is paid, the event is genuine.
 *
 * Requires Script Properties:
 *   STRIPE_SECRET_KEY  (sk_test_… or sk_live_…)
 */
function handleStripeEvent(bodyText) {
  var event;
  try { event = JSON.parse(bodyText); } catch (err) {
    return json({ result: "error", message: "invalid-json" });
  }
  if (!event || event.type !== "checkout.session.completed") {
    // Acknowledge unrelated events with 200 so Stripe stops retrying.
    return json({ result: "ignored", type: event && event.type });
  }

  var sessionId = event.data && event.data.object && event.data.object.id;
  if (!sessionId) return json({ result: "error", message: "no-session-id" });

  var verified = fetchStripeSession(sessionId);
  if (!verified.ok) {
    return json({ result: "error", message: "verify-failed", reason: verified.reason });
  }
  var session = verified.session;
  if (session.payment_status !== "paid") {
    return json({ result: "ignored", reason: "not-paid", status: session.payment_status });
  }

  // Match the application row by client_reference_id (we set this to the
  // applicant's email when redirecting to Stripe), falling back to the
  // customer_email Stripe captured at checkout.
  var matchEmail = (session.client_reference_id || session.customer_email || "").toLowerCase();
  if (!matchEmail) return json({ result: "error", message: "no-match-email" });

  var stamped = stampPaid(matchEmail, session);
  return json({ result: "success", stamped: stamped });
}

function fetchStripeSession(sessionId) {
  var key = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  if (!key) return { ok: false, reason: "no-secret-key" };
  var resp;
  try {
    resp = UrlFetchApp.fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), {
      method: "get",
      headers: { Authorization: "Bearer " + key },
      muteHttpExceptions: true,
    });
  } catch (err) {
    return { ok: false, reason: "fetch-failed" };
  }
  if (resp.getResponseCode() !== 200) {
    return { ok: false, reason: "stripe-" + resp.getResponseCode() };
  }
  try {
    return { ok: true, session: JSON.parse(resp.getContentText()) };
  } catch (err) {
    return { ok: false, reason: "stripe-bad-json" };
  }
}

/**
 * Find the most recent application row whose email matches and stamp a
 * `paidAt` (and `stripeSessionId`) column. Adds the columns if they
 * don't exist yet. Returns true if a row was updated, false otherwise.
 */
function stampPaid(email, session) {
  var ss = getTargetSpreadsheet();
  // Search every sheet; the applicant's row could be in Contact, Mentorship,
  // or whatever future sheetName the form uses.
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var emailCol = headers.indexOf("email") + 1;
    if (!emailCol) continue; // sheet doesn't track email

    var emails = sheet.getRange(2, emailCol, lastRow - 1, 1).getValues();
    // Walk bottom-up so we update the most recent application first.
    for (var r = emails.length - 1; r >= 0; r--) {
      if (String(emails[r][0]).trim().toLowerCase() !== email) continue;

      var paidAtCol = ensureColumn(sheet, headers, "paidAt");
      var sessionCol = ensureColumn(sheet, headers, "stripeSessionId");
      var rowNumber = r + 2;
      sheet.getRange(rowNumber, paidAtCol).setValue(new Date());
      sheet.getRange(rowNumber, sessionCol).setValue(session.id);
      return true;
    }
  }
  return false;
}

function ensureColumn(sheet, headers, name) {
  var idx = headers.indexOf(name);
  if (idx !== -1) return idx + 1;
  var col = headers.length + 1;
  sheet.getRange(1, col).setValue(name).setFontWeight("bold");
  headers.push(name); // keep the cached headers in sync
  return col;
}

/**
 * Verifies a reCAPTCHA v3 token with Google's siteverify endpoint.
 * Reads the secret from Script Properties → RECAPTCHA_SECRET.
 * Returns { ok, reason?, score? }. Skips verification gracefully if no
 * secret is configured (returns ok = true so dev/test flows still pass).
 */
function verifyRecaptcha(token) {
  var secret = PropertiesService.getScriptProperties().getProperty("RECAPTCHA_SECRET");
  if (!secret) return { ok: true, reason: "no-secret-configured" };
  if (!token) return { ok: false, reason: "missing-token" };

  var response;
  try {
    response = UrlFetchApp.fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "post",
      payload: { secret: secret, response: token },
      muteHttpExceptions: true,
    });
  } catch (err) {
    return { ok: false, reason: "fetch-failed" };
  }

  var data = {};
  try { data = JSON.parse(response.getContentText()); } catch (_) {}
  if (!data.success) return { ok: false, reason: "rejected", score: data.score };
  if (typeof data.score === "number" && data.score < 0.5) {
    return { ok: false, reason: "low-score", score: data.score };
  }
  return { ok: true, score: data.score };
}
