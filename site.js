/* ForeverCatch: small features shared by every page.
   - "Share ForeverCatch" buttons ([data-share-site]): native share sheet when the
     browser has one, otherwise copy the link.
   - "Send feedback" buttons ([data-feedback]): a small form posted to /api/feedback.
   window.ForeverCatch.share(title, text, url) is also used by the results page. */
(function () {
  "use strict";

  const SITE_URL = "https://forevercatch.org/";

  function track(name) {
    if (typeof window.va === "function") window.va("event", { name: name });
  }

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(message) {
    let el = document.getElementById("fc-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "fc-toast";
      el.className = "toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }

  /* ---------------- sharing ---------------- */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Older browsers: copy from a temporary text box.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  async function share(title, text, url) {
    if (navigator.share) {
      try {
        await navigator.share({ title: title, text: text, url: url });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // the person closed the share sheet
      }
    }
    const full = text ? text + " " + url : url;
    if (await copyText(full)) toast(text ? "Copied to your clipboard" : "Link copied");
    else window.prompt("Copy this:", full);
  }

  document.querySelectorAll("[data-share-site]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      share("ForeverCatch",
        "What's hiding in your catch? Free, research-based PFAS estimates for U.S. freshwater fish.",
        SITE_URL);
      track("share_site");
    });
  });

  /* ---------------- feedback ---------------- */
  let dialog = null;

  function buildDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "feedback-dialog";
    dialog.setAttribute("aria-labelledby", "fb-title");
    dialog.innerHTML =
      '<form method="dialog" class="feedback-form" novalidate>' +
        '<div class="feedback-head">' +
          '<h2 id="fb-title">Send feedback</h2>' +
          '<button type="button" class="feedback-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<p class="feedback-intro">Found a bug, or have an idea? No account needed.</p>' +
        '<label for="fb-message">Your feedback</label>' +
        '<textarea id="fb-message" name="message" rows="5" maxlength="2000" required></textarea>' +
        '<label for="fb-email">Email <span class="optional">(optional, only if you want a reply)</span></label>' +
        '<input id="fb-email" name="email" type="email" maxlength="120" autocomplete="email">' +
        '<div class="fb-hp" aria-hidden="true"><label for="fb-website">Leave this empty</label>' +
          '<input id="fb-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>' +
        '<p class="feedback-status" role="status" aria-live="polite"></p>' +
        '<div class="feedback-actions">' +
          '<button type="submit" class="btn btn-primary">Send</button>' +
          '<button type="button" class="btn btn-link feedback-cancel">Cancel</button>' +
        '</div>' +
      '</form>';
    document.body.appendChild(dialog);

    const formEl = dialog.querySelector("form");
    const status = dialog.querySelector(".feedback-status");
    const close = function () { dialog.close(); };
    dialog.querySelector(".feedback-close").addEventListener("click", close);
    dialog.querySelector(".feedback-cancel").addEventListener("click", close);
    dialog.addEventListener("click", function (e) { if (e.target === dialog) close(); }); // backdrop

    formEl.addEventListener("submit", async function (e) {
      e.preventDefault();
      const message = formEl.message.value.trim();
      if (!message) {
        status.textContent = "Please write a message first.";
        formEl.message.focus();
        return;
      }
      const sendBtn = formEl.querySelector('button[type="submit"]');
      sendBtn.disabled = true;
      status.textContent = "Sending…";
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: message,
            email: formEl.email.value.trim(),
            website: formEl.website.value,
            page: location.pathname,
          }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        formEl.reset();
        status.textContent = "";
        dialog.close();
        toast("Thanks! Your feedback was sent.");
        track("feedback");
      } catch (err) {
        status.textContent = "Sorry, it didn't send. Please try again later.";
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  document.querySelectorAll("[data-feedback]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!window.HTMLDialogElement) return;
      if (!dialog) buildDialog();
      dialog.showModal();
      dialog.querySelector("textarea").focus();
    });
  });

  window.ForeverCatch = { share: share, toast: toast };
})();
