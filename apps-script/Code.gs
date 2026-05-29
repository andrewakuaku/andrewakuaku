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
 * HtmlService responses are delivered reliably. The client uses no-cors
 * fetch so it can't read the body either way; the Sheet row is the source
 * of truth.
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

  // Community applications surface the tier in the subject so I know
  // at a glance which one they picked; everything else uses sheet name.
  var subject;
  var membership = params.membership ? String(params.membership).trim() : "";
  if (membership) {
    subject = "[Portfolio] New " + membership + " application";
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
