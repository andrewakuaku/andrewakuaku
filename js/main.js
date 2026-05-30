/* Shared site behaviour: mobile nav, scroll reveals, year stamp,
   and form submission to a Google Apps Script web app. */

// ---- mobile nav toggle ----
(function () {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => links.classList.toggle("open"));
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => links.classList.remove("open"))
    );
  }
})();

// ---- hide header on scroll down, reveal on scroll up ----
(function () {
  const header = document.querySelector(".site-header");
  if (!header) return;
  let lastY = window.scrollY;
  let ticking = false;

  function update() {
    const y = window.scrollY;
    const goingDown = y > lastY;
    // Stay visible near the top; hide only once scrolled past the header.
    if (goingDown && y > 80) {
      header.classList.add("is-hidden");
    } else if (!goingDown) {
      header.classList.remove("is-hidden");
    }
    // Past 40px the brand morphs from "Andrew Akuaku." to the AA mark; the
    // CSS handles the crossfade + scale transition.
    header.classList.toggle("is-condensed", y > 40);
    // Keep the menu closed while the bar is hidden.
    if (header.classList.contains("is-hidden")) {
      const links = header.querySelector(".nav-links");
      if (links) links.classList.remove("open");
    }
    lastY = y;
    ticking = false;
  }

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    },
    { passive: true }
  );
})();

// ---- scroll reveal ----
(function () {
  const items = document.querySelectorAll(".reveal");
  if (!items.length || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  items.forEach((el) => io.observe(el));
})();

/* ============================================================
   Drawer (reusable)
   ------------------------------------------------------------
   Define a drawer in markup:
     <div  class="drawer-backdrop" data-drawer-backdrop></div>
     <aside class="drawer" data-drawer="<id>"
            role="dialog" aria-modal="true" aria-hidden="true">
       <div class="drawer__head">
         …
         <button data-drawer-close aria-label="Close">×</button>
       </div>
       <div class="drawer__body">…</div>
     </aside>

   Open it from anywhere:
     <button data-drawer-open="<id>">Open</button>
     <a href="#<id>">Open</a>            (any link to a #id that
                                         matches a drawer opens it)

   One backdrop element is shared by all drawers on the page.
   Loading the page with #<id> in the URL auto-opens that drawer,
   so cross-page CTAs work in a single click.
   ============================================================ */
(function () {
  const backdrop = document.querySelector("[data-drawer-backdrop]");
  const drawers = document.querySelectorAll("[data-drawer]");
  if (!backdrop || !drawers.length) return;

  let lastTrigger = null;

  function getDrawer(id) {
    return document.querySelector(`[data-drawer="${id}"]`);
  }

  function openDrawer(id, trigger) {
    const drawer = getDrawer(id);
    if (!drawer) return;
    closeAll(false); // ensure only one open at a time
    lastTrigger = trigger || document.activeElement;
    drawer.classList.add("is-open");
    backdrop.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
    const first = drawer.querySelector(
      'input:not([type="hidden"]), select, textarea, button:not([data-drawer-close])'
    );
    if (first) first.focus();
  }

  function closeAll(restoreFocus = true) {
    let anyOpen = false;
    drawers.forEach((d) => {
      if (d.classList.contains("is-open")) anyOpen = true;
      d.classList.remove("is-open");
      d.setAttribute("aria-hidden", "true");
    });
    backdrop.classList.remove("is-open");
    backdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-locked");
    if (restoreFocus && anyOpen && lastTrigger && lastTrigger.focus) {
      lastTrigger.focus();
    }
    lastTrigger = null;
  }

  // Click handling: triggers, close buttons, and same-page anchor links
  // whose target matches a drawer id. If the trigger carries a
  // `data-membership` attribute, that value is written into the drawer's
  // `name="membership"` <select> after opening.
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-drawer-open]");
    if (trigger) {
      e.preventDefault();
      openDrawer(trigger.getAttribute("data-drawer-open"), trigger);
      applyMembershipFromTrigger(trigger);
      return;
    }
    if (e.target.closest("[data-drawer-close]")) {
      closeAll();
      return;
    }
    const link = e.target.closest('a[href*="#"]');
    if (link) {
      const samePage =
        link.pathname === location.pathname && link.host === location.host;
      const id = link.hash ? link.hash.slice(1) : "";
      if (samePage && id && getDrawer(id)) {
        e.preventDefault();
        openDrawer(id, link);
        applyMembershipFromTrigger(link);
      }
    }
  });

  function applyMembershipFromTrigger(trigger) {
    const value = trigger.getAttribute("data-membership");
    if (!value) return;
    // Set the membership select inside whichever drawer is currently open.
    const open = document.querySelector("[data-drawer].is-open");
    if (!open) return;
    const select = open.querySelector('select[name="membership"]');
    if (!select) return;
    // Match an existing option (exact match, or by tier name prefix).
    const opt = Array.from(select.options).find(
      (o) => o.value === value || o.text === value || o.text.startsWith(value.split(":")[0])
    );
    if (opt) select.value = opt.value || opt.text;
  }

  // Backdrop click + ESC close any open drawer.
  backdrop.addEventListener("click", () => closeAll());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && backdrop.classList.contains("is-open")) closeAll();
  });

  // Auto-open from the URL hash on load (e.g. /community.html#apply).
  if (window.location.hash) {
    const id = window.location.hash.slice(1);
    if (getDrawer(id)) requestAnimationFrame(() => openDrawer(id));
  }
})();

// ---- footer year ----
(function () {
  const y = document.querySelector("[data-year]");
  if (y) y.textContent = new Date().getFullYear();
})();

/* ============================================================
   FORM SUBMISSION → Google Apps Script
   Replace the URL below with your deployed web-app URL.
   See apps-script/Code.gs and README.md for setup.
   ============================================================ */
const SHEETS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbz28K1Yw4gje6zo8ahuvaky7FqvyvqME-m7QearIFFIS-YtxdbrriCMSqPLzCQyHNcO/exec";

/* ============================================================
   GOOGLE reCAPTCHA v3 (invisible, score-based)
   The same site key as the source app. The matching secret key
   lives in Apps Script as a Script Property (RECAPTCHA_SECRET)
   so it never touches the client. See README.md.
   ============================================================ */
const RECAPTCHA_SITE_KEY = "6Ld2WwMtAAAAAGjqqQRuceu-7oBsT_ny90mJQvQk";

async function getRecaptchaToken(action) {
  if (typeof grecaptcha === "undefined" || !grecaptcha.execute) return null;
  try {
    await new Promise((res) => grecaptcha.ready(res));
    return await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action });
  } catch (err) {
    console.warn("reCAPTCHA error:", err);
    return null;
  }
}

(function () {
  const forms = document.querySelectorAll("form[data-sheet]");

  forms.forEach((form) => {
    const status = form.querySelector(".form-status");
    const submitBtn = form.querySelector('[type="submit"]');

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors(form);

      if (!validate(form)) return;

      const original = submitBtn ? submitBtn.textContent : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending…";
      }
      setStatus(status, "", "");

      const payload = new FormData(form);
      payload.append("formName", form.dataset.sheet); // sheet/tab name
      payload.append("submittedAt", new Date().toISOString());

      // Attach a reCAPTCHA v3 token; Apps Script verifies it server-side.
      const token = await getRecaptchaToken(form.dataset.sheet || "submit");
      if (token) payload.append("recaptchaToken", token);

      try {
        if (SHEETS_ENDPOINT.includes("REPLACE_WITH_YOUR_DEPLOYMENT_ID")) {
          throw new Error("not-configured");
        }
        // The Apps Script web app's HtmlService response has no CORS
        // headers, so we send the request in no-cors mode: the browser
        // dispatches the POST fire-and-forget, the Sheet row is still
        // written + the email still sent server-side, but we can't read
        // the response body to see explicit error codes. Trade-off
        // accepted because Apps Script's ContentService (which would
        // carry CORS headers) has a delivery bug on this project that
        // returns 405 even for trivial responses.
        await fetch(SHEETS_ENDPOINT, {
          method: "POST",
          mode: "no-cors",
          body: payload,
        });
        // Treat dispatch as success; the server-side write is the source
        // of truth (you'll see the row in the Sheet either way).

        form.reset();
        setStatus(status, "Thanks! Your message is on its way. I'll be in touch soon.", "ok");
      } catch (err) {
        if (err.message === "not-configured") {
          setStatus(
            status,
            "Form backend isn't connected yet. Add your Apps Script URL in js/main.js (SHEETS_ENDPOINT).",
            "bad"
          );
        } else {
          setStatus(status, "Something went wrong sending that. Please try again or email me directly.", "bad");
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = original;
        }
      }
    });
  });

  function validate(form) {
    let ok = true;
    form.querySelectorAll("[required]").forEach((field) => {
      const value = (field.value || "").trim();
      let msg = "";
      if (!value) {
        msg = "This field is required.";
      } else if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        msg = "Enter a valid email address.";
      } else if (field.name === "linkedin" && !/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/.+/i.test(value)) {
        msg = "Enter a full LinkedIn URL (e.g. https://www.linkedin.com/in/your-handle).";
      }
      if (msg) {
        ok = false;
        showError(field, msg);
      }
    });
    return ok;
  }

  function showError(field, msg) {
    const slot = field.parentElement.querySelector(".error");
    if (slot) slot.textContent = msg;
    field.setAttribute("aria-invalid", "true");
  }

  function clearErrors(form) {
    form.querySelectorAll(".error").forEach((e) => (e.textContent = ""));
    form.querySelectorAll("[aria-invalid]").forEach((f) => f.removeAttribute("aria-invalid"));
  }

  function setStatus(node, msg, kind) {
    if (!node) return;
    node.textContent = msg;
    node.className = "form-status" + (kind ? " " + kind : "");
  }
})();
