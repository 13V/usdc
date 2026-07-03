/*
 * pay.js — guest pay-page funnel (server-rendered card at /pay/:id/:name).
 *
 * Progressive enhancement over the static card: turns the one "pay $12" button
 * into the invisible-balance fund-and-pay flow. Money is always integer cents.
 *
 * Honest architecture note: the actual reference-tagged USDC transfer is signed
 * by the guest's invisible embedded wallet inside the Privy surface (/embedded).
 * This page owns everything up to signing — checking the balance, funding it via
 * MoonPay (respecting the provider minimum), watching for the top-up to land —
 * then pops the embedded surface for the single confirm and watches the bill
 * flip to paid. The wallet is never named "crypto"; to the friend it's just
 * "your divvy balance".
 */
(function () {
  "use strict";
  var P = window.__PAY__;
  if (!P) return;
  var flow = document.getElementById("flow");
  var btn = document.getElementById("payBtn");
  if (!flow || !btn) return;

  // ---- tiny helpers --------------------------------------------------------
  function token() {
    try {
      return localStorage.getItem("divvy.token");
    } catch (e) {
      return null;
    }
  }
  function money(cents) {
    return "$" + (cents / 100).toFixed(2);
  }
  function isIOS() {
    var ua = navigator.userAgent || "";
    return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function render(html) {
    flow.innerHTML = html;
  }
  function el(id) {
    return document.getElementById(id);
  }
  var timers = [];
  function clearTimers() {
    timers.forEach(function (t) {
      clearInterval(t);
      clearTimeout(t);
    });
    timers = [];
  }

  // MoonPay minimum honesty: work out what to actually buy on the card.
  function topUpPlan() {
    var withSpread = Math.ceil((P.share * 1.05) / 100) * 100; // +5%, ceil to $1
    var buyCents = Math.max(withSpread, P.moonpayMinCents);
    return {
      buyCents: buyCents,
      atMinimum: P.moonpayMinCents > withSpread,
      leftoverCents: Math.max(0, buyCents - P.share),
    };
  }

  // ---- states --------------------------------------------------------------
  function showChecking() {
    render('<div class="center"><div class="spin"></div><p class="muted">checking your balance…</p></div>');
  }

  function goEmbedded(msg) {
    render(
      '<div class="center"><div class="spin"></div><p class="muted">' +
        (msg || "setting up your divvy balance…") +
        "</p></div>"
    );
    setTimeout(function () {
      location.href = P.embeddedUrl;
    }, 500);
  }

  function showError(msg, onRetry) {
    if (btn) btn.disabled = false; // re-enable the underlying pay button on failure
    render('<div class="err">' + msg + '</div><button class="primary retry" id="retryBtn">try again</button>');
    var r = el("retryBtn");
    if (r) r.onclick = onRetry;
  }

  function showFund(balanceCents) {
    var plan = topUpPlan();
    var note = plan.atMinimum
      ? "minimum top-up is " +
        money(P.moonpayMinCents) +
        " — the extra " +
        money(plan.leftoverCents) +
        " stays in your balance for next time."
      : "we add a little to cover fees — whatever's left stays in your balance.";
    var have = balanceCents > 0 ? "you have " + money(balanceCents) + " so far. " : "";
    render(
      '<p class="reassure muted" style="margin-top:0">' +
        have +
        "let's get " +
        money(P.share) +
        " ready.</p>" +
        '<div class="fund-note" id="fundNote">' +
        note +
        "</div>" +
        '<button class="primary" id="fundBtn">get ' +
        money(plan.buyCents) +
        " ready</button>" +
        '<p class="reassure muted">pays with apple pay or a card. takes a few seconds.</p>'
    );
    el("fundBtn").onclick = function () {
      openMoonPay(plan.buyCents);
    };
  }

  function openMoonPay(buyCents) {
    var tok = token();
    render('<div class="center"><div class="spin"></div><p class="muted">opening secure checkout…</p></div>');
    fetch("/api/me/onramp/" + buyCents + (isIOS() ? "?applePay=1" : ""), {
      headers: tok ? { authorization: "Bearer " + tok } : {},
    })
      .then(function (r) {
        if (!r.ok) throw new Error("onramp");
        return r.json();
      })
      .then(function (d) {
        if (d && d.moonpay) {
          window.open(d.moonpay, "_blank", "noopener");
        }
        watchBalance();
      })
      .catch(function () {
        showError("we couldn't open checkout just now.", function () {
          openMoonPay(buyCents);
        });
      });
  }

  // Poll the wallet every 5s (up to 3 min) until the top-up lands, then pay.
  function watchBalance() {
    var tok = token();
    var deadline = Date.now() + 3 * 60 * 1000;
    render(
      '<div class="center"><div class="spin"></div>' +
        '<p class="muted">waiting for your ' +
        money(P.share) +
        " to land… this can take a minute.</p>" +
        '<button class="primary retry" id="checkNow" style="margin-top:8px">i\'ve paid — check now</button></div>'
    );
    var cn = el("checkNow");
    if (cn) cn.onclick = poll;
    function poll() {
      fetch("/api/me/wallet", { headers: tok ? { authorization: "Bearer " + tok } : {} })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (d) {
          if (d && typeof d.usdcCents === "number" && d.usdcCents >= P.share) {
            clearTimers();
            pay();
          } else if (Date.now() > deadline) {
            clearTimers();
            showError("your top-up hasn't landed yet. it can take a couple of minutes.", watchBalance);
          }
        })
        .catch(function () {
          /* transient — keep polling */
        });
    }
    timers.push(setInterval(poll, 5000));
  }

  // Funded: pop the embedded surface for the single reference-tagged transfer,
  // then watch the bill flip to paid.
  function pay() {
    window.open(P.embeddedUrl, "_blank", "noopener");
    showConfirming();
    watchBill();
  }

  function showConfirming() {
    render(
      '<div class="center"><div class="spin"></div>' +
        '<p class="muted">confirming your payment… ~5s</p>' +
        '<p class="muted" style="font-size:.8rem">finishing in the popup — you can close it once it\'s done.</p></div>'
    );
  }

  // Poll the (public) bill until this share reads paid → celebrate.
  function watchBill() {
    var deadline = Date.now() + 5 * 60 * 1000;
    function poll() {
      fetch("/api/bills/" + encodeURIComponent(P.id))
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (b) {
          if (!b || !b.participants) return;
          var me = b.participants.filter(function (x) {
            return x.name === P.name;
          })[0];
          if (me && me.paid) {
            clearTimers();
            success();
          } else if (Date.now() > deadline) {
            clearTimers();
            showError("still confirming — keep this page open, it'll update automatically.", function () {
              showConfirming();
              watchBill();
            });
          }
        })
        .catch(function () {
          /* transient — keep polling */
        });
    }
    timers.push(setInterval(poll, 3000));
    poll();
  }

  function success() {
    render(
      '<div class="success">' +
        '<div class="tick">✓</div>' +
        "<h2>paid! 🎉</h2>" +
        '<p class="muted">you paid ' +
        money(P.share) +
        " for " +
        escapeHtml(P.title || "the tab") +
        ".</p>" +
        '<button class="primary retry" id="receiptBtn" style="background:var(--mint);color:var(--ink);margin-top:6px">save receipt</button>' +
        '<a class="ghost" href="/">keep divvy for next time →</a>' +
        "</div>"
    );
    var rb = el("receiptBtn");
    if (rb) rb.onclick = function () {
      window.print();
    };
    confetti();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function confetti() {
    var colors = ["#2775CA", "#3DE8C7", "#FF6B5E", "#FFC65C"];
    for (var i = 0; i < 44; i++) {
      var d = document.createElement("div");
      d.className = "confetti";
      d.style.left = Math.random() * 100 + "vw";
      d.style.background = colors[i % colors.length];
      d.style.animationDuration = 1.6 + Math.random() * 1.4 + "s";
      d.style.animationDelay = Math.random() * 0.4 + "s";
      document.body.appendChild(d);
      (function (node) {
        setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node);
        }, 3600);
      })(d);
    }
  }

  // ---- entry ---------------------------------------------------------------
  function start() {
    clearTimers();
    if (btn) btn.disabled = true; // disable-on-flight so the pay button can't double-fire
    var tok = token();
    if (!tok) {
      // Brand-new friend with no divvy balance yet — create the invisible
      // wallet in the embedded surface, which also funds + pays there.
      goEmbedded();
      return;
    }
    showChecking();
    fetch("/api/me/wallet", { headers: { authorization: "Bearer " + tok } })
      .then(function (r) {
        if (r.status === 401) return { unauth: true };
        if (!r.ok) throw new Error("wallet");
        return r.json();
      })
      .then(function (d) {
        if (!d || d.unauth || !d.wallet) {
          goEmbedded();
          return;
        }
        if (typeof d.usdcCents !== "number") {
          showError("we couldn't reach your balance just now.", start);
          return;
        }
        if (d.usdcCents >= P.share) {
          pay();
        } else {
          showFund(d.usdcCents);
        }
      })
      .catch(function () {
        showError("we couldn't reach your balance just now.", start);
      });
  }

  btn.addEventListener("click", start);
})();
