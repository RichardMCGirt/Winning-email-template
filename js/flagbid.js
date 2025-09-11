(function EmailFlagOnClick(){
  // Avoid double-binding if this block gets injected twice
  if (window.__EmailFlagOnClickBound__) return;
  window.__EmailFlagOnClickBound__ = true;

  // --- CONFIG (re-use globals if present) ---
  const baseId  = window.baseId  || window.bidBaseName || "appK9gZS77OmsIK50";   // your base
  const tableId = window.tableId || window.bidTableName || "tblQo2148s04gVPq1";  // your "Bids" table
  const apiKey  = window.airtableApiKey || window.AIRTABLE_API_KEY || "patCnUsdz4bORwYNV.5c27cab8c99e7caf5b0dc05ce177182df1a9d60f4afc4a5d4b57802f44c65328";

  // Checkbox field names to try (first one that exists will be patched true)
  const checkboxCandidates = [
    "Used"
  ];

  // --- helpers ---
  const escapeForFormulaString = s => String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const buildEqFormula = (field, value) => `LOWER({${field}}) = LOWER("${escapeForFormulaString(value)}")`;

  async function listByBidName(name) {
    // Try common fields for bid name
    const nameFields = ["Bid Name","Job Name","Name","Bid","Record Name","Job","Opportunity Name"];
    for (const field of nameFields) {
      const formula = buildEqFormula(field, name);
      const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?` +
                  `filterByFormula=${encodeURIComponent(formula)}&maxRecords=10&pageSize=10`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      const txt = await res.text().catch(() => "");
      if (!res.ok) {
        // 422 => field doesn't exist; try next field
        if (res.status === 422) continue;
        throw new Error(`LIST failed (${res.status}): ${txt || res.statusText}`);
      }
      const data = JSON.parse(txt || "{}");
      if (Array.isArray(data.records) && data.records.length) {
        return { fieldMatched: field, records: data.records };
      }
    }
    return { fieldMatched: null, records: [] };
  }

  async function patchFields(recordId, fields) {
    const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}/${encodeURIComponent(recordId)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    });
    const txt = await res.text().catch(() => "");
    if (!res.ok) {
      const err = new Error(`PATCH ${recordId} failed (${res.status}): ${txt || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return JSON.parse(txt || "{}");
  }

  function getCurrentBidName() {
    // 1) Preferred: your autocomplete input
    const inputVal = document.querySelector('.bid-autocomplete-input')?.value?.trim();
    if (inputVal) return inputVal;

    // 2) Fallback: text already rendered into template
    const containerVal =
      document.querySelector('.bidNameContainer')?.textContent?.trim() ||
      document.querySelector('.subdivisionContainer')?.textContent?.trim();
    if (containerVal) return containerVal;

    // 3) Optional: global variable your app may set
    if (typeof window.selectedBidName === "string" && window.selectedBidName.trim()) {
      return window.selectedBidName.trim();
    }

    return "";
  }

  async function runEmailFlagPatch(bidName) {
    if (!bidName) {
      console.warn(`[EmailFlag] No bid name available from UI.`);
      return;
    }

    console.log(`[EmailFlag] Searching for bid "${bidName}"…`);
    const { fieldMatched, records } = await listByBidName(bidName);
    if (!fieldMatched || records.length === 0) {
      console.warn(`[EmailFlag] No records matched bid "${bidName}".`);
      return;
    }

    let patched = 0;
    for (const rec of records) {
      let ok = false;
      for (const fname of checkboxCandidates) {
        try {
          await patchFields(rec.id, { [fname]: true });
          console.log(`[EmailFlag] ✔ ${rec.id} set "${fname}" = true`);
          ok = true;
          break;
        } catch (e) {
          if (e.status === 422) {
            // field name not in this table; try next candidate
            continue;
          }
          throw e; // real error (permissions, etc.)
        }
      }
      if (!ok) {
        console.warn(`[EmailFlag] ${rec.id} matched but none of the checkbox candidates exist on this table. Add the field or adjust a name.`);
      } else {
        patched++;
      }
    }
    console.log(`[EmailFlag] Done. Patched ${patched} record(s) for "${bidName}".`);
  }

  // Bind to your existing button without disrupting other handlers
  function bindClick() {
    const btn = document.getElementById('sendSelectedEmails');
    if (!btn) {
      // Try again a bit later if DOM not ready yet
      setTimeout(bindClick, 300);
      return;
    }
    // Add a lightweight, non-blocking listener
    btn.addEventListener('click', () => {
      // Grab the bid name at click-time
      const bidName = getCurrentBidName();

      // Kick off patch async so it doesn't interfere with your popup flow
      Promise.resolve().then(() => runEmailFlagPatch(bidName))
        .catch(err => console.error('[EmailFlag] Unexpected error:', err));
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindClick);
  } else {
    bindClick();
  }

  // Expose for debugging, if helpful
  window.__EmailFlag = { getCurrentBidName, runEmailFlagPatch };
})();
