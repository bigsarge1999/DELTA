/*
================================================================================
 WORK ORDER REAL-TIME STATUS LINK — ALL-IN-ONE REFERENCE
================================================================================
This is three pieces glued into one file for convenience. They run in three
different places, so you'll split them back out when you deploy:

  SECTION 1: firestore.rules        -> deploy with `firebase deploy --only firestore:rules`
  SECTION 2: createWorkOrderLink.js -> lives on your BACKEND (Cloud Function / Node server)
  SECTION 3: status.html            -> deploy to Firebase Hosting's public/ folder

They can't literally run as one script — Section 2 uses the Admin SDK with
your private credentials (never send that to a browser), and Section 3 is a
public webpage the customer's browser loads. Copy each section into its own
file at deploy time.
================================================================================
*/


/* ============================================================
   SECTION 1 — firestore.rules
   Save as: firestore.rules
   ============================================================

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Public work order status docs.
    // Document ID = the random token that's embedded in the customer's link.
    // Anyone with the exact token can READ their own order.
    // Nobody can list/query the collection, so orders can't be enumerated.
    match /publicWorkOrders/{token} {
      allow get: if true;      // anyone with the exact link can read
      allow list: if false;    // browsing/enumeration is blocked
      allow write: if false;   // only your backend (Admin SDK) can write
    }

    // Your internal, full work order data stays locked down as normal —
    // only authenticated staff can access it. Adjust to match your existing rules.
    match /workOrders/{orderId} {
      allow read, write: if request.auth != null;
    }
  }
}

   ============================================================ */


/* ============================================================
   SECTION 2 — createWorkOrderLink.js
   Save as: createWorkOrderLink.js
   Runs on: your backend only (Cloud Function or Node server with
   the Firebase Admin SDK). Never ship this file or its credentials
   to the browser.

   Usage:
     const { createStatusLink, updateStatus } = require('./createWorkOrderLink');
     const link = await createStatusLink({
       internalOrderId: 'WO-10293',
       customerName: 'Jane Doe',
       status: 'Scheduled',
       description: 'HVAC tune-up',
     });
     console.log(link); // https://yourapp.web.app/status.html?id=<token>
   ============================================================ */

const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// !!! CHANGE THIS to your actual Firebase Hosting domain or custom domain !!!
const BASE_URL = 'https://yourapp.web.app';

function generateToken() {
  // 24 random bytes -> 32-char base64url token. Effectively unguessable.
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Creates a new public status doc for a work order and returns the shareable link.
 * Call this once, when the work order is created.
 */
async function createStatusLink({ internalOrderId, customerName, status, description }) {
  const token = generateToken();

  await db.collection('publicWorkOrders').doc(token).set({
    internalOrderId,          // reference back to your real work order doc, staff-side only
    customerName,
    status,
    description: description || '',
    history: [
      { status, note: 'Work order created', at: admin.firestore.FieldValue.serverTimestamp() },
    ],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Optional: store the token back on your internal work order record
  // so you can look it up / regenerate the link later from your admin UI.
  await db.collection('workOrders').doc(internalOrderId).set(
    { publicToken: token },
    { merge: true }
  );

  return `${BASE_URL}/status.html?id=${token}`;
}

/**
 * Call this from wherever you already update work order status internally
 * (technician app, admin dashboard, etc.) so the customer's page updates live.
 */
async function updateStatus(token, newStatus, note = '') {
  await db.collection('publicWorkOrders').doc(token).update({
    status: newStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    history: admin.firestore.FieldValue.arrayUnion({
      status: newStatus,
      note,
      at: new Date(), // arrayUnion can't use serverTimestamp() inside array elements
    }),
  });
}

module.exports = { createStatusLink, updateStatus, generateToken };


/* ============================================================
   SECTION 3 — status.html
   Save as: status.html  (inside your Firebase Hosting public/ folder)
   Runs on: the customer's browser. Public page, no login required.

   ------------------------------------------------------------
   PASTE EVERYTHING BELOW THIS LINE INTO status.html AS-IS:
   ------------------------------------------------------------

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Work Order Status</title>
<style>
  :root {
    --paper: #F7F5F0;
    --ink: #1F2A24;
    --ink-soft: #5B6660;
    --rule: #D8D3C6;
    --accent: #B5622A;
    --accent-soft: #EFE0D3;
    --done: #3B6E52;
    --mono: 'Courier New', ui-monospace, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: Georgia, 'Times New Roman', serif;
    display: flex;
    justify-content: center;
    padding: 32px 16px 64px;
    min-height: 100vh;
  }
  .ticket {
    width: 100%;
    max-width: 560px;
    background: #fff;
    border: 1px solid var(--rule);
    box-shadow: 0 1px 0 var(--rule);
  }
  .ticket-head {
    padding: 28px 28px 20px;
    border-bottom: 1px dashed var(--rule);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .eyebrow {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .order-id {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--ink-soft);
    margin-top: 4px;
  }
  h1 {
    font-size: 22px;
    margin: 8px 0 0;
    font-weight: normal;
  }
  .status-pill {
    align-self: flex-start;
    font-family: var(--mono);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 6px 12px;
    border: 1px solid var(--accent);
    color: var(--accent);
    white-space: nowrap;
  }
  .status-pill.complete {
    border-color: var(--done);
    color: var(--done);
  }
  .body-section {
    padding: 24px 28px 28px;
  }
  .desc {
    color: var(--ink-soft);
    font-size: 15px;
    line-height: 1.5;
    margin: 0 0 28px;
  }
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    border-left: 2px solid var(--rule);
  }
  .timeline li {
    position: relative;
    padding: 0 0 22px 22px;
  }
  .timeline li:last-child { padding-bottom: 0; }
  .timeline li::before {
    content: '';
    position: absolute;
    left: -7px;
    top: 3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--paper);
    border: 2px solid var(--rule);
  }
  .timeline li.current::before {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .t-status {
    font-size: 15px;
    font-weight: bold;
  }
  .t-note {
    font-size: 13px;
    color: var(--ink-soft);
    margin-top: 2px;
  }
  .t-time {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-soft);
    margin-top: 4px;
  }
  .live-note {
    margin-top: 24px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-soft);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--done);
    display: inline-block;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  .state-msg {
    padding: 60px 28px;
    text-align: center;
    color: var(--ink-soft);
    font-family: var(--mono);
    font-size: 13px;
  }
  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none; }
  }
</style>
</head>
<body>

<div class="ticket" id="ticket">
  <div class="state-msg" id="loading">Looking up your work order…</div>
</div>

<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
  import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

  // TODO: replace with your project's config (Project settings > General > Your apps)
  const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT",
  };

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const ticketEl = document.getElementById('ticket');
  const params = new URLSearchParams(window.location.search);
  const token = params.get('id');

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function render(data) {
    const isComplete = /complete|done|closed/i.test(data.status || '');
    const history = (data.history || []).slice().sort((a, b) => {
      const ta = a.at?.toMillis ? a.at.toMillis() : new Date(a.at).getTime();
      const tb = b.at?.toMillis ? b.at.toMillis() : new Date(b.at).getTime();
      return tb - ta; // most recent first
    });

    ticketEl.innerHTML = `
      <div class="ticket-head">
        <div>
          <div class="eyebrow">Work Order</div>
          <div class="order-id">#${escapeHtml(token)}</div>
          <h1>${escapeHtml(data.customerName || 'Your Order')}</h1>
        </div>
        <div class="status-pill ${isComplete ? 'complete' : ''}">${escapeHtml(data.status || 'Pending')}</div>
      </div>
      <div class="body-section">
        ${data.description ? `<p class="desc">${escapeHtml(data.description)}</p>` : ''}
        <ul class="timeline">
          ${history.map((h, i) => `
            <li class="${i === 0 ? 'current' : ''}">
              <div class="t-status">${escapeHtml(h.status)}</div>
              ${h.note ? `<div class="t-note">${escapeHtml(h.note)}</div>` : ''}
              <div class="t-time">${formatTime(h.at)}</div>
            </li>
          `).join('')}
        </ul>
        <div class="live-note"><span class="dot"></span> Updates automatically — no need to refresh</div>
      </div>
    `;
  }

  if (!token) {
    ticketEl.innerHTML = `<div class="state-msg">This link is missing an order reference.<br>Please check the link and try again.</div>`;
  } else {
    const ref = doc(db, 'publicWorkOrders', token);
    onSnapshot(ref,
      (snap) => {
        if (!snap.exists()) {
          ticketEl.innerHTML = `<div class="state-msg">We couldn't find a work order for this link.<br>Please contact us if you think this is a mistake.</div>`;
          return;
        }
        render(snap.data());
      },
      (err) => {
        console.error(err);
        ticketEl.innerHTML = `<div class="state-msg">Something went wrong loading your order.<br>Please try again in a moment.</div>`;
      }
    );
  }
</script>

</body>
</html>

   ------------------------------------------------------------
   END OF status.html CONTENT
   ------------------------------------------------------------
   ============================================================ */
