'use strict';
/* ==== VANIR bootstrap shims (safe to paste at top) ======================== */
(() => {
  // Make sure these utilities exist globally before anything else runs.
  if (typeof window.normalizeBid !== "function") {
    window.normalizeBid = function normalizeBid(s) {
      return typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
    };
  }

  if (typeof window.updateDataStatus !== "function") {
    window.updateDataStatus = function updateDataStatus(kind, text) {
      const el = document.getElementById("dataStatus");
      if (!el) return;
      el.textContent = text || "";
      // neutral / warn / error
      el.style.color = (kind === "warn") ? "#b54708"
                    : (kind === "error") ? "#b42318"
                    : "#667085";
    };
  }

  if (typeof window.setBtnBusy !== "function") {
    window.setBtnBusy = function setBtnBusy(btn, busy) {
      if (!btn) return;
      btn.disabled = !!busy;
      const orig = btn.getAttribute("data-orig-text") || btn.textContent || "Refresh Bids";
      if (!btn.getAttribute("data-orig-text")) btn.setAttribute("data-orig-text", orig);
      btn.textContent = busy ? "Refreshing…" : orig;
    };
  }

  // Expose the feature flag globally (so any handler can read it).
  // We want cache-only boot, so default false.
  if (typeof window.AUTO_FETCH_ON_LOAD === "undefined") {
    window.AUTO_FETCH_ON_LOAD = false;
  }
})();

(function __VANIR_FULL_REFACTOR__(){
  if (window.__VANIR_FULL_REFACTOR__) return;
  window.__VANIR_FULL_REFACTOR__ = true;

  // -----------------------------
  // Config
  // -----------------------------
  const CONFIG = {
    airtableRps: 4,
    airtableHost: 'api.airtable.com',
    verbose: false,
  };
  const dbg = (...a)=> CONFIG.verbose && console.log('[FULL]', ...a);

  // -----------------------------
  // Aggregated init (single startup)
  // -----------------------------
  const readyQueue = [];
  const AUTO_FETCH_ON_LOAD = false;

  const loadQueue  = [];
  const origDocAdd = Document.prototype.addEventListener;
  const origWinAdd = Window.prototype.addEventListener;

  function pushOnce(q, fn){ if (typeof fn==='function' && !q.includes(fn)) q.push(fn); }

  Document.prototype.addEventListener = function(type, listener, options){
    if (type === 'DOMContentLoaded' && typeof listener === 'function'){
      pushOnce(readyQueue, listener);
      if (!document.__full_ready_bound){
        document.__full_ready_bound = true;
        origDocAdd.call(document, 'DOMContentLoaded', ev => {
          dbg('running DOMContentLoaded handlers:', readyQueue.length);
          for (const fn of readyQueue) { try{ fn.call(document, ev); }catch(e){ console.error('[DOMContentLoaded]', e);} }
        }, options);
      }
      return;
    }
    return origDocAdd.call(this, type, listener, options);
  };

  Window.prototype.addEventListener = function(type, listener, options){
    if (type === 'load' && typeof listener === 'function'){
      pushOnce(loadQueue, listener);
      if (!window.__full_load_bound){
        window.__full_load_bound = true;
        origWinAdd.call(window, 'load', ev => {
          dbg('running window.load handlers:', loadQueue.length);
          for (const fn of loadQueue) { try{ fn.call(window, ev); }catch(e){ console.error('[window.load]', e);} }
        }, options);
      }
      return;
    }
    return origWinAdd.call(this, type, listener, options);
  };

  // -----------------------------
  // Global duplicate event-listener guard
  // -----------------------------
  (function dedupListeners(){
    const origAdd = EventTarget.prototype.addEventListener;
    const seen = new WeakMap();
    EventTarget.prototype.addEventListener = function(type, listener, options){
      try {
        const capture = (typeof options === 'boolean') ? options : !!(options && options.capture);
        const key = String(type)+'|'+String(capture)+'|'+String(listener && listener.toString && listener.toString());
        let map = seen.get(this);
        if (!map) { map = new Map(); seen.set(this, map); }
        if (map.has(key)) return; // skip duplicate
        map.set(key, true);
      } catch(_) {}
      return origAdd.call(this, type, listener, options);
    };
  })();

  // -----------------------------
  // fetchJSON with retry/backoff
  // -----------------------------
  async function fetchJSON(url, opts={}){
    const attempt = async (n) => {
      const res = await fetch(url, opts);
      if (!res.ok){
        const txt = await res.text().catch(()=>'');
        console.error('[fetchJSON]', res.status, res.statusText, url, txt.slice(0,500));
        if ((res.status === 429 || res.status >= 500) && n < 3){
          const ms = Math.min(2000*(n+1), 5000);
          await new Promise(r=>setTimeout(r, ms));
          return attempt(n+1);
        }
        const e = new Error(`HTTP ${res.status} ${res.statusText}`);
        e.status = res.status; e.url = url; e.body = txt;
        throw e;
      }
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      return ct.includes('application/json') ? res.json() : res.text();
    };
    return attempt(0);
  }
  window.fetchJSON = window.fetchJSON || fetchJSON;

  // -----------------------------
  // Airtable rate-limiter (wrap fetch)
  // -----------------------------
  (function throttleAirtable(){
    const orig = window.fetch.bind(window);
    const q = [];
    let ticking=false;
    const minMs = Math.max(250, Math.floor(1000/Math.max(1, CONFIG.airtableRps)));

    function pump(){
      if (!q.length) { ticking=false; return; }
      ticking=true;
      const job = q.shift();
      job().finally(()=> setTimeout(pump, minMs));
    }

    window.fetch = function(url, opts){
      try{
        const u = new URL(typeof url==='string' ? url : url.url, location.href);
        if (u.host === CONFIG.airtableHost){
          return new Promise((res, rej)=> {
            q.push(()=> orig(url, opts).then(res, rej));
            if (!ticking) pump();
          });
        }
      }catch(_){}
      return orig(url, opts);
    };
  })();

  // -----------------------------
  // VanirApp namespace (helpers & cache)
  // -----------------------------
  const VanirApp = window.VanirApp || (window.VanirApp = {});
  VanirApp.Utils = {
    debounce(fn, delay=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(this,a), delay); }; },
    escapeForAirtableFilter(s=''){ return String(s).replace(/\"/g,'\\\"'); },
    normalizeString(s){ return typeof s==='string' ? s.trim().toLowerCase() : ''; },
    getFieldStr(fields, key){ if(!fields||typeof fields!=='object')return''; const v=fields[key]; if(Array.isArray(v)) return v[0]??''; if(v==null) return''; return String(v); },
    getArrayOrEmpty(fields, key){ const v=fields?.[key]; if(Array.isArray(v)) return v; if(typeof v==='string'&&v) return [v]; return []; },
    setTextAll(sel, val){ document.querySelectorAll(sel).forEach(el=> el.textContent = val ?? ''); },
    deriveNameFromEmail(email){ if(!email||typeof email!=='string') return 'Unknown Name'; const [user]=email.split('@'); const [f,l]=(user||'').split('.'); if(!f||!l) return 'Unknown Name'; const cap=s=>s.charAt(0).toUpperCase()+s.slice(1); return `${cap(f)} ${cap(l)}`; },
    encodeQS(obj){ const q=new URLSearchParams(); Object.entries(obj||{}).forEach(([k,v])=>{ if(v) q.set(k,v);}); return q.toString(); },
    gmailLink({to,cc,bcc,subject,body}){ return `https://mail.google.com/mail/?view=cm&fs=1&${VanirApp.Utils.encodeQS({to,cc,bcc,su:subject,body})}`; },
    waitForElement(selector, timeout=5000){ return new Promise((resolve,reject)=>{ const start=Date.now(); (function check(){ const el=document.querySelector(selector); if(el) return resolve(el); if(Date.now()-start>timeout) return reject(new Error(`Timeout waiting for ${selector}`)); requestAnimationFrame(check); })(); }); },
  };

  VanirApp.Cache = {
    get(key, ttlMs){ try{ const raw=sessionStorage.getItem(key); const ts=Number(sessionStorage.getItem(key+':ts')); if(!raw||!ts) return null; if(Date.now()-ts>ttlMs) return null; return JSON.parse(raw);}catch{return null;} },
    set(key, val){ try{ sessionStorage.setItem(key, JSON.stringify(val)); sessionStorage.setItem(key+':ts', String(Date.now())); }catch{} },
    clear(keys){ (keys||[]).forEach(k=>{ sessionStorage.removeItem(k); sessionStorage.removeItem(k+':ts'); }); }
  };

  VanirApp.Airtable = {
    async fetchRecords(baseId, tableId, filterFormula='', pageSize=100){
      let all=[]; let offset=null;
      do{
        let url = `https://api.airtable.com/v0/${baseId}/${tableId}?pageSize=${pageSize}`;
        if (filterFormula) url += `&filterByFormula=${encodeURIComponent(filterFormula)}`;
        if (offset) url += `&offset=${offset}`;
        const res = await fetchJSON(url, { headers: { Authorization: `Bearer ${window.airtableApiKey || window.AIRTABLE_API_KEY || ''}`}});
        all = all.concat(res.records || []);
        offset = res.offset;
      } while (offset);
      return all;
    }
  };

  // Ensure global vendorData exists
  if (!('vendorData' in window)) window.vendorData = [];

  // Expose a single entry point if you ever want to call manually
  VanirApp.runInit = function(){ document.dispatchEvent(new Event('DOMContentLoaded')); };
})();
/* =========================
   BEGIN: ORIGINAL APP CODE
   (kept verbatim; do not modify to preserve behavior)
========================= */

// Required constants and helper functions
const airtableApiKey = 'patCnUsdz4bORwYNV.5c27cab8c99e7caf5b0dc05ce177182df1a9d60f4afc4a5d4b57802f44c65328';
const bidBaseName = 'appK9gZS77OmsIK50';
const bidTableName = 'tblQo2148s04gVPq1';
const viewId = "viwJrqe60OdxOUrpr";
const baseId = "appK9gZS77OmsIK50";
const tableId = "tblQo2148s04gVPq1";
const PAGE_SIZE = 100; // max allowed
let offset = null;
// --- Bridge constants to globals expected by fetchAllVendorData ---
window.AIRTABLE_API_KEY  = window.AIRTABLE_API_KEY  || airtableApiKey;

// Set these to the base/table that actually hold your Vendors.
// If your Vendors live in the same base as bids:
window.AT_VENDOR_BASE_ID  = window.AT_VENDOR_BASE_ID  || "appK9gZS77OmsIK50";  // Vendors base id
window.AT_VENDOR_TABLE_ID = window.AT_VENDOR_TABLE_ID || "tbllFcCzQfRATm6dI";  // Vendors table id (field "Name", email lookup)

// Ensure vendorData is declared before assignment/usage
let vendorData = [];


const subcontractorBaseName = 'applsSm4HgPspYfrg';
const subcontractorTableName = 'tblX03hd5HX02rWQu';
const VendorBaseName = 'appeNSp44fJ8QYeY5';
const VendorTableName = 'tblLEYdDi0hfD9fT3';
const gmLookupTable = 'tbl1vusOwDZQdXsWH';
const MAX_PROGRESS = 100;

let bidNameSuggestions = [];
let subcontractorSuggestions = []; // Stores { companyName, email } for mapping
let subcontractors = []; // Initialize an empty array for subcontractors
const session = {
  vendorData: [],
  currentVendorEmail: '',
};
const BID_CACHE_KEY = "cachedBidNames"; // localStorage key
const BID_CACHE_TS  = "cachedBidNamesTimestamp";
const BID_CACHE_TTL = 1000 * 60 * 30;   // 30 min

let subcontractorGmailLinks = [];
let vendoremail = '';
let lastProgress = 0;
let acmEmailGlobal = ''; // Store ACM email for later use

function getSharedFieldValues() {
    return {
        branch: document.querySelector('.branchContainer')?.textContent.trim() || 'Unknown Branch',
        subdivision: document.querySelector('.subdivisionContainer')?.textContent.trim() || 'Unknown Subdivision',
        builder: document.querySelector('.builderContainer')?.textContent.trim() || 'Unknown Builder',
        projectType: document.querySelector('.briqProjectTypeContainer')?.textContent.trim() || 'Default Project Type',
        materialType: document.querySelector('.materialTypeContainer')?.textContent.trim() || 'General Materials',
        anticipatedStartDate: document.querySelector('.anticipatedStartDateContainer')?.textContent.trim() || 'Unknown Start Date',
        numberOfLots: document.querySelector('.numberOfLotsContainer')?.textContent.trim() || 'Unknown Number of Lots',
        city: document.querySelector('.city')?.value?.trim() || '',
        cname: document.querySelector('.cname')?.value?.trim() || 'Unknown Customer Name',
        epace: document.querySelector('.epace')?.value?.trim() || 'Unknown Pace',
        acmName: document.querySelector('.acmNameContainer')?.textContent.trim() || 'Unknown ACM',
        sprice: document.querySelector('input[name="sprice"]:checked')?.value || 'Not Specified',
        poCustomer: document.querySelector('input[name="poCustomer"]:checked')?.value || 'Not Specified',
        gmEmail: document.querySelector('.gmEmailContainer')?.value || document.querySelector('.gmEmailContainer')?.textContent || 'Not Specified',
        gm: document.querySelector('.gmNameContainer')?.textContent.trim() || 'Unknown GM',
        vendorEmail: window.currentVendorEmail || 'Not Specified',
        vendorEmailWrapper: document.querySelector('.vendorEmailWrapper')
    };
}
async function fetchBidRecordsFromAirtable() {
  // Example: {Outcome}='Win' and a view; change to your real values if needed.
  const filter = "{Outcome}='Win'";
  // NOTE: Replace the following identifiers with your actual ones if they differ:
  const base  = (typeof bidBaseName  !== "undefined" ? bidBaseName  : baseId);
  const table = (typeof bidTableName !== "undefined" ? bidTableName : tableId);

  // fetchAirtableData(baseId, tableId, viewNameOrEmpty, filterFormula)
  return await fetchAirtableData(base, table, "", filter);
}
// ✅ Fetch ACM Full Name and Email by matching Title and Vanir Office
async function fetchACMName(branch) {
    try {
        const filterFormula = `AND({Title}='Area Construction Manager',{Vanir Office}='${branch}')`;
        const url = `https://api.airtable.com/v0/${bidBaseName}/${gmLookupTable}?filterByFormula=${encodeURIComponent(filterFormula)}`;

        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${airtableApiKey}`,
            },
        });

        if (!response.ok) {
            console.error(`❌ Error fetching ACM data: ${response.statusText}`);
            return;
        }

        const data = await response.json();
        const record = data.records[0];

       if (data.records.length > 0) {
    const names = [];
    const emails = [];

    data.records.forEach(record => {
        const name = record.fields['Full Name'];
        const email = record.fields['Email'];

        if (name) names.push(name);
        if (email) emails.push(email);
    });

    const joinedNames = names.join(', ').replace(/, ([^,]*)$/, ' and $1');
    const joinedEmails = emails.join(', ').replace(/, ([^,]*)$/, ' and $1');

    acmEmailGlobal = joinedEmails;

    document.querySelectorAll('.acmNameContainer').forEach(el => (el.textContent = joinedNames));
    document.querySelectorAll('.acmEmailContainer').forEach(el => (el.textContent = joinedEmails));

} else {
            console.warn("⚠️ No matching ACM record found for branch:", branch);
        }
    } catch (error) {
        console.error("❌ Error in fetchACMName:", error);
    }
}
function loadBidCache() {
  try {
    const raw = localStorage.getItem(BID_CACHE_KEY);
    const ts  = parseInt(localStorage.getItem(BID_CACHE_TS) || "0", 10);
    if (!raw) return { rows: [], savedAt: 0 };

    const arr = JSON.parse(raw) || [];
    // normalize + dedupe case-insensitive
    const normalized = arr.map(normalizeBid).filter(Boolean);
    const seen = new Set();
    const unique = [];
    for (const name of normalized) {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(name);
      }
    }
    return { rows: unique, savedAt: ts || 0 };
  } catch {
    return { rows: [], savedAt: 0 };
  }
}

function saveBidCache(rows) {
  try {
    const normalized = (rows || []).map(normalizeBid).filter(Boolean);
    const seen = new Set();
    const unique = [];
    for (const name of normalized) {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(name);
      }
    }
    localStorage.setItem(BID_CACHE_KEY, JSON.stringify(unique));
    localStorage.setItem(BID_CACHE_TS, Date.now().toString());
    return unique;
  } catch {
    return [];
  }
}

// --- Public API: hydrate from cache ONLY (no network) -----------------------
function hydrateBidSuggestionsFromCache() {
  const { rows, savedAt } = loadBidCache();
  bidNameSuggestions = rows.slice();
  if (rows.length) {
    const ts = new Date(savedAt || Date.now()).toLocaleTimeString();
    const stale = (Date.now() - (savedAt || 0)) > BID_CACHE_TTL;
    updateDataStatus(stale ? "warn" : "ok",
      stale
        ? `Showing cached bids • Last updated ${ts} • Click "Refresh Bids" to update`
        : `Loaded ${rows.length} bids  • Updated ${ts}`
    );
  } else {
    updateDataStatus("");
  }
}

function updateLoadingProgress(percentage) {
    const safePercentage = Math.min(100, Math.max(lastProgress, percentage));
    lastProgress = safePercentage;
    
    const loadingPercentage = document.getElementById("loadingPercentage");
    const loadingProgress = document.getElementById("loadingProgress");
    const loadingOverlay = document.getElementById("loadingOverlay");

    if (loadingPercentage) {
        loadingPercentage.textContent = `${safePercentage}%`;
    }

    if (loadingProgress) {
        loadingProgress.style.width = `${safePercentage}%`;
        loadingProgress.style.transition = "width 0.3s ease-in-out";
    }

    if (safePercentage === 100 && loadingOverlay) {
        setTimeout(() => {
            loadingOverlay.style.opacity = "0";
            setTimeout(() => {
                loadingOverlay.remove();
            }, 300);
        }, 500);
    }
}

// Display Loading Animation
function showLoadingAnimation() {
    const loadingOverlay = document.createElement("div");
    loadingOverlay.id = "loadingOverlay";
    loadingOverlay.innerHTML = `
        <div class="loading-content">
            <p>Fetching Winning Bids </p>
            <p id="loadingPercentage">0%</p>
            <div class="loading-bar">
                <div class="loading-progress" id="loadingProgress"></div>
            </div>
        </div>
    `;
    document.body.appendChild(loadingOverlay);
}

async function fetchAndUpdateAutocomplete() {
    showLoadingAnimation();
    await new Promise(resolve => setTimeout(resolve, 50));

    let progress = 0;
    updateLoadingProgress(progress);

    // Kick off both fetches in parallel (but don't await yet)
    const bidPromise = fetchBidNameSuggestions();
    const vendorPromise = fetchAllVendorData();

    // Immediately render UI shell
    const emailContainer = await waitForElement('#emailTemplate');

    const bidAutocompleteInput = createAutocompleteInput(
        "Enter Bid Name",
        [], // Empty for now, fill later
        "bid",
        fetchDetailsByBidName
    );
    emailContainer.prepend(bidAutocompleteInput);

    createVendorAutocompleteInput(); // Will hydrate once vendorData is ready

    // Progress 40% - UI in place
    progress = 40;
    updateLoadingProgress(progress);
  
    // Wait for bid data
    await bidPromise;
 
    // Inject bid data to input
    updateAutocompleteOptions("bid", bidNameSuggestions);

    progress = 70;
    updateLoadingProgress(progress);

    // Wait for vendor data
    await vendorPromise;
  
    updateVendorAutocompleteOptions(vendorData); // Optional if needed

    progress = 100;
    updateLoadingProgress(progress);
    hideLoadingAnimation();
}

function updateVendorAutocompleteOptions(vendors = []) {
    const input = document.querySelector(".vendor-autocomplete-input");
    const dropdown = document.querySelector(".vendor-autocomplete-dropdown");

    if (!input || !dropdown) {
        console.warn("⚠️ Vendor autocomplete elements not found.");
        return;
    }

    // Clear old dropdown
    dropdown.innerHTML = "";

    vendors.forEach(vendor => {
        const option = document.createElement("div");
        option.className = "vendor-autocomplete-option";
        option.textContent = vendor.name;

        option.addEventListener("click", () => {
            input.value = vendor.name;
            window.currentVendorEmail = vendor.email;
            document.querySelectorAll('.vendorNameContainer').forEach(el => el.textContent = vendor.name);
            document.querySelectorAll('.vendorEmailWrapper').forEach(el => el.textContent = ` <${vendor.email}>`);
            dropdown.innerHTML = '';
        });

        dropdown.appendChild(option);
    });

    dropdown.style.display = vendors.length > 0 ? 'block' : 'none';
}

function autoProgressLoading(stopConditionCallback) {
    let currentProgress = 0;
    const interval = setInterval(() => {
        const increment = Math.floor(Math.random() * 8) + 1;
        currentProgress = Math.min(99, currentProgress + increment); // don't go straight to 100%
        updateLoadingProgress(currentProgress);

        if (stopConditionCallback && stopConditionCallback()) {
            clearInterval(interval);
            updateLoadingProgress(100); // complete and remove overlay
        }
    }, 250);
}

function isBidInputVisible() {
    const input = document.querySelector('.bid-autocomplete-input');
    return input && input.offsetParent !== null;
}

function waitForBidInput(callback) {
    const observer = new MutationObserver(() => {
        if (isBidInputVisible()) {
            observer.disconnect();
            callback();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}

waitForBidInput(() => updateLoadingProgress(100));

// Call this to start the random progress
document.addEventListener('DOMContentLoaded', () => {
    autoProgressLoading(isBidInputVisible); 
    renderBidInputImmediately(); 
    displayEmailContent();
    monitorSubdivisionChanges();
    setupCopySubEmailsButton(); 
});
// Normalize bid name in Airtable filter: collapse whitespace + trim + lower
function buildBidNameEqualsFormula(normalizedBid) {
  // JS string needs "\\\\s+" to produce "\\s+" inside Airtable formula
  const norm = String(normalizedBid || "");
  const safe = (typeof escapeForAirtableFilter === "function")
    ? escapeForAirtableFilter(norm)
    : norm.replace(/"/g, '\\"');

  // AND({Outcome}='Win', normalized({Bid Name}) = normalized("input"))
  // REGEX_REPLACE collapses runs of whitespace, TRIM removes ends, LOWER ignores case
  return `AND(
    {Outcome}='Win',
    LOWER(TRIM(REGEX_REPLACE({Bid Name}, '\\\\s+', ' '))) = LOWER("${safe}")
  )`;
}

function updateAutocompleteOptions(type, newSuggestions = []) {
  const input = document.querySelector(`.${type}-autocomplete-input`);
  const dropdown = document.querySelector(`.${type}-autocomplete-dropdown`);

  if (!input || !dropdown) {
    console.warn(`⚠️ Autocomplete elements for "${type}" not found.`);
    return;
  }

  dropdown.innerHTML = '';
  const currentOptions = [];

  newSuggestions.forEach(suggestion => {
    const raw = typeof suggestion === 'string' ? suggestion : suggestion.companyName;
    const text = normalizeBid(raw); // <-- normalize here
    const option = document.createElement("div");
    option.classList.add(`${type}-autocomplete-option`, "autocomplete-option");
    option.textContent = text;

    option.addEventListener("click", () => {
      input.value = text;
      dropdown.innerHTML = '';
      if (typeof fetchDetailsByBidName === "function" && type === "bid") {
        fetchDetailsByBidName(text);
      }
    });

    dropdown.appendChild(option);
    currentOptions.push(option);
  });

  dropdown.style.display = newSuggestions.length > 0 ? "block" : "none";
}


function deriveNameFromEmail(email) {
    if (!email || typeof email !== "string") return "Unknown Name";

    const [namePart] = email.split("@");
    const [first, last] = namePart.split(".");
    if (!first || !last) return "Unknown Name";

    const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

    return `${capitalize(first)} ${capitalize(last)}`;
}

// Hide Loading Animation
function hideLoadingAnimation() {
    const loadingOverlay = document.getElementById("loadingOverlay");
    if (loadingOverlay) {
        loadingOverlay.remove();
    }
}

function addCitySpan() {
    const container = document.querySelector("#dynamicContainer"); // Parent container
    if (!container) {
        console.error("Container #dynamicContainer not found.");
        return;
    }
    const citySpan = document.createElement("span");
    citySpan.className = "city";
    container.appendChild(citySpan);
}
// Helper stays once in the file (you already have it above)
// Helper stays once in the file (you already have it above)
function getFirstScalar(val) {
  if (Array.isArray(val)) return val[0] ?? "";
  if (val == null) return "";
  return String(val);
}

async function fetchAllVendorData(opts = {}) {
  const force = !!opts.force;

  const CACHE_KEY = "cachedVendors";
  const CACHE_TS  = "cachedVendorsTimestamp";
  const MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24h

  // ✅ Read from cache if fresh
  try {
    const ts = Number(sessionStorage.getItem(CACHE_TS) || 0);
    const age = Date.now() - ts;
    if (!force && ts && age < MAX_AGE_MS) {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "[]");
      if (Array.isArray(cached) && cached.length) {
        window.vendorData = cached;
        // NEW: keep ID→vendor map even when hydrated from cache
        window.vendorById = Object.fromEntries(cached.map(v => [v.id, v]));
        try {
          VanirLoad.startTask('vendors');
          VanirLoad.pageArrived('vendors', cached.length, false);
          VanirLoad.done('vendors');
        } catch {}
        return cached;
      }
    }
  } catch (e) {
    console.warn("⚠️ Vendor cache read failed; will refetch.", e);
  }

  // One page fetcher
  async function _fetchPage({ baseId, tableId, offset }) {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${window.AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Airtable vendors list failed ${res.status}: ${msg}`);
    }
    return res.json();
  }

  // ✅ Respect your already-defined IDs
  const baseId  = window.AT_VENDOR_BASE_ID  || window.AT_BASE_ID || window.BASE_ID;
  const tableId = window.AT_VENDOR_TABLE_ID || "Vendors";
  if (!baseId || !tableId || !window.AIRTABLE_API_KEY) {
    console.error("❌ Missing Airtable vendor config (baseId/tableId/apiKey).");
    try { VanirLoad.startTask('vendors'); VanirLoad.done('vendors'); } catch {}
    return [];
  }

  let offset = undefined;
  const all = [];
  let page = 0;

  try { VanirLoad.startTask('vendors'); } catch {}

  do {
    page++;
    const data = await _fetchPage({ baseId, tableId, offset });
    const records = Array.isArray(data?.records) ? data.records : [];

    for (const r of records) {
      const f = r.fields || {};
      const name =
        getFirstScalar(f["Name"]) ||
        getFirstScalar(f["Vendor Name"]) ||
        getFirstScalar(f["Company"]) ||
        "";

      // tolerant to lookup/array emails
      const email =
        getFirstScalar(f["Vendor Email"]) ||
        getFirstScalar(f["Email"]) ||
        getFirstScalar(f["E-mail"]) ||
        getFirstScalar(f["Primary Email"]) ||
        "";

      all.push({
        id: r.id,
        name: String(name || "").trim(),
        email: String(email || "").trim(),
      });
    }

    try { VanirLoad.pageArrived('vendors', records.length, !!data?.offset); } catch {}
    offset = data?.offset;
  } while (offset);

  // de-dup
  const dedup = [];
  const seen = new Set();
  for (const v of all) {
    const key = v?.id || `${v?.name}::${v?.email}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedup.push(v);
  }

  // cache
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(dedup));
    sessionStorage.setItem(CACHE_TS, String(Date.now()));
  } catch (e) {
    console.warn("⚠️ Vendor cache write failed.", e);
  }

  // ✅ expose both list and ID→vendor map
  window.vendorData = dedup;
  window.vendorById = Object.fromEntries(dedup.map(v => [v.id, v]));

  try { VanirLoad.done('vendors'); } catch {}
  return dedup;
}



// Simple debounce
function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}

// Exact-match guard (normalize both)
function isExactSuggestionMatch(inputValue, suggestions) {
  const nval = (window.normalizeBid?.(inputValue) || "").toLowerCase();
  if (!nval) return false;
  if (!Array.isArray(suggestions) || !suggestions.length) return false;
  if (suggestions.length === 1) {
    return (window.normalizeBid?.(suggestions[0]) || "").toLowerCase() === nval;
  }
  return false;
}

document.getElementById("clearCacheBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("cachedBidNames");
    localStorage.removeItem("cachedBidNamesTimestamp");

    sessionStorage.removeItem("cachedBidNamesTimestamp");
    sessionStorage.removeItem("cachedVendors");
    sessionStorage.removeItem("cachedVendorsTimestamp");
    alert("📭 Session cache cleared. Refresh to fetch fresh data.");
});

function updateMultipleSpans(selector, value) {
    document.querySelectorAll(selector).forEach(el => {
        el.textContent = value || '';
    });
}

async function ensureDynamicContainerExists() {
    try {
        await waitForElement("#dynamicContainer");
        addCitySpan();
    } catch (error) {
        console.error("Error ensuring #dynamicContainer exists:", error.message);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    ensureDynamicContainerExists();
});

// Fetch data from Airtable with detailed logging and loading progress
async function fetchAirtableData(baseId, tableName, fieldName, filterFormula = '') {
    let allRecords = [];
    let offset = null;

    do {
        let url = `https://api.airtable.com/v0/${baseId}/${tableName}`;
        if (filterFormula) url += `?filterByFormula=${encodeURIComponent(filterFormula)}`;
        if (offset) url += `${filterFormula ? '&' : '?'}offset=${offset}`;

        try {
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${airtableApiKey}`,
                },
            });

            if (!response.ok) {
                console.error(`HTTP Error: ${response.status} - ${response.statusText}`);
                console.error(`Failed URL: ${url}`);
                return [];
            }

            const data = await response.json();
            allRecords = allRecords.concat(data.records);

            if (data.offset) {
            } else {
            }

            offset = data.offset; 
        } catch (error) {
          
            console.error(error);
            return [];
        }
    } while (offset);

    return allRecords;
}

function appendEmailsForSelectedBid(selectedBid) {
    
    if (!selectedBid) {
        console.error("❌ No bid selected.");
        return;
    }

    // Extract the first word from the selected bid
    const firstWord = selectedBid.split(/\s+/)[0].toLowerCase();

    if (!firstWord) {
        console.error("❌ Invalid bid name provided. Could not extract first word.");
        return;
    }

    // Filter vendor data to match the first word
    const matchingVendors = vendorData.filter(vendor =>
        vendor.name && vendor.name.toLowerCase().startsWith(firstWord)
    );

    if (matchingVendors.length > 0) {
        const emails = [];

        // Collect all primary and secondary emails
        matchingVendors.forEach((vendor, index) => {
            if (vendor.email) {
                emails.push(vendor.email);
            } else {
                console.warn(`⚠️ Vendor "${vendor.name}" has no email.`);
            }
        });

        // Ensure emails are unique
        const uniqueEmails = [...new Set(emails)];

        // Find or create the <p> and <span> container dynamically
        let ccContainer = document.querySelector('.cc-email-container');
        if (!ccContainer) {

            const emailSection = document.createElement('p');
            emailSection.innerHTML = `CC: <span class="cc-email-container"></span>`;
            document.body.appendChild(emailSection); // You might want to place this elsewhere
            ccContainer = emailSection.querySelector('.cc-email-container');
        }

        // Append emails to the container
        const existingEmails = ccContainer.textContent.split(/[\s,;]+/).filter(Boolean);
        const updatedEmails = [...new Set([...existingEmails, ...uniqueEmails])];

        ccContainer.textContent = updatedEmails.join(', ');

    } else {
        console.warn("⚠️ No matching vendors found for bid:", selectedBid);
    }
}

// Fetch "Bid Name" suggestions

// ============================================================================
// Bids: cache-aware + AdaptiveLoader page hooks (DROP-IN REPLACEMENT)
// ============================================================================
// ============================================================================
// Bids: cache-aware, view-scoped, force-able, with clear counts
// ============================================================================
async function fetchBidNameSuggestions(opts = {}) {
  const { force = false } = opts;

  const cacheKey = 'cachedBidNames';
  const cacheTimestampKey = 'cachedBidNamesTimestamp';
  const cacheTTL = 1000 * 60 * 30; // 30 minutes

  // If force is requested, ignore cache
  if (!force) {
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTime = localStorage.getItem(cacheTimestampKey);
    const isValidCache = cachedData && cachedTime && (Date.now() - parseInt(cachedTime, 10)) < cacheTTL;

    if (isValidCache) {
      const cached = JSON.parse(cachedData) || [];
      // Normalize + unique as before
      const seen = new Set();
      const unique = [];
      for (const name of (cached.map(normalizeBid).filter(Boolean))) {
        const key = name.toLowerCase();
        if (!seen.has(key)) { seen.add(key); unique.push(name); }
      }
      window.bidNameSuggestions = unique;

      // Mark task as complete from cache
      try {
        VanirLoad.startTask('bids');
        VanirLoad.pageArrived('bids', unique.length, false);
        VanirLoad.done('bids');
      } catch {}

      // Status explains counts are from cache
      updateDataStatus("ok", `Loaded ${unique.length} unique bids (cache)`);
      return { rawRecordCount: unique.length, uniqueNameCount: unique.length, fromCache: true };
    }
  }

  // Live fetch (view-scoped) with page visibility
  const base   = (typeof bidBaseName  !== "undefined" ? bidBaseName  : baseId);
  const table  = (typeof bidTableName !== "undefined" ? bidTableName : tableId);
  const filter = "{Outcome}='Win'";
  // If you have a viewId, include it so the API matches the view's count
  const viewParam = (typeof viewId === "string" && viewId) ? `&view=${encodeURIComponent(viewId)}` : "";

  try { VanirLoad.startTask('bids'); } catch {}

  let allRecords = [];
  let offset = null;
  do {
    let url = `https://api.airtable.com/v0/${base}/${table}?pageSize=100${viewParam}`;
    if (filter) url += `&filterByFormula=${encodeURIComponent(filter)}`;
    if (offset) url += `&offset=${offset}`;

    const response = await fetch(url, { headers: { Authorization: `Bearer ${airtableApiKey}` }});
    if (!response.ok) {
      console.error(`HTTP Error: ${response.status} - ${response.statusText}`);
      try { VanirLoad.done('bids'); } catch {}
      updateDataStatus("error", "Bids fetch failed — see console");
      return { rawRecordCount: 0, uniqueNameCount: 0, fromCache: false };
    }

    const data = await response.json();
    const pageRecs = Array.isArray(data.records) ? data.records : [];
    allRecords = allRecords.concat(pageRecs);

    // loader tick (per page)
    try { VanirLoad.pageArrived('bids', pageRecs.length, !!data.offset); } catch {}

    offset = data.offset || null;
  } while (offset);

  // Record count from the API (should align with your view now)
  const rawRecordCount = allRecords.length;

  // Normalize & de-dup the names for suggestions
  const normalized = (allRecords || [])
    .map(r => normalizeBid(r?.fields?.['Bid Name']))
    .filter(Boolean);

  const seen = new Set();
  const unique = [];
  for (const name of normalized) {
    const key = name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); unique.push(name); }
  }

  window.bidNameSuggestions = unique;
  localStorage.setItem(cacheKey, JSON.stringify(unique));
  localStorage.setItem(cacheTimestampKey, Date.now().toString());

  try { VanirLoad.done('bids'); } catch {}

  // ✅ Show BOTH numbers so it's clear why 2,780 ≠ 2,923
  updateDataStatus("ok", `Fetched ${rawRecordCount} records `);

  return { rawRecordCount, uniqueNameCount: unique.length, fromCache: false };
}


async function fetchSubcontractorSuggestions(branch) {
    if (!branch) {
        console.error("❌ Missing branch for subcontractor filtering.");
        return;
    }

    const filterFormula = `{Branch} = "${branch}"`;

    try {
        const records = await fetchAirtableData(
            subcontractorBaseName,
            subcontractorTableName,
            'Subcontractor Company Name, Subcontractor Email',
            filterFormula
        );

        subcontractorSuggestions = records
            .map(record => ({
                companyName: record.fields['Subcontractor Company Name'],
                email: record.fields['Subcontractor Email']
            }))
            .filter(suggestion => suggestion.companyName && suggestion.email);
    } catch (error) {
        console.error("❌ Error fetching subcontractor suggestions:", error);
    }
}
     
document.addEventListener("DOMContentLoaded", () => {
    const dynamicContainer = document.querySelector("#dynamicContainer");
    if (!dynamicContainer) {
        console.warn("#dynamicContainer is missing. Check HTML structure or DOM load timing.");
    }
});

function clearAllDynamicSpans() {
    const selectors = [
        '.gmNameContainer', '.gmEmailContainer', '.vendorNameContainer',
        '.vendorEmailWrapper', '.acmNameContainer', '.acmEmailContainer',
        '.branchContainer', '.builderContainer', '.subdivisionContainer',
        '.anticipatedStartDateContainer', '.materialTypeContainer',
        '.numberOfLotsContainer', '.briqProjectTypeContainer'
    ];
    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.textContent = '');
    });
}

function updateMultipleSpans(selector, value) {
    document.querySelectorAll(selector).forEach(el => {
        el.textContent = value || '';
    });
}

// ---------- helpers (paste these once) ----------
function escapeForAirtableFilter(s = "") {
  // Airtable filterByFormula needs inner quotes escaped
  return String(s).replace(/"/g, '\\"');
}

function normalizeString(s) {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function getFieldStr(fields, key) {
  // Returns a string for: undefined | "" | [] | ["val"] | "val"
  if (!fields || typeof fields !== "object") return "";
  const v = fields[key];
  if (Array.isArray(v)) return v[0] ?? "";
  if (v == null) return "";
  return String(v);
}

function getArrayOrEmpty(fields, key) {
  const v = fields?.[key];
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.length) return [v];
  return [];
}
// --- Robust vendor matching helpers ---
function __norm(s){ return (s||"").toString().trim().toLowerCase(); }
function __tokens(s){ return __norm(s).split(/\s+/).filter(Boolean); }
function __uniq(arr){ const seen=new Set(); return arr.filter(x=>{if(seen.has(x)) return false; seen.add(x); return true;}); }

function matchVendorsSmart(bidVendorName, vendors, branchText){
  const q = __norm(bidVendorName);
  if (!q || !Array.isArray(vendors)) return [];

  const qTokens = __tokens(q);

  // 1) exact (case-insensitive, trimmed)
  const exact = vendors.filter(v => __norm(v?.name) === q);
  if (exact.length) return exact;

  // 2) token-overlap (every token in q appears in vendor name tokens)
  //    e.g., "lansing" ⟹ matches "lansing building products"
  let tokenMatches = vendors.filter(v => {
    const vt = __tokens(v?.name);
    return qTokens.every(t => vt.includes(t));
  });

  // 3) if still empty, substring fallback
  if (!tokenMatches.length) {
    tokenMatches = vendors.filter(v => __norm(v?.name).includes(q) || __norm(v?.email).includes(q));
  }

  // 4) rank: token matches that start with q rank higher
  tokenMatches.sort((a,b)=>{
    const an = __norm(a?.name), bn = __norm(b?.name);
    const aStarts = an.startsWith(q) ? 1 : 0;
    const bStarts = bn.startsWith(q) ? 1 : 0;
    if (bStarts !== aStarts) return bStarts - aStarts;
    // then shorter names first (prefer "lansing" over "lansing building products" if both)
    return an.length - bn.length;
  });

  // 5) branch-aware narrowing but never drop to zero
  const branch = __norm(branchText);
  if (branch && tokenMatches.length > 1) {
    const narrowed = tokenMatches.filter(v =>
      __norm(v?.name).includes(branch) || __norm(v?.email).includes(branch)
    );
    if (narrowed.length) return __uniq(narrowed);
  }

  return __uniq(tokenMatches);
}

function getSelectedVendorEmail() {
  // Primary source: state set when user chooses a vendor
  const stateEmail = (window.currentVendorEmail || '').trim();

  if (stateEmail) return stateEmail;

  // Fallback: parse from the visible wrapper if present (e.g., " <name@domain>")
  const wrapper = document.querySelector('.vendorEmailWrapper');
  if (wrapper && wrapper.textContent) {
    const parsed = wrapper.textContent.replace(/[<>\s]/g, '').trim();
    if (parsed && parsed.includes('@')) return parsed;
  }

  return '';
}
function buildVendorSubject() {
  const bid = (document.querySelector('.bidNameContainer')?.textContent || '').trim();
  const branch = (document.querySelector('.branchContainer')?.textContent || '').trim();
  return bid ? `Vendor Pricing – ${bid} (${branch || 'Vanir'})` : 'Vendor Pricing Inquiry';
}

function buildVendorBody() {
  // If you already render a template body in the page, feel free to read it instead.
  const {
    branch,
    subdivision,
    builder,
    projectType,
    materialType,
    anticipatedStartDate,
    numberOfLots,
    city,
    gm,
    gmEmail
  } = typeof getSharedFieldValues === 'function' ? getSharedFieldValues() : {};

  const lines = [
    'Greetings from Vanir Installed Sales,',
    '',
    subdivision && builder
      ? `Vanir ${branch || ''} secured the ${subdivision} with ${builder}.`
      : `We’re reaching out regarding upcoming work.`,
    projectType && materialType
      ? `This is a ${projectType} project requiring ${materialType} installation.`
      : '',
    '',
    'Project Details:',
    anticipatedStartDate ? `- Anticipated Start Date: ${anticipatedStartDate}` : '',
    numberOfLots ? `- Number of Lots: ${numberOfLots}` : '',
    city ? `- Project Location: ${city}` : '',
    '',
    (gm && gmEmail) ? `Please coordinate with our GM, ${gm} at ${gmEmail}.` : '',
    '',
    'Best regards,',
    (document.querySelector('.userNameContainer')?.textContent || '').trim(),
    `Vanir Installed Sales ${branch || ''}`,
    'https://www.vanirinstalledsales.com'
  ];

  return lines.filter(Boolean).join('\n');
}

// Open Gmail compose with the vendor in the "to" field.
// If you need CC/BCC, set them below (e.g., GM/ACM, purchasing, etc.)
function openVendorEmailInGmail({ cc = '', bcc = '' } = {}) {
  const to = getSelectedVendorEmail();
  if (!to) {
    alert('Please select a vendor (no vendor email is set).');
    return;
  }

  const subject = buildVendorSubject();
  const body = buildVendorBody();

  // Use your existing gmailLink utility if present, otherwise build manually
  const url = (window.VanirApp && VanirApp.Utils && typeof VanirApp.Utils.gmailLink === 'function')
    ? VanirApp.Utils.gmailLink({ to, cc, bcc, subject, body }) // preferred
    : `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${cc ? `&cc=${encodeURIComponent(cc)}` : ''}${bcc ? `&bcc=${encodeURIComponent(bcc)}` : ''}`;

  window.open(url, '_blank', 'noopener,noreferrer');
}

// Optional: wire a button with id="vendorEmailBtn"
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('vendorEmailBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      // Example: CC the GM automatically (optional)
      const gmCc = (document.querySelector('.gmEmailContainer')?.textContent || '').trim();
      openVendorEmailInGmail({ cc: gmCc });
    });
  }
});
// ---------- SAFE replacement for fetchDetailsByBidName ----------
async function fetchDetailsByBidName(bidNameInput) {
  try {
    const bidNameRaw = typeof bidNameInput === "string"
      ? bidNameInput
      : (bidNameInput?.companyName || bidNameInput?.text || "");

    // ✅ Normalize aggressively (trim + collapse spaces)
    const bidName = normalizeBid(bidNameRaw);
    if (!bidName) {
      console.warn("⚠️ fetchDetailsByBidName called without a bid name.");
      return {};
    }

    if (typeof clearAllDynamicSpans === "function") {
      clearAllDynamicSpans();
    }

    // ✅ whitespace-tolerant equality formula
    const filterFormula = buildBidNameEqualsFormula(bidName);

    const records = await fetchAirtableData(
      typeof bidBaseName !== "undefined" ? bidBaseName : baseId,
      typeof bidTableName !== "undefined" ? bidTableName : tableId,
      "",
      filterFormula
    );

    if (!Array.isArray(records) || records.length === 0) {
      console.warn("❌ No records returned for bid:", bidName);
      return {};
    }

    // Prefer exact (case-insensitive), fallback to first
    const exact = records.find(r => normalizeBid(r?.fields?.["Bid Name"]).toLowerCase() === bidName.toLowerCase());
    const chosen = exact || records[0];
    const fields = chosen?.fields || {};

    // --- unpack fields you use elsewhere ---
    const builder               = getFieldStr(fields, "Builder") || "Unknown Builder";
    const gmEmailRaw            = getArrayOrEmpty(fields, "GM Email");
    const gmEmail               = gmEmailRaw[0] || "Branch Staff@Vanir.com";
    const branch                = getFieldStr(fields, "Branch") || "Unknown Branch";
    const projectType           = getFieldStr(fields, "Project Type");
    const materialType          = getFieldStr(fields, "Material Type");
    const numberOfLots          = getFieldStr(fields, "Number of Lots");
    const anticipatedStartDate  = getFieldStr(fields, "Anticipated Start Date");
    const anticipatedDuration   = getFieldStr(fields, "Anticipated Duration");
    const materialsNeeded       = getFieldStr(fields, "Materials Needed");
    const acmEmail              = getFieldStr(fields, "Field's Email");
    const gmNamed               = getFieldStr(fields, "GM Named");
    const gm                    = gmNamed || (typeof deriveNameFromEmail === "function" ? deriveNameFromEmail(gmEmail) : "");

    if (branch && typeof fetchSubcontractorSuggestions === "function") {
      await fetchSubcontractorSuggestions(branch);
      if (typeof updateSubcontractorAutocomplete === "function") {
        updateSubcontractorAutocomplete();
      }
    }

    // ---------- VENDOR RESOLUTION (linked IDs first, then name match) ----------
    const vendors     = window.vendorData || [];
    const vendorById  = window.vendorById || {};
    const branchText  = (document.querySelector(".branchContainer")?.textContent || "");
    const linkedIds   = getArrayOrEmpty(fields, "Vendor Pricing to Use?"); // linked-record field → array of recIDs
    let resolvedVendor = null;

    // A) If a linked ID exists, resolve by ID immediately
    if (Array.isArray(linkedIds) && linkedIds.length) {
      const recId = String(linkedIds[0] || "");
      if (recId && vendorById[recId]) {
        resolvedVendor = vendorById[recId];
        renderVendorChosen(resolvedVendor.name || "", resolvedVendor.email || "");
        console.log("[vendor-match]", { bidVendor: recId, branchText, found: [resolvedVendor.name || "(by id)"] });
      }
    }

    // B) If unresolved (no ID or not found), try name-based matching
    if (!resolvedVendor) {
      // Some bases also store a text helper; try to read it if present
      const vendorRawText = getFieldStr(fields, "Vendor Pricing to Use? (Name)") ||
                            getFieldStr(fields, "Vendor Pricing to Use Text") ||
                            getFieldStr(fields, "Vendor Pricing to Use?") || ""; // may be 'rec...' but matcher will handle gracefully

      const matches = matchVendorsSmart(vendorRawText, vendors, branchText);

      if (matches.length === 1) {
        const m = matches[0];
        resolvedVendor = m;
        renderVendorChosen(m?.name || "", m?.email || "");
      } else if (matches.length > 1) {
        if (typeof renderMatchingVendorsToDropdown === "function") {
          renderMatchingVendorsToDropdown(matches);
        }
        renderVendorChosen("", ""); // show Change/Search/Clear actions
      } else {
        if (typeof renderMatchingVendorsToDropdown === "function") {
          renderMatchingVendorsToDropdown(vendors); // let user pick from full list
        }
        renderVendorChosen("", "");
      }

      console.log("[vendor-match]", {
        bidVendor: vendorRawText,
        branchText,
        found: (matches || []).map(v=>v.name)
      });
    }
    // ---------- /vendor resolution ----------

    // UI updates you already do
    if (typeof updateMultipleSpans === "function") {
      updateMultipleSpans(".gmNameContainer", gm);
      updateMultipleSpans(".gmEmailContainer", gmEmail);
      updateMultipleSpans(".acmEmailContainer", acmEmail);
    } else {
      document.querySelectorAll(".gmNameContainer").forEach(el => el.textContent = gm);
      document.querySelectorAll(".gmEmailContainer").forEach(el => el.textContent = gmEmail || "");
      document.querySelectorAll(".acmEmailContainer").forEach(el => el.textContent = acmEmail || "");
    }

    if (typeof updateTemplateText === "function") {
      updateTemplateText(
        getFieldStr(fields, "Bid Name") || bidName,
        builder,
        gmEmail,
        branch,
        projectType,
        materialType,
        numberOfLots,
        anticipatedStartDate,
        resolvedVendor?.name || getFieldStr(fields, "Vendor Pricing to Use?") || "",
        anticipatedDuration,
        gm
      );
    }

    return {
      builder,
      gmEmail,
      branch,
      projectType,
      materialType,
      numberOfLots,
      anticipatedStartDate,
      vendorRaw: resolvedVendor?.name || "",
      AnticipatedDuration: anticipatedDuration,
      gm
    };
  } catch (err) {
    console.error("❌ Error in fetchDetailsByBidName:", err);
    return {};
  }
}





function showVendorSelectionDropdown(vendorMatches) {
  const host = document.getElementById("vendorEmailContainer");
  if (!host) { console.error("No #vendorEmailContainer found."); return; }

  // Remove any previous dropdown
  host.querySelector(".vendor-select-dropdown")?.remove();

  // Build wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "vendor-select-dropdown";
  wrapper.style.position = "relative";
  wrapper.style.border = "1px solid #ddd";
  wrapper.style.borderRadius = "8px";
  wrapper.style.padding = "10px";
  wrapper.style.background = "#fff";
  wrapper.style.maxHeight = "320px";
  wrapper.style.overflow = "auto";
  wrapper.style.boxShadow = "0 6px 18px rgba(0,0,0,.08)";
  wrapper.style.marginTop = "8px";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search vendor…";
  searchInput.style.width = "100%";
  searchInput.style.marginBottom = "10px";
  searchInput.style.padding = "8px";
  searchInput.style.border = "1px solid #ddd";
  searchInput.style.borderRadius = "6px";

  const list = document.createElement("div");

  function renderList(items) {
    list.innerHTML = "";
    if (!items.length) {
      list.innerHTML = "<p style='margin:8px 0;color:#666;'>No matching vendors found.</p>";
      return;
    }
    items.forEach(vendor => {
      const option = document.createElement("div");
      option.className = "vendor-select-option";
      option.style.cursor = "pointer";
      option.style.padding = "8px 4px";
      option.style.borderBottom = "1px solid #f0f0f0";
      option.innerHTML = `<strong>${vendor.name || ""}</strong><br><small>${vendor.email || ""}</small>`;
      option.addEventListener("click", () => {
        window.currentVendorEmail = vendor.email || "";
        document.querySelectorAll(".vendorNameContainer").forEach(el => el.textContent = vendor.name || "");
        document.querySelectorAll(".vendorEmailWrapper").forEach(el => el.textContent = vendor.email ? ` <${vendor.email}>` : "");
        wrapper.remove(); // now valid
      });
      list.appendChild(option);
    });
  }

  // Initial render + search binding
  renderList(Array.isArray(vendorMatches) ? vendorMatches : []);
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = (vendorMatches || []).filter(v =>
      (v.name || "").toLowerCase().includes(q) || (v.email || "").toLowerCase().includes(q)
    );
    renderList(filtered);
  });

  wrapper.appendChild(searchInput);
  wrapper.appendChild(list);
  host.appendChild(wrapper);
}

function renderMatchingVendorsToDropdown(matchingVendors) {
  // 1) Get the dropdown first (avoid TDZ)
  const dropdown = document.querySelector('.vendor-autocomplete-dropdown');
  if (!dropdown) {
    console.error("Dropdown container not found.");
    return;
  }

  // 2) Clear and build header
  dropdown.innerHTML = '';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.padding = '6px 10px';
  header.style.borderBottom = '1px solid #eee';

  const title = document.createElement('strong');
  title.textContent = 'Matches';

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.textContent = 'Search all vendors';
  allBtn.style.padding = '4px 8px';
  allBtn.style.border = '1px solid #ddd';
  allBtn.style.borderRadius = '6px';
  allBtn.style.background = '#fff';
allBtn.onclick = () => showVendorSelectionDropdown(window.vendorData || []);

  header.appendChild(title);
  header.appendChild(allBtn);
  dropdown.appendChild(header);

  // 3) Empty state
  if (!Array.isArray(matchingVendors) || matchingVendors.length === 0) {
    const empty = document.createElement('p');
    empty.style.margin = '8px 10px';
    empty.style.color = '#666';
    empty.textContent = 'No matching vendors found.';
    dropdown.appendChild(empty);
    dropdown.style.display = 'block';
    return;
  }

  // 4) Options
  matchingVendors.forEach(vendor => {
    const option = document.createElement('div');
    option.className = 'vendor-autocomplete-option';
    option.style.cursor = 'pointer';
    option.style.padding = '8px 10px';
    option.style.borderBottom = '1px solid #eee';

    const email = vendor.email
      ? `<br><small>${vendor.email}</small>`
      : `<br><small style="color:gray;">(no email)</small>`;

    option.innerHTML = `<strong>${vendor.name || ''}</strong>${email}`;

    option.addEventListener('click', () => {
      renderVendorChosen(vendor.name || '', vendor.email || '');
      dropdown.innerHTML = '';       // close dropdown
      dropdown.style.display = 'none';
    });

    dropdown.appendChild(option);
  });

  dropdown.style.display = 'block';
}

// Open a vendor picker. If list is omitted, show ALL vendors.
function openVendorPicker(list) {
  const pool = Array.isArray(list) && list.length ? list : (window.vendorData || []);
  if (!pool.length) {
    console.warn("No vendor data loaded yet.");
    return;
  }
  // Reuse your dropdown renderer or the larger panel as you prefer:
  // Always use big searchable panel for manual picking
  if (typeof showVendorSelectionDropdown === "function") {
    showVendorSelectionDropdown(pool);
 } else if (typeof renderMatchingVendorsToDropdown === "function") {
    renderMatchingVendorsToDropdown(pool);
  }
}

// Render chosen vendor + attach "Change", "Search all", and "Clear"
function renderVendorChosen(name, email) {
  document.querySelectorAll(".vendorNameContainer").forEach(el => el.textContent = name || "");
  document.querySelectorAll(".vendorEmailWrapper").forEach(el => el.textContent = email ? ` <${email}>` : "");

  window.currentVendorEmail = email || "";

  // Controls host
  const host = document.getElementById("vendorEmailContainer") || document.querySelector(".vendorEmailWrapper")?.parentElement;
  if (!host) return;

  // Remove previous controls if any
  host.querySelector(".vendor-actions")?.remove();

  // Build action bar
  const bar = document.createElement("div");
  bar.className = "vendor-actions";
  bar.style.display = "flex";
  bar.style.flexWrap = "wrap";
  bar.style.gap = "8px";
  bar.style.marginTop = "6px";

  const btnChange = document.createElement("button");
  btnChange.type = "button";
  btnChange.textContent = "Change vendor";
  btnChange.className = "btn-secondary";
  btnChange.style.padding = "6px 10px";
  btnChange.style.border = "1px solid #ddd";
  btnChange.style.borderRadius = "8px";
  btnChange.style.background = "#fff";
  btnChange.onclick = () => openVendorPicker();

const btnSearchAll = document.createElement("button");
btnSearchAll.type = "button";
btnSearchAll.textContent = "Search all vendors";
btnSearchAll.className = "btn-secondary";
btnSearchAll.style.padding = "6px 10px";
btnSearchAll.style.border = "1px solid #ddd";
btnSearchAll.style.borderRadius = "8px";
btnSearchAll.style.background = "#fff";
btnSearchAll.style.display = "none";
btnSearchAll.onclick = () => showVendorSelectionDropdown(window.vendorData || []);


  const btnClear = document.createElement("button");
  btnClear.type = "button";
  btnClear.textContent = "Clear";
  btnClear.className = "btn-tertiary";
  btnClear.style.padding = "6px 10px";
  btnClear.style.border = "1px solid #eee";
  btnClear.style.borderRadius = "8px";
  btnClear.style.background = "#fafafa";
  btnClear.onclick = () => {
    renderVendorChosen("", "");
    // Optionally reopen picker immediately:
    openVendorPicker();
  };

  bar.appendChild(btnChange);
  bar.appendChild(btnSearchAll);
  bar.appendChild(btnClear);
  host.appendChild(bar);
}

  function updateSubcontractorAutocomplete() {
    const subcontractorContainer = document.getElementById("subcontractorCompanyContainer");
    subcontractorContainer.innerHTML = ''; // Clear previous content

    const emailArray = subcontractorSuggestions.map(sub => sub.email);

    const formattedEmails = emailArray.join(', ');

    if (formattedEmails.trim() === '') {
        subcontractorContainer.style.border = "none"; // Hide border if empty
    } else {
        subcontractorContainer.style.border = "1px solid #ccc"; // Show border if content exists

        // Create a single text node with formatted emails
        const emailTextNode = document.createElement("div");
        emailTextNode.textContent = formattedEmails;

        // Append the formatted emails to the container
        subcontractorContainer.appendChild(emailTextNode);
    }
}

function setupCopySubEmailsButton() {
  const button = document.getElementById("copySubEmailsBtn");
  if (!button) return;

  button.addEventListener("click", () => {
    const emails = subcontractorSuggestions.map(sub => sub.email).filter(Boolean);
    const emailList = emails.join(', ');
    if (!emails.length) {
      alert("No subcontractor emails loaded yet.");
      return;
    }

    navigator.clipboard.writeText(emailList)
      .then(() => alert("Subcontractor emails copied to clipboard!"))
      .catch(err => {
        console.error("Failed to copy emails:", err);
        alert("Failed to copy emails. Please try again.");
      });
  });
}

// Unified function to create an autocomplete input
function createAutocompleteInput(placeholder, suggestions, type, fetchDetailsCallback, disabled = false) {
  const wrapper = document.createElement("div");
  wrapper.classList.add(`${type}-autocomplete-wrapper`, "autocomplete-wrapper");

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.classList.add(`${type}-autocomplete-input`, "autocomplete-input");
  input.dataset.type = type;

  const loadingSpinner = document.createElement("div");
  loadingSpinner.className = "autocomplete-loading";
  loadingSpinner.innerHTML = `
    <span class="spinner" style="display:inline-block;vertical-align:middle;margin-right:8px;"></span>
    <span style="color:#888;font-size:24px;">Loading bids...</span>
  `;
  loadingSpinner.style.display = disabled ? "block" : "none";

  if (disabled) {
    input.disabled = true;
    input.style.background = "#f5f5f5";
    input.style.color = "#bbb";
    input.style.cursor = "not-allowed";
  }
// Inside createAutocompleteInput(...) after input is created
input.addEventListener("blur", () => {
  const n = normalizeBid(input.value);
  if (n !== input.value) input.value = n;
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const n = normalizeBid(input.value);
    if (n !== input.value) input.value = n;
  }
});

  const dropdown = document.createElement("div");
  dropdown.classList.add(`${type}-autocomplete-dropdown`, "autocomplete-dropdown");

  let currentFocusIndex = -1;
  let currentOptions = [];

  function renderOptions(filtered) {
    dropdown.innerHTML = '';
    currentFocusIndex = -1;
    currentOptions = [];

    filtered.forEach((suggestion) => {
      const text = typeof suggestion === 'string' ? suggestion : suggestion.companyName;
      const option = document.createElement("div");
      option.classList.add(`${type}-autocomplete-option`, "autocomplete-option");
      option.textContent = text;
      option.addEventListener("click", () => {
        input.value = text;
        dropdown.innerHTML = '';
        fetchDetailsCallback?.(text);
      });
      dropdown.appendChild(option);
      currentOptions.push(option);
    });

    dropdown.style.display = filtered.length > 0 ? 'block' : 'none';
  }

  input.addEventListener("input", async function () {
    const raw = input.value;
    const normQuery = normalizeBid(raw).toLowerCase();

    // When there is no query, close dropdown and stop
    if (!normQuery) {
      dropdown.innerHTML = '';
      dropdown.style.display = 'none';
      return;
    }

    // Normalize suggestions for filtering (but keep original text for display)
    const pool = Array.isArray(suggestions) ? suggestions.slice() : [];
    const filtered = pool.filter(item => {
      const text = typeof item === 'string' ? item : item.companyName;
      return normalizeBid(text).toLowerCase().includes(normQuery);
    });

    // ✅ If exactly one match, auto-select it (no click needed)
    if (filtered.length === 1) {
      const only = filtered[0];
      const text = typeof only === 'string' ? only : only.companyName;
      input.value = normalizeBid(text); // write the nice, trimmed value
      dropdown.innerHTML = '';
      dropdown.style.display = 'none';
      await fetchDetailsCallback?.(text);
      return; // stop here so we don’t re-render a one-item dropdown
    }

    // Otherwise, show a dropdown to choose
    renderOptions(filtered);

    // (Optional) live detail fetch as user types (safe—no selection required)
    if (fetchDetailsCallback && normQuery.length > 0) {
      try { await fetchDetailsCallback(raw); } catch {}
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      // If dropdown is open and an item is highlighted, use it
      if (currentOptions.length && currentFocusIndex >= 0) {
        e.preventDefault();
        currentOptions[currentFocusIndex].click();
        return;
      }

      // If there is exactly one possible suggestion (based on current filter), auto-select
      const raw = input.value;
      const normQuery = normalizeBid(raw).toLowerCase();
      const pool = Array.isArray(suggestions) ? suggestions.slice() : [];
      const filtered = pool.filter(item => {
        const text = typeof item === 'string' ? item : item.companyName;
        return normalizeBid(text).toLowerCase().includes(normQuery);
      });

      if (filtered.length === 1) {
        e.preventDefault();
        const only = filtered[0];
        const text = typeof only === 'string' ? only : only.companyName;
        input.value = normalizeBid(text);
        dropdown.innerHTML = '';
        dropdown.style.display = 'none';
        fetchDetailsCallback?.(text);
      }
    } else if (e.key === "ArrowDown" && currentOptions.length) {
      e.preventDefault();
      currentFocusIndex = (currentFocusIndex + 1) % currentOptions.length;
      highlightOption(currentFocusIndex);
    } else if (e.key === "ArrowUp" && currentOptions.length) {
      e.preventDefault();
      currentFocusIndex = (currentFocusIndex - 1 + currentOptions.length) % currentOptions.length;
      highlightOption(currentFocusIndex);
    }
  });

  function highlightOption(index) {
    currentOptions.forEach((option, i) => {
      if (i === index) {
        option.classList.add("selected");
        option.scrollIntoView({ block: 'nearest' });
      } else {
        option.classList.remove("selected");
      }
    });
  }

  wrapper.appendChild(input);
  wrapper.appendChild(loadingSpinner);
  wrapper.appendChild(dropdown);

  // helper to enable after data loads
  wrapper.enableInput = function () {
    input.disabled = false;
    input.style.background = "";
    input.style.color = "";
    input.style.cursor = "";
    loadingSpinner.style.display = "none";
    input.focus();
  };

  return wrapper;
}


    function highlightOption(index) {
        currentOptions.forEach((option, i) => {
            if (i === index) {
                option.classList.add("selected");
                option.scrollIntoView({ block: 'nearest' });
            } else {
                option.classList.remove("selected");
            }
        });
    }


// Select suggestion to update email field
function selectSuggestion(suggestion, input, dropdown) {
    input.value = suggestion.companyName;
    document.getElementById('subcontractorEmailInput').value = suggestion.email; // Populate the email input field
    dropdown.innerHTML = ''; // Clear dropdown after selection
}

function updateTemplateText(
  subdivision,
  builder,
  gmEmail,
  branch,
  projectType,
  materialType,
  numberOfLots,
  anticipatedStartDate,
  vendor,
  AnticipatedDuration,
  gm,
)
 {
    if (subdivision) {
      document.querySelectorAll('.subdivisionContainer').forEach(el => (el.textContent = subdivision));
    }
 
    if (gm) {
        document.querySelectorAll('.gmNameContainer').forEach(el => (el.textContent = gm));
    }
    document.querySelectorAll('.gmEmailContainer').forEach(el => {
        el.textContent = gmEmail || '';
    });

    if (branch) {
        fetchACMName(branch);
    }

    if (builder) {
      document.querySelectorAll('.builderContainer').forEach(el => (el.textContent = builder));
    }
 
 document.querySelectorAll('.gmEmailContainer').forEach(el => {
  el.textContent = gmEmail || '';
});
  
if (branch) {
    document.querySelectorAll('.branchContainer').forEach(el => (el.textContent = branch));

const branchSlug = branch.toLowerCase().replace(/\s+/g, '');
const rawPurchasingEmail = `purchasing.${branchSlug}@vanirinstalledsales.com`;
const purchasingEmail = normalizePurchasingEmail(rawPurchasingEmail);
const estimatesEmail = `estimates.${branchSlug}@vanirinstalledsales.com`;

    document.querySelectorAll('.branchEmailContainer').forEach(el => {
        el.textContent = purchasingEmail ? `, ${purchasingEmail}` : '';
    });

    document.querySelectorAll('.estimatesEmailContainer').forEach(el => {
        el.textContent = estimatesEmail ? `, ${estimatesEmail}` : '';
    });
}

    if (projectType) {
      document.querySelectorAll('.briqProjectTypeContainer').forEach(el => (el.textContent = projectType));
    }
  
    if (materialType) {
        let formatted = materialType;
      
        if (typeof materialType === "string" && materialType.includes(",")) {
          const parts = materialType.split(",").map(p => p.trim());
          if (parts.length === 2) {
            formatted = `${parts[0]} and ${parts[1]}`;
          }
        }
      
        document.querySelectorAll('.materialTypeContainer').forEach(el => {
          el.textContent = formatted;
        });
      }
      
    if (numberOfLots) {
      document.querySelectorAll('.numberOfLotsContainer').forEach(el => (el.textContent = numberOfLots));
    }
  
    if (AnticipatedDuration) {
      document.querySelectorAll('.AnticipatedDurationContainer').forEach(el => (el.textContent = AnticipatedDuration));
    }
  
    if (vendor) {
      document.querySelectorAll('.vendorContainer').forEach(el => (el.textContent = vendor));
    }
  
    if (anticipatedStartDate) {
      const date = new Date(anticipatedStartDate);
      if (!isNaN(date.getTime())) {
        const formattedDate = date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        document.querySelectorAll('.anticipatedStartDateContainer').forEach(el => (el.textContent = formattedDate));
      } else {
        console.error('Invalid date format for anticipatedStartDate:', anticipatedStartDate);
      }
    }
  }

// Monitor subdivisionContainer for changes and trigger city lookup
function monitorSubdivisionChanges() {
    const subdivisionElement = document.querySelector('.subdivisionContainer');
    
    // Check if subdivisionElement exists before setting up observer
    if (subdivisionElement) {
        const observer = new MutationObserver(async () => {
        });
        
        observer.observe(subdivisionElement, { childList: true, characterData: true, subtree: true });
    } else {
        console.error("Element '.subdivisionContainer' not found. Cannot observe changes.");
    }
}

function waitForOrCreateBidInputContainer(maxWait = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();

    function check() {
      const container = document.getElementById("bidInputContainer");
      if (container) {
        resolve(container);
        return;
      }

      if (Date.now() - start > maxWait) {
        const fallbackContainer = document.createElement("div");
        fallbackContainer.id = "bidInputContainer";
const emailTemplateContainer = document.getElementById("emailTemplate");
if (emailTemplateContainer) {
  emailTemplateContainer.prepend(fallbackContainer);
} else {
  // fallback fallback 🤯
  document.body.prepend(fallbackContainer);
  console.warn("⚠️ #emailTemplate not found — placed #bidInputContainer in <body> instead");
}
        console.warn("⚠️ #bidInputContainer was missing — added dynamically after delay.");
        resolve(fallbackContainer);
        return;
      }
         requestAnimationFrame(check);
    }
    check();
  });
}
// === USER-DRIVEN REFRESH ===
// === USER-DRIVEN REFRESH (force network) ===
document.getElementById("refreshBidsBtn")?.addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  try {
    setBtnBusy(btn, true);
    updateDataStatus("ok", "Refreshing…");

    // Optional: clear caches first (so you see counts jump immediately)
    try {
      localStorage.removeItem("cachedBidNames");
      localStorage.removeItem("cachedBidNamesTimestamp");
      sessionStorage.removeItem("cachedVendors");
      sessionStorage.removeItem("cachedVendorsTimestamp");
    } catch {}

    // Pull fresh vendors and bids in parallel, forcing network
    const [{ uniqueNameCount }, _vendors] = await Promise.all([
      fetchBidNameSuggestions({ force: true }),     // bypass cache
      fetchAllVendorData({ force: true }),          // bypass cache
    ]);

    // Refill autocomplete with the new list
    updateAutocompleteOptions("bid", Array.isArray(window.bidNameSuggestions) ? window.bidNameSuggestions : []);

    // Ensure the bid input (if initially disabled) is now enabled
    try { window.bidAutocompleteInputWrapper?.enableInput?.(); } catch {}

    updateDataStatus("ok", `Loaded ${uniqueNameCount} unique bids just now`);
  } catch (err) {
    console.error("[refresh] failed:", err);
    updateDataStatus("error", "Refresh failed — check console");
  } finally {
    setBtnBusy(btn, false);
  }
});



// Example boot that prefers cache, but can be flipped to "live first"
document.addEventListener("DOMContentLoaded", async () => {
  try {
    renderBidInputImmediately();
    hydrateBidSuggestionsFromCache();

    const FORCE_LIVE_ON_BOOT = false; // flip to true if you want a guaranteed refetch

    await Promise.all([
      fetchAllVendorData({ force: FORCE_LIVE_ON_BOOT }),
      fetchBidNameSuggestions({ force: FORCE_LIVE_ON_BOOT }),
    ]);

    updateAutocompleteOptions("bid", window.bidNameSuggestions || []);
    window.bidAutocompleteInputWrapper?.enableInput?.();

    createVendorAutocompleteInput();
    autoProgressLoading?.(isBidInputVisible);
  } catch (err) {
    console.error("[boot] failed:", err);
  }
});



function wireBidInput() {
  const input = document.getElementById("bidInput");
  if (!input) return;

  // 1) Debounced typing: only update suggestion list (no details fetch here)
  const onType = debounce(() => {
    const val = input.value || "";
    const nval = window.normalizeBid(val);

    // filter suggestions locally
    const list = (window.bidNameSuggestions || []).filter(s =>
      (s || "").toLowerCase().includes((nval || "").toLowerCase())
    );

    updateAutocompleteOptions("bid", list);

    // If there is exactly one suggestion and it's an EXACT match, auto-commit
    if (isExactSuggestionMatch(nval, list)) {
      commitBidSelection(nval);
    }
  }, 180);

  input.addEventListener("input", onType);

  // 2) When the user presses Enter or blurs with an exact single suggestion, commit
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const val = window.normalizeBid(input.value);
      const list = (window.bidNameSuggestions || []).filter(s =>
        (s || "").toLowerCase().includes((val || "").toLowerCase())
      );
      if (isExactSuggestionMatch(val, list)) {
        ev.preventDefault();
        commitBidSelection(val);
      }
    }
  });

  input.addEventListener("blur", () => {
    const val = window.normalizeBid(input.value);
    const list = (window.bidNameSuggestions || []).filter(s =>
      (s || "").toLowerCase().includes((val || "").toLowerCase())
    );
    if (isExactSuggestionMatch(val, list)) {
      commitBidSelection(val);
    }
  });
}
let __VENDOR_CACHE_INIT_DONE = false;
async function hydrateVendorCacheOnce() {
  if (__VENDOR_CACHE_INIT_DONE) return window.vendorData || [];
  __VENDOR_CACHE_INIT_DONE = true;
  try {
    // Try cache only; do not force network here
    const ts = Number(sessionStorage.getItem("cachedVendorsTimestamp") || 0);
    const cached = JSON.parse(sessionStorage.getItem("cachedVendors") || "[]");
    if (ts && Array.isArray(cached) && cached.length) {
      window.vendorData = cached;
      console.log("✅ Vendor cache hydrated once.");
      return cached;
    }
  } catch {}
  // If no cache, load from network once (optional)
  return fetchAllVendorData({ force: true });
}

async function commitBidSelection(bidName) {
  try {
    document.querySelectorAll(".bidNameContainer").forEach(el => el.textContent = bidName);
  } catch {}
  try {
    await fetchDetailsByBidName(bidName); // now we only call this on committed selection or exact one
  } catch (e) {
    console.error("Failed loading bid details:", e);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const bidContainer = await waitForOrCreateBidInputContainer();
  initializeBidAutocomplete(); // now safe to call
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    // 1️⃣ Initialize your static template content
    displayEmailContent();
    ensureDynamicContainerExists();
    setupCopySubEmailsButton();
    monitorSubdivisionChanges();

    // 1.5️⃣ Render bid input immediately as disabled/loading
    renderBidInputImmediately(); 

    // 2️⃣ Always fetch vendor and bid data first — BEFORE initializing autocomplete logic
    await fetchAllVendorData();
    await fetchBidNameSuggestions();

    // 2.5️⃣ Enable the input and hide spinner
    if (window.bidAutocompleteInputWrapper && window.bidAutocompleteInputWrapper.enableInput) {
      window.bidAutocompleteInputWrapper.enableInput();
    }

    // 2.6️⃣ Update the autocomplete input with suggestions, if needed
    updateAutocompleteOptions("bid", bidNameSuggestions);

     await waitForOrCreateBidInputContainer();

    // 4️⃣ (OPTIONAL) Now initialize Bid Input Autocomplete if you have logic for re-attaching handlers
    initializeBidAutocomplete();

    // 5️⃣ Create Vendor Autocomplete

    // 6️⃣ Start progress animation
    autoProgressLoading(isBidInputVisible);

    // 7️⃣ Dynamic textarea auto-resize
    const textareaObserver = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.tagName === "TEXTAREA" &&
            (node.id === "additionalInfoInput" || node.id === "additionalInfoInputSub")) {
            node.addEventListener("input", function () {
              this.style.height = "auto";
              this.style.height = `${this.scrollHeight}px`;
            });
          }
        });
      });
    });

    // 8️⃣ Username preview sync
    const userNameInput = document.getElementById("inputUserName");
    const preview = document.getElementById("userNamePreview");
    if (userNameInput && preview) {
      userNameInput.addEventListener("input", () => {
        preview.textContent = userNameInput.value.trim() || "Your Name";
      });
    }

    // 9️⃣ Management Email Button: Send All
    const sendManagementEmailButton = document.getElementById("sendManagementEmailButton");
    if (sendManagementEmailButton) {
      sendManagementEmailButton.addEventListener("click", async () => {
        showRedirectAnimation();

        const vendorWindow = window.open("about:blank", "_blank");
        const managementWindow = window.open("about:blank", "_blank");
        const subcontractorWindows = Array.from(
          { length: Math.ceil(subcontractorSuggestions.length / 30) },
          () => window.open("about:blank", "_blank")
        );

        const links = await generateMailtoLinks();
        if (links) {
          const { vendorGmailLink, managementGmailLink, subcontractorGmailLinks } = links;

          if (vendorGmailLink) vendorWindow.location.href = vendorGmailLink;
          else vendorWindow.close();

          if (managementGmailLink) managementWindow.location.href = managementGmailLink;
          else managementWindow.close();

          subcontractorGmailLinks.forEach((link, i) => {
            if (subcontractorWindows[i]) subcontractorWindows[i].location.href = link;
          });
        } else {
          vendorWindow.close();
          managementWindow.close();
          subcontractorWindows.forEach(w => w.close());
        }
      });
    }

    // 🔟 Selected Email Options
    const sendSelectedEmailsBtn = document.getElementById("sendSelectedEmails");
    if (sendSelectedEmailsBtn) {
      sendSelectedEmailsBtn.addEventListener("click", async () => {
        showRedirectAnimation();

        const sendVendor = document.getElementById("optionVendor")?.checked;
        const sendManagement = document.getElementById("optionManagement")?.checked;
        const sendSubcontractor = document.getElementById("optionSubcontractor")?.checked;

        const vendorWindow = sendVendor ? window.open("about:blank", "_blank") : null;
        const managementWindow = sendManagement ? window.open("about:blank", "_blank") : null;

        const links = await generateMailtoLinks();
        const subcontractorWindows = Array.from(
          { length: sendSubcontractor && links?.subcontractorGmailLinks?.length || 0 },
          () => window.open("about:blank", "_blank")
        );

        if (links) {
          const { vendorGmailLink, managementGmailLink, subcontractorGmailLinks } = links;

          if (sendVendor && vendorWindow && vendorGmailLink) vendorWindow.location.href = vendorGmailLink;
          else vendorWindow?.close();

          if (sendManagement && managementWindow && managementGmailLink) managementWindow.location.href = managementGmailLink;
          else managementWindow?.close();

          if (sendSubcontractor && subcontractorGmailLinks.length) {
            subcontractorGmailLinks.forEach((link, i) => {
              if (subcontractorWindows[i]) subcontractorWindows[i].location.href = link;
            });
          } else {
            subcontractorWindows.forEach(w => w.close());
          }
        } else {
          vendorWindow?.close();
          managementWindow?.close();
          subcontractorWindows.forEach(w => w.close());
        }
      });
    }

    // 1️⃣1️⃣ Vendor Change Button
    const changeVendorBtn = document.getElementById("changeVendorBtn");
    if (changeVendorBtn) {
      changeVendorBtn.addEventListener("click", () => {
        const vendorNameRaw = document.querySelector('.vendorNameContainer')?.textContent.trim().toLowerCase();
        const branch = document.querySelector('.branchContainer')?.textContent.trim().toLowerCase();

        if (!vendorNameRaw) return alert("No vendor name available.");

        const firstWord = vendorNameRaw.split(/\s+/)[0];
        const matches = vendorData.filter(v =>
          v.name?.toLowerCase().includes(firstWord) && v.name?.toLowerCase() !== vendorNameRaw
        );

        const narrowed = matches.filter(v =>
          v.name?.toLowerCase().includes(branch) || v.email?.toLowerCase().includes(branch)
        );

        const finalMatches = narrowed.length > 0 ? narrowed : matches;

        if (finalMatches.length > 0) {
          document.querySelectorAll('.vendorNameContainer').forEach(el => el.textContent = '');
          document.querySelectorAll('.vendorEmailWrapper').forEach(el => el.textContent = '');
          window.currentVendorEmail = '';
          showVendorSelectionDropdown(finalMatches);
        } else {
          alert("No alternate vendors found for this selection.");
        }
      });
    }

    // 1️⃣2️⃣ Sync City Inputs
    const cityObserver = new MutationObserver(() => {
      const cityInputs = document.querySelectorAll('input.city');
      if (cityInputs.length >= 2) {
        syncCityInputs();
        cityObserver.disconnect();
      }
    });
    cityObserver.observe(document.body, { childList: true, subtree: true });

    // 1️⃣3️⃣ Clear Vendor
    const clearBtn = document.getElementById('clearVendorBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        document.querySelectorAll('.vendorNameContainer').forEach(el => el.textContent = '');
        document.querySelectorAll('.vendorEmailWrapper').forEach(el => el.textContent = '');
        window.currentVendorEmail = '';
      });
    }

  } catch (error) {
    console.error("❌ Error in DOMContentLoaded handler:", error);
  }
});

function splitIntoChunks(array, chunkSize = 30) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

document.getElementById('clearVendorBtn')?.addEventListener('click', () => {
    document.querySelectorAll('.vendorNameContainer').forEach(el => el.textContent = '');
    document.querySelectorAll('.vendorEmailWrapper').forEach(el => el.textContent = '');
    window.currentVendorEmail = '';
});

   function autoResizeInput(input) {
    if (!input) return;
    const tempSpan = document.createElement('span');
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.position = 'absolute';
    tempSpan.style.whiteSpace = 'pre';
    tempSpan.style.font = getComputedStyle(input).font;
    tempSpan.textContent = input.value || input.placeholder || '';
    document.body.appendChild(tempSpan);
    input.style.width = `${tempSpan.offsetWidth + 12}px`; // Add some padding
    document.body.removeChild(tempSpan);
}

function enableAutoResizeInput(selector) {
    const input = document.querySelector(selector);
    if (!input) {
        console.warn(`[autoResize] Input not found for selector: ${selector}`);
        return;
    }
    const span = document.createElement('span');
    span.style.visibility = 'hidden';
    span.style.position = 'absolute';
    span.style.whiteSpace = 'pre';
    span.style.font = getComputedStyle(input).font;

    document.body.appendChild(span);

    const resize = () => {
        const value = input.value || input.placeholder || '';
        span.textContent = value;
        const newWidth = span.offsetWidth + 10;
        input.style.width = `${newWidth}px`;

    };

    input.addEventListener('input', resize);
    resize(); 
}

function normalizePurchasingEmail(email) {
    if (email === "purchasing.raleigh@vanirinstalledsales.com") {
        return "purchasing@vanirinstalledsales.com";
    }
    return email;
}

   function displayEmailContent() {
    const emailContent = `
        <h2>
      To: 
<span class="managementEmailContainer" title="
maggie@vanirinstalledsales.com, 
jason.smith@vanirinstalledsales.com, 
hunter@vanirinstalledsales.com, 
lance.roberts@vanirinstalledsales.com,
rick.jinkins@vanirinstalledsales.com, 
ethen.wilson@vanirinstalledsales.com, 
dallas.hudson@vanirinstalledsales.com, 
mike.raszmann@vanirinstalledsales.com
">
  Management
</span>
<span class="branchEmailContainer-label"> </span><span class="branchEmailContainer"></span>
<span class="acmEmailContainer"></span>
<span class="estimatesEmailContainer-label"> </span><span class="estimatesEmailContainer"></span>

        </h2>

        <p><strong>Subject:</strong> WINNING! | <span class="subdivisionContainer"></span> | <span class="builderContainer"></span></p>
        <p>Go !! <strong><span class="branchContainer"></span></strong>,</p>

        <h4>Major Win with <strong> <span class="builderContainer"></span></strong></h4>
   
        <h2>Here's the breakdown:</h2>
        <span class="subdivisionContainer"></span> 
        <p><strong>Field Contact:</strong> <input class="cname" placeholder="Enter contact name" /></p>
        <p><strong>Product Being Built:</strong> <span class="briqProjectTypeContainer"></span></p>
<p><strong>Expected Pace:</strong> <input class="epace" type="number" placeholder="" /> days</p>
        <p><strong>Expected Start Date:</strong> <span class="anticipatedStartDateContainer"></span></p>
        <p><strong>Number of Lots:</strong> <span class="numberOfLotsContainer"></span></p>

        <p><strong>Do they have special pricing?</strong></p>
        <label><input type="radio" name="sprice" value="Yes" class="sprice" /> Yes</label>
        <label><input type="radio" name="sprice" value="No" class="sprice" /> No</label>

        <p><strong>PO Customer?</strong></p>
        <label><input type="radio" name="poCustomer" value="Yes" class="pcustomer" /> Yes</label>
        <label><input type="radio" name="poCustomer" value="No" class="pcustomer" /> No</label>

        <p>This will be a <strong><span class="briqProjectTypeContainer"></span></strong> project requiring <strong><span class="materialTypeContainer"></span></strong> installation.</p>

        <hr>

        <!-- Subcontractor Email -->
        <div id="subcontractorCompanyContainer"></div>
        <button id="copySubEmailsBtn" style="margin-top: 10px;">Copy All <strong><span class="branchContainer"></span></strong> Subcontractors Emails</button>

        <p><strong>Subject:</strong> Vanir | New Opportunity | <span class="subdivisionContainer"></span></p>

        <p>Greetings from Vanir Installed Sales,</p>
            <p>Vanir has officially secured the <strong><span class="subdivisionContainer"></span></strong> with <strong><span class="builderContainer"></span></strong> in 
        <input class="city" placeholder="Enter city" /></p>. We’re eager to get started and ensure excellence throughout the build.

        <p>This will be a <strong><span class="briqProjectTypeContainer"></span></strong> project requiring <strong><span class="materialTypeContainer"></span></strong> installation.</p>

      <p>
  If you're interested in working with us on this exciting opportunity, please reach out to our general manager 
  <span class="gmNameContainer"></span> at 
<span class="gmEmailContainer"></span> and our area construction manager 
<span class="acmNameContainer"></span> at <span class="acmEmailContainer"></span>.

</p>
        <hr>

        <!-- ✅ Vendor Email Section -->
<div id="vendorEmailContainer" style="margin-top: 10px; position: relative;"></div>

<h2>To: <span class="vendorNameContainer"></span> <span class="vendorEmailWrapper"></span></h2>

<p><strong>Subject:</strong> Project Awarded – <span class="builderContainer"></span> | <span class="subdivisionContainer"></span></p>
        <p>Hello <strong><span class="vendorNameContainer"></span></strong>,</p>
        <p>We wanted to notify you that <strong>Vanir Installed Sales</strong> <strong><span class="branchContainer"></span></strong> has secured the bid for <strong><span class="subdivisionContainer"></span></strong> project with <strong><span class="builderContainer"></span></strong>.</p>

        <p><strong>Project Summary:</strong></p>
        <ul>
            <li>Project Type: <span class="briqProjectTypeContainer"></span></li>
            <li>Material Type: <span class="materialTypeContainer"></span></li>
            <li>Expected Start Date: <span class="anticipatedStartDateContainer"></span></li>
            <li>Number of Lots: <span class="numberOfLotsContainer"></span></li>
            <li>Location: <input class="city" placeholder="Enter city" /></li>
        </ul>
<p>We look forward to another successful project with you.</p>
        <p>Best regards,<br><strong>Vanir Installed Sales <span class="branchContainer"></span></strong> LLC</p>

        <div class="signature-container">
            <img src="VANIR-transparent.png" alt="Vanir Logo" class="signature-logo"> 
            <div class="signature-content"> 
<p>
  <input type="text" id="inputUserName" placeholder="Your Name" />
</p>

                <p>Phone: <input type="text" id="inputUserPhone" placeholder=""></p>
                <p><a href="https://www.vanirinstalledsales.com">www.vanirinstalledsales.com</a></p>
                <p><strong>Better Look. Better Service. Best Choice.</strong></p>
            </div>
        </div>
    `;

    document.addEventListener('DOMContentLoaded', () => {
        const cityObserver = new MutationObserver(() => { 
            const cityInputs = document.querySelectorAll('input.city');
            if (cityInputs.length >= 2) {
                syncCityInputs();
                cityObserver.disconnect();
            }
        });
    
        cityObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    });
    
    const emailContainer = document.getElementById('emailTemplate');
   if (emailContainer) {
  emailContainer.innerHTML = emailContent;

  // ✅ ADD THIS HERE
  const managementEmails = [
    "maggie@vanirinstalledsales.com",
    "jason.smith@vanirinstalledsales.com",
    "hunter@vanirinstalledsales.com",
    "rick.jinkins@vanirinstalledsales.com",
    "lance.roberts@vanirinstalledsales.com",
    "ethen.wilson@vanirinstalledsales.com",
    "dallas.hudson@vanirinstalledsales.com",
    "mike.raszmann@vanirinstalledsales.com"
  ];

  const managementSpan = document.querySelector('.managementEmailContainer');
  if (managementSpan) {
    managementSpan.textContent = 'Management';
    managementSpan.title = managementEmails.join(',\n');
  }

const chooseVendorBtn = document.getElementById('chooseVendorBtn');
if (chooseVendorBtn) {
  chooseVendorBtn.addEventListener('click', () => {
    if (!vendorData.length) {
      console.warn("⚠️ Vendor data is not loaded.");
      return;
    }
    showVendorSelectionDropdown(vendorData);
  });
}

        // 🔄 Observe for city inputs after they're injected
        const cityObserver = new MutationObserver(() => { 
            const cityInputs = document.querySelectorAll('input.city');
            if (cityInputs.length >= 2) {
                syncCityInputs();
                cityObserver.disconnect();
            }
        });
        cityObserver.observe(emailContainer, {
            childList: true,
            subtree: true,
        });
        
        // ✅ Attach the click listener immediately after creating the button
        const changeVendorBtn = document.getElementById('changeVendorBtn');
        if (changeVendorBtn) {
            changeVendorBtn.addEventListener('click', () => {
                let vendorRaw = document.querySelector('.vendorContainer')?.textContent?.trim().toLowerCase();

                if (!vendorRaw) {
                  vendorRaw = document.querySelector('.vendorNameContainer')?.textContent?.trim().toLowerCase();
                }
                
                if (!vendorRaw) {
                  vendorRaw = vendorData.find(v => v.email === window.currentVendorEmail)?.name?.toLowerCase();
                }
                
             const branch = document.querySelector('.branchContainer')?.textContent?.trim().toLowerCase();
        
                if (!vendorRaw) {
                    alert("Original vendor name not found.");
                    return;
                }
        
                // Re-filter the vendor list based on vendorRaw
                const matches = vendorData.filter(v =>
                    v.name?.toLowerCase().includes(vendorRaw) ||
                    v.email?.toLowerCase().includes(vendorRaw)
                );
        
                // Further narrow down by branch
                const narrowed = matches.filter(v =>
                    v.name?.toLowerCase().includes(branch) ||
                    v.email?.toLowerCase().includes(branch)
                );
        
                const finalMatches = narrowed.length > 0 ? narrowed : matches;
        
                if (finalMatches.length > 1) {
                    // Clear current vendor info
                    document.querySelectorAll('.vendorNameContainer').forEach(el => el.textContent = '');
                    document.querySelectorAll('.vendorEmailWrapper').forEach(el => el.textContent = '');
                    window.currentVendorEmail = '';
        
                    // Show the dropdown again
                    showVendorSelectionDropdown(finalMatches);
                } else {
                    alert("No alternate vendors found for this selection.");
                }
            });
        }
                setupCopySubEmailsButton(); // Re-attach button listener
    } else {
        console.error("Email template container not found in the DOM.");
    }
}

// Sync city inputs once both are loaded and observed
function syncCityInputs() {
    const cityInputs = document.querySelectorAll('input.city');

    if (cityInputs.length < 2) return;

    // Avoid duplicate listeners
    cityInputs.forEach(input => {
        input.removeEventListener('input', handleInput);
        input.addEventListener('input', handleInput);
    });

    function handleInput(e) {
        const value = e.target.value;
        cityInputs.forEach(el => {
            if (el !== e.target) el.value = value;
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const changeVendorBtn = document.getElementById('changeVendorBtn');

    if (changeVendorBtn) {
        changeVendorBtn.addEventListener('click', () => {
            const vendorNameRaw = document.querySelector('.vendorNameContainer')?.textContent.trim().toLowerCase();

            if (!vendorNameRaw) {
                alert("No vendor name available.");
                return;
            }

            // Use only the first word for fuzzy matching
            const firstWord = vendorNameRaw.split(/\s+/)[0]; // e.g., "Summit" from "Summit Stairs"

            // Get all vendor matches using first word and exclude the exact original name
            const matches = vendorData.filter(vendor => {
                const name = vendor.name?.toLowerCase() || '';
                return name.includes(firstWord) && name !== vendorNameRaw;
            });

            if (matches.length > 0) {
                // Clear current
                document.querySelectorAll('.vendorNameContainer').forEach(el => el.textContent = '');
                document.querySelectorAll('.vendorEmailWrapper').forEach(el => el.textContent = '');
                window.currentVendorEmail = '';

                // Show dropdown with options
                showVendorSelectionDropdown(matches);
            } else {
                alert("No alternate vendors found for this selection.");
            }
        });
    }
});

function buildSubcontractorBody(subEmails = [], {
  branch,
  builder,
  subdivision,
  projectType,
  materialType,
  epace,
  numberOfLots,
  anticipatedStartDate,
  city,
  gm,
  gmEmail,
  acmName,
  acmEmailGlobal,
  userName,
  userPhone
}) {
  let acmSentence = '';

  if (acmName && acmEmailGlobal) {
    const acmNames = acmName.split(',').map(n => n.trim());
    const acmEmails = acmEmailGlobal.split(',').map(e => e.trim());

    const pairs = acmNames.map((name, i) => `${name} at ${acmEmails[i] || ''}`);
    const formatted = pairs.length === 1
      ? pairs[0]
      : pairs.slice(0, -1).join(', ') + ', and ' + pairs[pairs.length - 1];

    acmSentence = `, or our Area Construction Manager${pairs.length > 1 ? 's' : ''}, ${formatted}`;
  }

  return `
Greetings from Vanir Installed Sales,

Vanir ${branch} secured the ${subdivision} with ${builder}. We’re eager to get started and ensure excellence throughout the build.
This will be a ${projectType} project, requiring ${materialType} installation.

Project Details:
- Expected Pace: ${epace} ${epace > 1 ? 'days' : 'day'}
- Number of Lots: ${numberOfLots}
- Anticipated Start Date: ${anticipatedStartDate}
- Project Location: ${city}

If you're interested in partnering with us on this opportunity, please contact our General Manager, ${gm} at ${gmEmail}${acmSentence}.

Best regards,  ${userName}  
Vanir Installed Sales ${branch || 'LLC'}  
Phone: ${userPhone}  
https://www.vanirinstalledsales.com  
Better Look. Better Service. Best Choice.
`.trim();
}

async function validateAndExportBidDetails(bidName) {
    const bidDetails = await fetchDetailsByBidName(bidName);
    exportData(bidDetails);
}

const textarea = document.getElementById('additionalInfoInput');
const additionalDetails = textarea ? textarea.value.trim() : null;

// Define generateMailtoLinks
// Define generateMailtoLinks
async function generateMailtoLinks() {
  try {
    // Pull shared values already collected in your UI/state
    const {
      branch,
      subdivision,
      builder,
      projectType,
      materialType,
      anticipatedStartDate,
      numberOfLots,
      city,
      cname,
      epace,
      acmName,
      sprice,
      poCustomer,
      gmEmail,
      gm,
      vendorEmail,          // fallback vendor (from Airtable)
      vendorEmailWrapper,   // DOM node where the vendor email is shown
      acmEmailGlobal        // used in team emails
    } = getSharedFieldValues();

    // Keep the visible wrapper in sync with the chosen vendor email
    if (vendorEmailWrapper) {
      if (vendorEmail !== 'Not Specified' && typeof vendorEmail === 'string' && vendorEmail.includes('@')) {
        vendorEmailWrapper.textContent = ` <${vendorEmail}>`;
      } else if (window.currentVendorEmail && window.currentVendorEmail.includes('@')) {
        vendorEmailWrapper.textContent = ` <${window.currentVendorEmail}>`;
      } else {
        vendorEmailWrapper.textContent = '';
      }
    }

    // User signature inputs (already present in your UI)
    const userNameInput = await waitForElement('#inputUserName');
    const userPhoneInput = await waitForElement('#inputUserPhone');
    const userName = (userNameInput?.value || '').trim() || 'Your Name';
    const userPhone = (userPhoneInput?.value || '').trim() || 'Your Phone';

    // Subjects and bodies
    const managementSubject = `Another WIN for Vanir - ${branch} - ${subdivision} - ${builder}`;
    const managementBody = `
Go !!

Vanir ${branch} secured ${subdivision} with ${builder}.

Project Summary:
- Project Type: ${projectType}
- Material Type: ${materialType}
- Expected Start Date: ${anticipatedStartDate}
- Number of Lots: ${numberOfLots}
- Project Location: ${city}

We look forward to another successful project with you.

Best,  ${userName}  
Vanir Installed Sales ${branch || 'LLC'}
Phone: ${userPhone}  
https://www.vanirinstalledsales.com  
Better Look. Better Service. Best Choice.
`.trim();

    // Purchasing/Estimates emails derived from branch
    const selectedBranch = (document.querySelector('.branchContainer')?.textContent || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
    const rawPurchasingEmail = `purchasing.${selectedBranch}@vanirinstalledsales.com`;
    const purchasingEmail = normalizePurchasingEmail(rawPurchasingEmail);
    const estimatesEmail = `estimates.${selectedBranch}@vanirinstalledsales.com`;

    // Team emails for management thread
    const teamEmails = [
      "maggie@vanirinstalledsales.com",
      "jason.smith@vanirinstalledsales.com",
      "hunter@vanirinstalledsales.com",
      "rick.jinkins@vanirinstalledsales.com",
      "   lance.roberts@vanirinstalledsales.com",
      "dallas.hudson@vanirinstalledsales.com",
      "mike.raszmann@vanirinstalledsales.com",
      "ethen.wilson@vanirinstalledsales.com",
      acmEmailGlobal,
      purchasingEmail,
      estimatesEmail
    ].filter(Boolean).join(", ");

    // ✅ Vendor email merge: prefer selected vendor from UI; fallback to Airtable vendor
    const selectedVendorEmail = (window.currentVendorEmail || '').trim();
    const effectiveVendorEmail = selectedVendorEmail || vendorEmail;

    // Combine vendor + purchasing into the To field (comma separated)
    const vendorToEmail = [effectiveVendorEmail, purchasingEmail]
      .filter(email => typeof email === "string" && email.includes('@'))
      .join(',');

    // Build Vendor subject/body (adjust copy as needed)
    const vendorSubject = `Vendor Pricing – ${subdivision || ''} (${branch || ''})`;
    const vendorBody = `
Greetings from Vanir Installed Sales,

Vanir ${branch || ''} secured the ${subdivision || ''} with ${builder || ''}.
This will be a ${projectType || ''} project, requiring ${materialType || ''} installation.

Project Details:
- Anticipated Start Date: ${anticipatedStartDate || ''}
- Number of Lots: ${numberOfLots || ''}
- Project Location: ${city || ''}

Please coordinate with our GM, ${gm || ''} at ${gmEmail || ''}.

Best regards,
${userName}
Vanir Installed Sales ${branch || ''}
https://www.vanirinstalledsales.com
`.trim();

    // Gmail link for Management
    const managementGmailLink = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(teamEmails)}&su=${encodeURIComponent(managementSubject)}&body=${encodeURIComponent(managementBody)}`;

    // Gmail link for Vendor thread:
    // If we have vendorToEmail, use it; otherwise fall back to GM (matches your file’s behavior)
    const vendorToEncoded = `to=${encodeURIComponent(vendorToEmail)}`;
    const vendorGmailLink = vendorToEmail
      ? `https://mail.google.com/mail/?view=cm&fs=1&${vendorToEncoded}&su=${encodeURIComponent(vendorSubject)}&body=${encodeURIComponent(vendorBody)}`
      : (gmEmail
          ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(gmEmail)}&su=${encodeURIComponent(vendorSubject)}&body=${encodeURIComponent(vendorBody)}`
          : null);

    // Subcontractor options/flow
    const sendBlankSubEmail = document.getElementById("optionSendBlankSubEmail")?.checked;
    const sendSubEmail = document.getElementById("optionSubcontractor")?.checked;

    const filteredEmails = (Array.isArray(window.subcontractorSuggestions) ? window.subcontractorSuggestions : [])
      .map(sub => sub.email)
      .filter(email => typeof email === "string" && email.includes('@'));

    let subcontractorEmailChunks = [];
    if (sendBlankSubEmail) {
      subcontractorEmailChunks = [[]]; // one blank compose
    } else if (filteredEmails.length > 0) {
      subcontractorEmailChunks = splitIntoChunks(filteredEmails, 30); // Gmail bcc safety
    }

    // Build subcontractor bodies and links
    const subcontractorGmailLinks = [];
    let emailBody = '';

    if (sendBlankSubEmail) {
      // one blank body with no recipients
      emailBody = buildSubcontractorBody([], {
        branch,
        builder,
        subdivision,
        projectType,
        materialType,
        epace,
        numberOfLots,
        anticipatedStartDate,
        city,
        gm,
        gmEmail,
        acmName,
        acmEmailGlobal,
        userName,
        userPhone
      });

      const mailtoLink = `https://mail.google.com/mail/?view=cm&fs=1&to=&su=${encodeURIComponent(`Vanir Project Opportunity: ${branch} - ${builder}`)}&body=${encodeURIComponent(emailBody)}`;
      subcontractorGmailLinks.push(mailtoLink);
      // keep the original behavior of opening this one immediately
      window.open(mailtoLink, '_blank');
    } else if (sendSubEmail && filteredEmails.length > 0) {
      // chunks as BCC with GM in To
      const chunks = splitIntoChunks(filteredEmails, 30);
      for (const chunk of chunks) {
        emailBody = buildSubcontractorBody(chunk, {
          branch,
          builder,
          subdivision,
          projectType,
          materialType,
          epace,
          numberOfLots,
          anticipatedStartDate,
          city,
          gm,
          gmEmail,
          acmName,
          acmEmailGlobal,
          userName,
          userPhone
        });

        const bccPart = chunk.length > 0 ? `&bcc=${encodeURIComponent(chunk.join(','))}` : '';
        const mailtoLink = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(gmEmail || '')}${bccPart}&su=${encodeURIComponent(`Vanir Project Opportunity: ${branch} - ${builder}`)}&body=${encodeURIComponent(emailBody)}`;
        subcontractorGmailLinks.push(mailtoLink);
      }
    }

    // Return all links for the callers that open windows
    return {
      managementGmailLink,
      subcontractorGmailLinks,
      vendorGmailLink
    };

  } catch (error) {
    console.error("Error generating mailto links:", error?.message || error);
    return null;
  }
}

 
// Function to show the redirect animation
function showRedirectAnimation() {
    const animationOverlay = document.createElement('div');
    animationOverlay.id = 'redirectOverlay';
    animationOverlay.style.position = 'fixed';
    animationOverlay.style.top = '0';
    animationOverlay.style.left = '0';
    animationOverlay.style.width = '100%';
    animationOverlay.style.height = '100%';
    animationOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    animationOverlay.style.zIndex = '9999';
    animationOverlay.style.display = 'flex';
    animationOverlay.style.justifyContent = 'center';
    animationOverlay.style.alignItems = 'center';
    animationOverlay.innerHTML = `
        <div style="text-align: center; color: white; font-size: 20px;">
            <p>Redirecting to Gmail...</p>
            <div class="spinner"></div>
        </div>
    `;

    document.body.appendChild(animationOverlay);

    // Spinner animation styles
    const style = document.createElement('style');
    style.innerHTML = `
        .spinner {
            margin: 20px auto;
            width: 40px;
            height: 40px;
            border: 4px solid white;
            border-top: 4px solid transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);

    // Remove the animation after a few seconds (optional)
    setTimeout(() => {
        document.body.removeChild(animationOverlay);
    }, 7500); // Adjust duration as needed
}

// Function to get subcontractor emails by branch
function getSubcontractorsByBranch(subcontractors, branch) {
    return subcontractors
        .filter(sub => sub.fields.branch === branch)  // Filter by branch
        .map(sub => sub.fields.email)  // Map to get just the emails
        .join(', ');  // Join emails by commas to pass in the URL
}

function createVendorAutocompleteInput() {
    const container = document.getElementById("vendorEmailContainer");
    if (!container) {
        console.error("❌ vendorEmailContainer not found.");
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "vendor-autocomplete-wrapper";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Search Vendor";
    input.className = "vendor-autocomplete-input";

    const dropdown = document.createElement("div");
    dropdown.className = "vendor-autocomplete-dropdown";

    input.addEventListener("input", () => {
        const query = input.value.toLowerCase();
        dropdown.innerHTML = ""; // Clear old results

        const filteredVendors = vendorData
            .filter(vendor =>
                vendor.name?.toLowerCase().includes(query) ||
                vendor.email?.toLowerCase().includes(query)
            )
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        filteredVendors.forEach(vendor => {
            const option = document.createElement('div');
            option.className = 'vendor-autocomplete-option';
            option.textContent = vendor.name;
            option.dataset.email = vendor.email;

            option.addEventListener('click', () => {
                input.value = vendor.name;
                window.currentVendorEmail = vendor.email;
                document.querySelectorAll('.vendorNameContainer').forEach(el => el.textContent = vendor.name);
                document.querySelectorAll('.vendorEmailWrapper').forEach(el => el.textContent = ` <${vendor.email}>`);
                dropdown.innerHTML = '';
            });

            dropdown.appendChild(option);
        });
        dropdown.style.display = filteredVendors.length > 0 ? 'block' : 'none';
    });

    // 👇 Trigger input logic even on focus to show all vendors
    input.addEventListener("focus", () => {
        input.dispatchEvent(new Event("input"));
    });

    // ✅ Click outside to close dropdown
    const handleClickOutside = (event) => {
        if (!wrapper.contains(event.target)) {
            dropdown.style.display = 'none';
        }
    };
    document.addEventListener("click", handleClickOutside);

    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);
    container.appendChild(wrapper);
}

function renderBidInputImmediately() {
    const emailContainer = document.getElementById('emailTemplate');
    if (!emailContainer) return;

    // Create as disabled/loading initially
    const bidAutocompleteInput = createAutocompleteInput(
        "Enter Bid Name",
        [], // Initially empty suggestions
        "bid",
        fetchDetailsByBidName,
        true  // <-- disabled!
    );

    // Save a reference so you can enable it later after loading
    window.bidAutocompleteInputWrapper = bidAutocompleteInput;

    emailContainer.prepend(bidAutocompleteInput);
}

async function fetchLazyBidSuggestions(query = "", isInitialLoad = false) {
    try {
        let url = `https://api.airtable.com/v0/${baseId}/${tableId}?view=${viewId}&pageSize=${PAGE_SIZE}&fields[]=Bid%20Name`;
        if (offset) url += `&offset=${offset}`;

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${airtableApiKey}` }
        });

        if (!response.ok) {
            console.error("Error fetching bid suggestions:", response.statusText);
            return [];
        }

        const data = await response.json();

        // Extract bid names
        let newSuggestions = data.records
            .map(record => record.fields["Bid Name"])
            .filter(Boolean);

        // Apply search filtering client-side (faster than Airtable SEARCH())
        if (query) {
            const lowerQ = query.toLowerCase();
            newSuggestions = newSuggestions.filter(name => 
                name.toLowerCase().includes(lowerQ)
            );
        }

        if (isInitialLoad) bidNameSuggestions = []; // reset on initial load

        // Deduplicate while adding
        bidNameSuggestions.push(...newSuggestions.filter(n => !bidNameSuggestions.includes(n)));

        offset = data.offset || null;

        return newSuggestions;
    } catch (error) {
        console.error("Error during lazy loading of bid suggestions:", error);
        return [];
    }
}


// Debounce utility to limit API calls
function debounce(func, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func(...args), delay);
    };
}

function createSpanPopulationTimeout(overlay, delay = 5000) {
    let triggered = false;

    const timeout = setTimeout(() => {
        triggered = true;
        console.warn(`⏰ Span population is taking longer than ${delay / 1000} seconds...`);
        if (overlay) overlay.style.display = 'flex';
    }, delay);

    return { timeout, triggeredRef: () => triggered };
}
function waitForElement(selector, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const element = document.querySelector(selector);
      if (element) return resolve(element);
      if (Date.now() - start > timeout) return reject(`⏰ Timeout: Element "${selector}" not found.`);
      requestAnimationFrame(check);
    };
    check();
  });
}
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const bidContainer = await waitForElement("#bidInputContainer");
    if (window.__autocompleteInitialized) {
      return;
    }

    initializeBidAutocomplete();
    window.__autocompleteInitialized = true;
  } catch (err) {
    console.warn(err);
  }
});

function initializeBidAutocomplete() {
  const bidContainer = document.getElementById("bidInputContainer");
  if (window.__autocompleteInitialized) return;
  if (!bidContainer) {
    console.warn("⚠️ #bidInputContainer not found");
    return;
  }

  let bidInput = document.querySelector("input.bid-autocomplete-input");
  if (!bidInput) {
    bidInput = document.createElement("input");
    bidInput.type = "text";
    bidInput.placeholder = "Enter Bid Name";
    bidInput.classList.add("autocomplete-input", "bid-autocomplete-input");
  }

  const autocompleteWrapper = document.createElement("div");
  autocompleteWrapper.classList.add("autocomplete-wrapper");

  const dropdown = document.createElement("div");
  dropdown.classList.add("autocomplete-dropdown");

  autocompleteWrapper.appendChild(bidInput);
  autocompleteWrapper.appendChild(dropdown);

  if (!bidContainer.querySelector(".autocomplete-wrapper")) {
    bidContainer.appendChild(autocompleteWrapper);
  }

  let highlightedIndex = -1; // tracks which option is highlighted

  if (!bidInput.dataset.listenerAttached) {
    bidInput.addEventListener("input", debounce(function () {
      const query = bidInput.value.toLowerCase();
      dropdown.innerHTML = "";
      highlightedIndex = -1;

      if (query.length < 1) {
        dropdown.style.display = "none";
        return;
      }

      const filtered = bidNameSuggestions
        .filter(s => s.toLowerCase().includes(query))
        .sort((a, b) => a.toLowerCase().indexOf(query) - b.toLowerCase().indexOf(query))
        .slice(0, 20);

      filtered.forEach(suggestion => {
        const option = document.createElement("div");
        option.classList.add("autocomplete-option");
        option.textContent = suggestion;

        // Base styles
        option.style.padding = "8px 12px";
        option.style.cursor = "pointer";

        // Hover styles via JS
        option.addEventListener("mouseenter", () => {
          option.style.setProperty("background-color", "#007BFF", "important");
          option.style.setProperty("color", "white", "important");
        });

        option.addEventListener("mouseleave", () => {
          option.style.removeProperty("background-color");
          option.style.removeProperty("color");
        });

        option.addEventListener("click", async () => {
          bidInput.value = suggestion;
          dropdown.innerHTML = "";
          dropdown.style.display = "none";
          await fetchDetailsByBidName(suggestion);
        });

        dropdown.appendChild(option);
      });

      dropdown.style.display = filtered.length > 0 ? "block" : "none";
    }, 300));

   // Keyboard navigation
bidInput.addEventListener("keydown", async (e) => {
  const options = dropdown.querySelectorAll(".autocomplete-option");

  if (["ArrowDown", "ArrowUp"].includes(e.key)) {
    if (options.length > 0) {
      e.preventDefault(); // 🚫 stop page from scrolling

      if (e.key === "ArrowDown") {
        highlightedIndex = (highlightedIndex + 1) % options.length;
      } else if (e.key === "ArrowUp") {
        highlightedIndex = (highlightedIndex - 1 + options.length) % options.length;
      }

      highlightOption(options, highlightedIndex);

      // Ensure highlighted option is always visible
      options[highlightedIndex].scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
    }
  } else if (e.key === "Enter") {
    if (highlightedIndex >= 0 && options[highlightedIndex]) {
      e.preventDefault(); // prevent form submit
      const selected = options[highlightedIndex];
      bidInput.value = selected.textContent;
      dropdown.innerHTML = "";
      dropdown.style.display = "none";
      await fetchDetailsByBidName(selected.textContent);
    }
  }
});

    bidInput.dataset.listenerAttached = "true";
  }

  window.__autocompleteInitialized = true;

  // Helper: Highlight an option
 function highlightOption(options, index) {
  options.forEach((opt, i) => {
    if (i === index) {
      opt.style.setProperty("background-color", "#007BFF", "important");
      opt.style.setProperty("color", "white", "important");
      opt.scrollIntoView({ block: "nearest" }); // keep visible
    } else {
      opt.style.removeProperty("background-color");
      opt.style.removeProperty("color");
    }
  });
}
function lockBodyScroll(lock) {
  if (lock) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}

// When dropdown opens:
dropdown.style.display = "block";
lockBodyScroll(true);

// When dropdown closes:
dropdown.style.display = "none";
lockBodyScroll(false);


    // ✅ Add scroll listener INSIDE where `dropdown` is defined
    dropdown.addEventListener("scroll", async function () {
        if (dropdown.scrollTop + dropdown.clientHeight >= dropdown.scrollHeight && offset) {
            const query = bidInput.value.toLowerCase();
            const newSuggestions = await fetchLazyBidSuggestions(query);
            const filtered = newSuggestions.filter(s => s.toLowerCase().includes(query));

            filtered.forEach(suggestion => {
                const option = document.createElement("div");
                option.classList.add("autocomplete-option");
                option.textContent = suggestion;

                option.addEventListener("click", () => {
                    bidInput.value = suggestion;
                    currentBidName = suggestion;
                    dropdown.innerHTML = "";

                    const overlay = document.getElementById('spanLoadingOverlay');
                    if (overlay) overlay.style.display = 'flex';

                    const { timeout, triggeredRef } = createSpanPopulationTimeout(overlay, 5000);

                    fetchDetailsByBidName(suggestion).then(() => {
                        const spanSelectors = [
                            '.gmNameContainer',
                            '.gmEmailContainer',
                            '.vendorNameContainer',
                            '.vendorEmailWrapper',
                            '.acmEmailContainer'
                        ];

                        const checkSpansReady = () => {
                            const allPopulated = spanSelectors.every(selector => {
                                const el = document.querySelector(selector);
                                return el && el.textContent.trim() !== '';
                            });

                            if (allPopulated) {
                                clearTimeout(timeout);
                                if (overlay) overlay.style.display = 'none';
                            } else {
                                setTimeout(checkSpansReady, 200);
                            }
                        };

                        checkSpansReady();
                    }).catch(err => {
                        clearTimeout(timeout);
                        if (overlay) overlay.style.display = 'none';
                        console.error("❌ Error fetching bid details:", err);
                    });
                });

                dropdown.appendChild(option);
            });
        }
    });
}

// Function to wait for the cc-email-container to exist in the DOM
async function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const interval = 50;
        const maxTries = timeout / interval;
        let tries = 0;

        const check = () => {
            const element = document.querySelector(selector); 
                        if (element) {
                resolve(element);
            } else if (++tries >= maxTries) {
                reject(new Error(`Timeout waiting for ${selector}`));
            } else {
                setTimeout(check, interval);
            }
        };
        check();
    });
}
/* =========================
   END: ORIGINAL APP CODE
========================= */

// Post-load: unify duplicate functions safely (use our canonical helpers)
(function(){
  const U = window.VanirApp && window.VanirApp.Utils;
  if (!U) return;
  // Replace duplicates with canonical versions
  try { window.updateMultipleSpans = function(selector, value){ U.setTextAll(selector, value); }; } catch(_){}
  try { window.waitForElement = U.waitForElement; } catch(_){}
  // highlightOption is coupled to currentOptions in your app; keep your latest definition to preserve behavior.
})();
/* =========================
   PHASE 2 PATCHES (unify internals)
========================= */
(function(){
  const VA = window.VanirApp || {};
  const U  = VA.Utils || {};
  const C  = VA.Cache || {};

  if (!window.__VANIR_PHASE2__) window.__VANIR_PHASE2__ = true;

  // 1) Replace common helpers globally to ensure one implementation
  try { window.debounce = U.debounce.bind(null); } catch(_){}
  try { window.waitForElement = U.waitForElement; } catch(_){}
  try { window.updateMultipleSpans = function(selector, value){ U.setTextAll(selector, value); }; } catch(_){}

  // 2) Standardize vendor/bid cache behavior to sessionStorage + TTL
  (function standardizeCaches(){
    const VKEY='cachedVendors', BKEY='cachedBidNames';
    const TTL = 30*60*1000; // 30 min

    function harmonize(key){
      const tsKey = key+':ts';
      // If legacy timestamp key exists under a different naming scheme, normalize it here (best-effort)
      // We simply keep whatever exists; future sets use our session TTL keys.
      const raw = sessionStorage.getItem(key);
      const ts  = sessionStorage.getItem(tsKey);
      if (raw && !ts) sessionStorage.setItem(tsKey, String(Date.now()));
    }

    harmonize(VKEY);
    harmonize(BKEY);

    // Expose simple getters for existing functions if they want them
    window.__phase2GetCache = function(key, ttlMs=TTL){
      try{
        const raw = sessionStorage.getItem(key);
        const ts  = Number(sessionStorage.getItem(key+':ts'));
        if (!raw || !ts) return null;
        if (Date.now()-ts > ttlMs) return null;
        return JSON.parse(raw);
      }catch{ return null; }
    };
    window.__phase2SetCache = function(key, val){
      try{
        sessionStorage.setItem(key, JSON.stringify(val));
        sessionStorage.setItem(key+':ts', String(Date.now()));
      }catch{}
    };
  })();

  // 3) Provide a single, explicit init that mirrors your DOMContentLoaded work (idempotent)
  //    This does NOT remove your existing handlers (the full refactor aggregates them already),
  //    but gives you one place to kick off everything if you ever want to.
  window.VanirApp = VA;
  VA.init = VA.init || (async function init(){
    if (VA.__inited) return; VA.__inited = true;

    try {
      // Template + base UI
      if (typeof displayEmailContent === 'function') displayEmailContent();
      if (typeof ensureDynamicContainerExists === 'function') ensureDynamicContainerExists();
      if (typeof setupCopySubEmailsButton === 'function') setupCopySubEmailsButton();
      if (typeof monitorSubdivisionChanges === 'function') monitorSubdivisionChanges();
      if (typeof renderBidInputImmediately === 'function') renderBidInputImmediately();

      // Load vendors and bids before wiring autocomplete
      if (typeof fetchAllVendorData === 'function') await fetchAllVendorData();
      if (typeof fetchBidNameSuggestions === 'function') await fetchBidNameSuggestions();

      // Initialize bid autocomplete once
      try {
        if (!window.__autocompleteInitialized && typeof initializeBidAutocomplete === 'function') {
          // Ensure container exists
          if (typeof waitForOrCreateBidInputContainer === 'function') {
            await waitForOrCreateBidInputContainer();
          } else {
            await U.waitForElement('#bidInputContainer').catch(()=>{});
          }
          initializeBidAutocomplete();
          window.__autocompleteInitialized = true;
        }
      } catch(e){ console.warn('init: autocomplete', e); }

      // Observers for city inputs
      try {
        if (typeof syncCityInputs === 'function') {
          const bodyObserver = new MutationObserver(() => {
            const inputs = document.querySelectorAll('input.city');
            if (inputs.length >= 2) { syncCityInputs(); bodyObserver.disconnect(); }
          });
          bodyObserver.observe(document.body, { childList:true, subtree:true });
        }
      } catch(e){ console.warn('init: city observer', e); }

      // Optional: textarea auto-resize hook if function exists
      try {
        const emailContainer = document.getElementById('emailTemplate');
        if (emailContainer) {
          const obs = new MutationObserver(muts=>{
            muts.forEach(m=> m.addedNodes.forEach(n=>{
              if (n.tagName === 'TEXTAREA' && (n.id==='additionalInfoInput'||n.id==='additionalInfoInputSub')){
                n.addEventListener('input', function(){ this.style.height='auto'; this.style.height=`${this.scrollHeight}px`; });
              }
            }));
          });
          obs.observe(emailContainer, {childList:true, subtree:true});
        }
      } catch(e){ console.warn('init: textarea observer', e); }

      // Wire change/clear vendor buttons if present
      try {
        const clearBtn = document.getElementById('clearVendorBtn');
        if (clearBtn && !clearBtn.dataset.bound) {
          clearBtn.dataset.bound = '1';
          clearBtn.addEventListener('click', ()=>{
            document.querySelectorAll('.vendorNameContainer').forEach(el=> el.textContent='');
            document.querySelectorAll('.vendorEmailWrapper').forEach(el=> el.textContent='');
            window.currentVendorEmail = '';
          });
        }
      } catch(e){ console.warn('init: clear vendor', e); }

      // Progress overlay, if defined
      try {
        if (typeof isBidInputVisible === 'function' && typeof autoProgressLoading === 'function') {
          autoProgressLoading(isBidInputVisible);
        }
      } catch(e){ console.warn('init: progress', e); }

    } catch (err) {
      console.error('[Phase2 init error]', err);
    }
  });

  // If DOM is already ready, run immediately
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    window.requestAnimationFrame(()=> VA.init().catch(console.error));
  } else {
    document.addEventListener('DOMContentLoaded', ()=> VA.init().catch(console.error), { once:true });
  }
})();




(function AutoFlagOnSendSelectedEmailsIIFE(){
  const BTN_ID = "sendSelectedEmails";

  function uniqStrings(arr){
    const s = new Set();
    (arr || []).forEach(v => {
      const k = String(v || "").trim();
      if (k) s.add(k);
    });
    return [...s];
  }

  function getSelectedRecordIdsFallback(){
    const out = new Set();
    const nodes = document.querySelectorAll(
      '[data-record-id].selected, ' +
      'input[type="checkbox"][data-record-id]:checked, ' +
      'input[type="checkbox"][name*="select"][data-record-id]:checked, ' +
      'tr[aria-selected="true"][data-record-id], ' +
      '.record-row.selected[data-record-id], ' +
      '.is-selected[data-record-id], ' +
      '[data-select="email"][data-record-id].selected'
    );
    nodes.forEach(el => {
      const id = el.getAttribute('data-record-id') || (el.dataset ? el.dataset.recordId : '') || '';
      if (id) out.add(String(id));
    });
    return [...out];
  }

  async function safeInvokeGetter(fn){
    try{
      const v = fn();
      if (v && typeof v.then === "function") {
        return await v;
      }
      return v;
    } catch (e){
      console.warn("[EmailFlag] getSelectedRecordIds() threw; using fallback. Details:", e);
      return null;
    }
  }

  async function onClickHandler(ev){
    try{
      let ids = [];
      const hasGetter = (typeof window.getSelectedRecordIds === 'function');
      if (hasGetter){
        const res = await safeInvokeGetter(window.getSelectedRecordIds);
        if (Array.isArray(res)) ids = res;
      }
      if (!Array.isArray(ids) || ids.length === 0){
        ids = getSelectedRecordIdsFallback();
      }
      ids = uniqStrings(ids);

      if (ids.length === 0){
        console.warn('[EmailFlag] No selected record IDs found to flag.');
        return;
      }

      for (const recordId of ids){
        try{
          await markWinningTemplateExported({ recordId, templateName: 'Winning' });
        } catch (e) {
          console.error('[EmailFlag] Failed to flag record', recordId, e);
        }
      }

      if (typeof window.showToast === 'function'){
        window.showToast(`Flagged ${ids.length} record${ids.length>1?'s':''} as "Winning" used for email.`);
      } else {
        console.log(`[EmailFlag] Flagged ${ids.length} selected record(s) as used for email (Winning).`);
      }
    } catch (err){
      console.error('[EmailFlag] Error in click handler:', err);
    }
  }

  function attach(){
    const btn = document.getElementById(BTN_ID);
    if (!btn) {
      // Late-binding if the button is rendered later
      const obs = new MutationObserver(() => {
        const b = document.getElementById(BTN_ID);
        if (b){
          b.addEventListener('click', onClickHandler, { capture: false });
          obs.disconnect();
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      return;
    }
    btn.addEventListener('click', onClickHandler, { capture: false });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();

(function EmailExportFlaggingIIFE() {
  const AIRTABLE_API = "https://api.airtable.com/v0";

  // Defensive global fallbacks: if your script defines these elsewhere, the helpers will pick them up.
  function getDefault(k, fallback) {
    try { return (typeof window !== "undefined" && window[k]) ? window[k] : (typeof globalThis !== "undefined" && globalThis[k]) ? globalThis[k] : fallback; }
    catch (_) { return fallback; }
  }

  // Normalize strings for fuzzy field-name matching
  function normFieldName(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[\s_\-()]/g, "")  // strip common separators
      .replace(/[^a-z0-9]/g, ""); // letters/numbers only
  }

  // Try to pick the first candidate that exists on the record
  function pickExistingFieldName(existingNames, candidates) {
    const normalized = existingNames.map(n => ({ raw: n, norm: normFieldName(n) }));
    for (const cand of candidates) {
      const nc = normFieldName(cand);
      const hit = normalized.find(e => e.norm === nc);
      if (hit) return hit.raw; // return original-cased exact field name
    }
    // If no exact normalized match, try "contains" style match as a fallback, but prefer exact in practice
    for (const cand of candidates) {
      const nc = normFieldName(cand);
      const hit = normalized.find(e => e.norm.includes(nc) || nc.includes(e.norm));
      if (hit) return hit.raw;
    }
    return null;
  }

  async function airtableGetRecord({ baseId, tableId, recordId, apiKey }) {
    const url = `${AIRTABLE_API}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}/${encodeURIComponent(recordId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GET record failed (${res.status}): ${text || res.statusText}`);
    }
    return res.json();
  }

  async function airtablePatchRecord({ baseId, tableId, recordId, apiKey, fields }) {
    const url = `${AIRTABLE_API}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}/${encodeURIComponent(recordId)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`PATCH failed (${res.status}): ${text || res.statusText}`);
    }
    return res.json();
  }

  function dedupeKey(recordId, templateName) {
    return `emailFlag:${recordId}:${String(templateName || "Winning")}`;
  }

  function recentlyFlagged(recordId, templateName, windowMs = 5 * 60 * 1000) { // 5 minutes
    try {
      const key = dedupeKey(recordId, templateName);
      const t  = Number(localStorage.getItem(key) || "0");
      return (Date.now() - t) < windowMs;
    } catch (_) { return false; }
  }

  function setFlaggedNow(recordId, templateName) {
    try {
      localStorage.setItem(dedupeKey(recordId, templateName), String(Date.now()));
    } catch (_) {}
  }

  /**
   * Mark "Winning template exported to Gmail" for a specific record.
   * Tries to set any/all of these fields if they exist on the record:
   *   - Checkbox-ish: ["Used for email (Winning Email Template)", "Used for email - Winning", "Used for Email", "Winning Email Template Used"]
   *   - Text-ish:     ["Email Template Used", "Template Used", "Winning Template Used", "Email Template Name"]
   *   - Datetime-ish: ["Email Exported At", "Email Template Exported At", "Template Exported At", "Winning Exported At"]
   */
  async function markWinningTemplateExported(opts) {
    const {
      recordId,
      templateName = "Winning",
      gmailUrl = "",
      // Fallbacks to globals if not provided:
      baseId = getDefault("BASE_ID"),
      tableId = getDefault("TABLE_ID"),
      apiKey = getDefault("AIRTABLE_API_KEY"),
      // optional: override dedupe window
      dedupeWindowMs = 5 * 60 * 1000,
      // optional: log function
      logger = console,
    } = (opts || {});

    if (!recordId) throw new Error("markWinningTemplateExported: 'recordId' is required.");
    if (!baseId || !tableId || !apiKey) {
      throw new Error("markWinningTemplateExported: baseId, tableId, and apiKey are required (or define globals BASE_ID, TABLE_ID, AIRTABLE_API_KEY).");
    }

    try {
      if (recentlyFlagged(recordId, templateName, dedupeWindowMs)) {
        logger?.log?.(`[EmailFlag] Skipping; already flagged recently for record ${recordId} + template "${templateName}".`);
        return { skipped: true };
      }

      // Fetch record to see which fields exist
      const rec = await airtableGetRecord({ baseId, tableId, recordId, apiKey });
      const existingNames = Object.keys(rec?.fields || {});

      // Decide which fields to set
      const checkboxField = pickExistingFieldName(existingNames, [
        "Used for email (Winning Email Template)",
        "Used for email - Winning",
        "Used for Email",
        "Winning Email Template Used",
        "Used for email winning email template"
      ]);

      const textField = pickExistingFieldName(existingNames, [
        "Email Template Used",
        "Email Template Name",
        "Template Used",
        "Winning Template Used",
      ]);

      const dateField = pickExistingFieldName(existingNames, [
        "Email Exported At",
        "Email Template Exported At",
        "Template Exported At",
        "Winning Exported At",
      ]);

      const historyField = pickExistingFieldName(existingNames, [
        "Email Export History",
        "Template Export History",
        "Email History",
      ]);

      const patch = {};
      if (checkboxField) patch[checkboxField] = true;
      if (textField)     patch[textField]     = String(templateName || "Winning");
      if (dateField)     patch[dateField]     = new Date().toISOString();

      // Append a short history line if a suitable long-text field exists
      if (historyField) {
        const stamp = new Date().toISOString();
        const msg   = `[${stamp}] Exported "${templateName}" to Gmail${gmailUrl ? " -> " + gmailUrl : ""}`;
        const prior = String(rec.fields[historyField] || "");
        patch[historyField] = prior ? (prior + "\n" + msg) : msg;
      }

      if (Object.keys(patch).length === 0) {
        logger?.warn?.("[EmailFlag] No matching fields found on record to mark. (Add one of the suggested field names.)");
        return { patched: false, reason: "no_fields" };
      }

      // Patch it
      const result = await airtablePatchRecord({ baseId, tableId, recordId, apiKey, fields: patch });
      setFlaggedNow(recordId, templateName);
      logger?.log?.(`[EmailFlag] Marked record ${recordId} as exported for "${templateName}".`, { usedFields: Object.keys(patch) });
      return { patched: true, usedFields: Object.keys(patch), result };
    } catch (err) {
      console.error("[EmailFlag] Failed to mark export:", err);
      return { patched: false, error: String(err && err.message || err) };
    }
  }

  // Convenience wrapper to both open Gmail and flag the record
  async function openGmailAndFlag(opts) {
    const { gmailUrl, logger = console } = (opts || {});
    if (!gmailUrl) throw new Error("openGmailAndFlag: 'gmailUrl' is required.");
    try {
      // Try opening Gmail first so user action isn't blocked by network
      window.open(gmailUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      logger?.warn?.("[EmailFlag] Could not open Gmail window. Proceeding to mark anyway.", e);
    }
    // Now mark it
    return markWinningTemplateExported(opts);
  }

  // Expose to global
  try {
    if (typeof window !== "undefined") {
      window.markWinningTemplateExported = markWinningTemplateExported;
      window.openGmailAndFlag = openGmailAndFlag;
    }
    if (typeof globalThis !== "undefined") {
      globalThis.markWinningTemplateExported = markWinningTemplateExported;
      globalThis.openGmailAndFlag = openGmailAndFlag;
    }
  } catch (_) {}

})(); // end IIFE

/* === Adaptive Loading Tracker =========================================== */
(() => {
  if (window.VanirLoad) return; // singleton

  class RollingRate {
    constructor(alpha=0.25) { this.alpha = alpha; this.rate = 0; this.lastT = 0; this.lastC = 0; }
    mark(t, c){
      if (!this.lastT) { this.lastT = t; this.lastC = c; return; }
      const dt = Math.max(0.001, (t - this.lastT)/1000);
      const dc = Math.max(0, c - this.lastC);
      const inst = dc / dt;                 // units per second
      this.rate = this.rate ? (this.alpha*inst + (1-this.alpha)*this.rate) : inst;
      this.lastT = t; this.lastC = c;
    }
    getRate(){ return this.rate || 0; }
  }

  // Internal overlay DOM
  function ensureOverlay(){
    let ov = document.getElementById('vanirLoaderOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'vanirLoaderOverlay';
    ov.innerHTML = `
      <div class="vanir-loader-card" role="status" aria-live="polite">
        <div class="vl-head">
          <div class="vl-title">Preparing data…</div>
        </div>
        <div class="vl-sub">Fetching winning bids, vendors, and wiring inputs.</div>
        <div class="vl-bar"><div class="vl-fill" id="vlFill"></div></div>
        <div class="vl-meta">
          <div class="vl-rows" id="vlRows">0 records</div>
          <div class="vl-eta" id="vlEta">ETA —</div>
        </div>
        <div class="vl-steps" id="vlSteps">
          <div class="vl-step" data-step="bids"><span class="vl-dot"></span>Bids <small id="vlBidsMeta"></small></div>
          <div class="vl-step" data-step="vendors"><span class="vl-dot"></span>Vendors <small id="vlVendorsMeta"></small></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    return ov;
  }
  function setStepState(step, state){ // state: 'idle' | 'active' | 'done'
    const el = document.querySelector(`.vl-step[data-step="${step}"]`);
    if (!el) return;
    el.classList.remove('idle','active','done');
    el.classList.add(state);
  }
  function fmt(n){ return (n||0).toLocaleString(); }
function fmtTime(sec){
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 1.5) return '<2s';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec/60), s = Math.round(sec%60);
  return `${m}m ${s}s`;
}
  class AdaptiveTask {
    constructor(name, weight){
      this.name = name; this.weight = weight;
      this.pages = 0; this.records = 0;
      this.estimateTotalPages = 1; // adaptive total; grows as we see offsets
      this.rate = new RollingRate(0.3);
      this.started = 0; this.done = false;
    }
    start(){ this.started = Date.now(); setStepState(this.name, 'active'); }
    tickPage(recCountOnPage){
      this.pages += 1;
      this.records += (recCountOnPage || 0);
      // When a page arrives, we "predict" at least one more page exists until proven done
      // so total = max(current+1, previous total) — keeps progress < 100% while fetching.
      this.estimateTotalPages = Math.max(this.estimateTotalPages, this.pages + 1);
      this.rate.mark(Date.now(), this.pages);
    }
    markHasMore(){ this.estimateTotalPages = Math.max(this.estimateTotalPages, this.pages + 1); }
    finish(){
      this.done = true;
      this.estimateTotalPages = Math.max(this.pages, this.estimateTotalPages);
      setStepState(this.name, 'done');
    }
    progress(){ // 0..1 for this task
      const denom = Math.max(1, this.estimateTotalPages);
      return Math.min(1, this.pages / denom);
    }
    etaSeconds(){
      const r = this.rate.getRate(); // pages/sec
      if (!r) return NaN;
      const remainPages = Math.max(0, this.estimateTotalPages - this.pages);
      return remainPages / r;
    }
  }

  class AdaptiveLoader {
    constructor(){
      this.tasks = {
        bids: new AdaptiveTask('bids', 0.5),
        vendors: new AdaptiveTask('vendors', 0.5),
      };
      this.overlay = null;
      this.timer = null;
    }
    show(){
      if (!this.overlay) this.overlay = ensureOverlay();
      // initial step states
      setStepState('bids','active');
      setStepState('vendors','idle');
      this.loop();
    }
    hide(){
      if (this.timer) { cancelAnimationFrame(this.timer); this.timer = null; }
      const ov = this.overlay;
      if (ov) { ov.style.opacity = '0'; setTimeout(()=> ov.remove(), 220); }
      this.overlay = null;
    }
    // public hooks you can call from your fetchers
    startTask(name){ this.tasks[name]?.start(); if (!this.overlay) this.show(); }
    pageArrived(name, recordsOnThisPage, hasMore){
      const t = this.tasks[name]; if (!t) return;
      t.tickPage(recordsOnThisPage);
      if (hasMore) t.markHasMore();
    }
    done(name){ this.tasks[name]?.finish(); }
    loop = () => {
      const fill = document.getElementById('vlFill');
      const rows = document.getElementById('vlRows');
      const eta  = document.getElementById('vlEta');
      const bidsMeta = document.getElementById('vlBidsMeta');
      const vendMeta = document.getElementById('vlVendorsMeta');

      const b = this.tasks.bids, v = this.tasks.vendors;

      const pct = Math.round(100 * (b.progress()*b.weight + v.progress()*v.weight));
      if (fill) fill.style.width = `${pct}%`;

      const totalRecs = (b.records + v.records);
      const totalPages = (b.pages + v.pages);
      if (rows) rows.textContent = `${fmt(totalRecs)} records • ${fmt(totalPages)} pages`;

      if (bidsMeta)   bidsMeta.textContent = `${fmt(b.records)} rec `;
      if (vendMeta)   vendMeta.textContent = `${fmt(v.records)} rec `;

      // ETA: sum of per-task ETA (weighted by how incomplete they are)
      const etaB = b.done ? 0 : b.etaSeconds();
      const etaV = v.done ? 0 : v.etaSeconds();
      const etaMix = (Number.isFinite(etaB)?etaB:0) + (Number.isFinite(etaV)?etaV:0);
      if (eta) eta.textContent = `ETA ${fmtTime(etaMix)}`;

      if (b.done && v.done) { this.hide(); return; }
      this.timer = requestAnimationFrame(this.loop);
    }
  }

  window.VanirLoad = new AdaptiveLoader();
})();
