
// Required constants and helper functions
const airtableApiKey = 'patCnUsdz4bORwYNV.5c27cab8c99e7caf5b0dc05ce177182df1a9d60f4afc4a5d4b57802f44c65328';
const bidBaseName = 'appK9gZS77OmsIK50';
const bidTableName = 'tblQo2148s04gVPq1';
const viewId = "viwTnwtcQkhpZEJ3q";
const baseId = "appK9gZS77OmsIK50";
const tableId = "tblQo2148s04gVPq1";
const PAGE_SIZE = 100; // max allowed
let offset = null;

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
function updateAutocompleteOptions(type, newSuggestions = []) {
    const input = document.querySelector(`.${type}-autocomplete-input`);
    const dropdown = document.querySelector(`.${type}-autocomplete-dropdown`);

    if (!input || !dropdown) {
        console.warn(`⚠️ Autocomplete elements for "${type}" not found.`);
        return;
    }

    // Clear previous suggestions
    dropdown.innerHTML = '';

    // Store filtered options so arrow navigation still works
    const currentOptions = [];

    newSuggestions.forEach(suggestion => {
        const text = typeof suggestion === 'string' ? suggestion : suggestion.companyName;
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

async function fetchAllVendorData() {
    const cacheKey = 'cachedVendors';
    const cacheTimestampKey = 'cachedVendorsTimestamp';
    const cacheTTL = 1000 * 60 * 30; // 30 minutes

    console.log("🔍 Checking vendor data cache...");

    const cachedData = sessionStorage.getItem(cacheKey);
    const cachedTime = sessionStorage.getItem(cacheTimestampKey);

    const isValidCache = cachedData && cachedTime && (Date.now() - parseInt(cachedTime)) < cacheTTL;

    if (isValidCache) {
        console.log("✅ Using cached vendor data (still valid).");
        vendorData = JSON.parse(cachedData);
        console.log(`📦 Cached vendors loaded: ${vendorData.length} records`);
        return;
    } else {
        console.log("⚠️ Cache is empty or expired. Fetching from Airtable...");
    }

    try {
        let allRecords = [];
        let offset = null;
        let requestCount = 0;

        do {
            let url = `https://api.airtable.com/v0/${VendorBaseName}/${VendorTableName}?pageSize=100`;
            if (offset) url += `&offset=${offset}`;

            requestCount++;
            console.log(`📡 Fetching batch #${requestCount} from Airtable...`);
            console.log(`➡️ URL: ${url}`);

            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${airtableApiKey}`,
                },
            });

            if (!response.ok) {
                console.error(`❌ HTTP Error: ${response.status} - ${response.statusText}`);
                break;
            }

            const data = await response.json();
            console.log(`📥 Received ${data.records.length} records`);

            allRecords = allRecords.concat(data.records);
            offset = data.offset;

            if (offset) {
                console.log("➡️ More records available, continuing with offset:", offset);
            } else {
                console.log("✅ All records fetched, no more offset.");
            }

        } while (offset);

        vendorData = allRecords.map(record => ({
            name: record.fields['Name'] || "Unknown Vendor",
            email: record.fields['Email'] || null,
        }));

        console.log(`📊 Total vendors after mapping: ${vendorData.length}`);

        vendorData.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        console.log("🔤 Vendors sorted alphabetically by name.");

        sessionStorage.setItem(cacheKey, JSON.stringify(vendorData));
        sessionStorage.setItem(cacheTimestampKey, Date.now().toString());

        console.log("💾 Vendor data cached in sessionStorage.");

    } catch (error) {
        console.error("❌ Error fetching vendor data:", error);
    }
}

document.getElementById("clearCacheBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("cachedBidNames");
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
async function fetchBidNameSuggestions() {
    const cacheKey = 'cachedBidNames';
    const cacheTimestampKey = 'cachedBidNamesTimestamp';
    const cacheTTL = 1000 * 60 * 30; // 30 minutes
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTime = localStorage.getItem(cacheTimestampKey);
    const isValidCache = cachedData && cachedTime && (Date.now() - parseInt(cachedTime)) < cacheTTL;

    if (isValidCache) {
        bidNameSuggestions = JSON.parse(cachedData);
        return;
    }

    const records = await fetchAirtableData(bidBaseName, bidTableName, 'Bid Name', "{Outcome}='Win'");
    bidNameSuggestions = records.map(record => record.fields['Bid Name']).filter(Boolean);

 sessionStorage.setItem(cacheKey, JSON.stringify(bidNameSuggestions));
sessionStorage.setItem(cacheTimestampKey, Date.now().toString());

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

async function fetchDetailsByBidName(bidName) {
    clearAllDynamicSpans();


const filterFormula = `AND({Bid Name} = "${bidName.trim()}", {Outcome}='Win')`;
const records = await fetchAirtableData(bidBaseName, bidTableName, '', filterFormula);

console.log("🔍 Matching bid records:", records.map(r => ({
  bid: r.fields['Bid Name'],
  branch: r.fields['Branch'],
  id: r.id
})));

const exactMatch = records.find(rec =>
  (rec.fields['Bid Name'] || '').trim().toLowerCase() === bidName.trim().toLowerCase()
);

if (!exactMatch) {
  console.warn("❌ No exact match found for:", bidName);
  return;
}

const fields = exactMatch.fields;
console.log("✅ Using branch:", fields['Branch']);

    if (records.length > 0) {
        const fields = records[0].fields;
        const acmEmail = fields["Field's Email"] || '';
        const builder = fields['Builder'] || 'Unknown Builder';
        const gmEmail = fields['GM Email'] ? fields['GM Email'][0] : 'Branch Staff@Vanir.com';
        const branch = fields['Branch'] || 'Unknown Branch';
        const projectType = fields['Project Type'] || '';
        const materialType = fields['Material Type'] || '';
        const numberOfLots = fields['Number of Lots'] || '';
        const anticipatedStartDate = fields['Anticipated Start Date'] || '';
        const AnticipatedDuration = fields['Anticipated Duration'];
        const materialsNeeded = fields['Materials Needed'] || '';

        if (branch) {
            await fetchSubcontractorSuggestions(branch);
        } else {
            console.warn("⚠️ No branch found in bid details, skipping subcontractor fetch.");
        }

        // 🔁 Vendor Matching Logic
        let vendorRaw = fields['vendor'] || '';
        if (Array.isArray(vendorRaw)) {
            vendorRaw = vendorRaw[0] || '';
        }
        const vendorNormalized = typeof vendorRaw === 'string' ? vendorRaw.toLowerCase().trim() : '';

        let matchingVendors = vendorData.filter(v =>
            v.name?.toLowerCase().trim() === vendorNormalized
        );

        if (matchingVendors.length === 0) {
            const firstWord = vendorNormalized.split(" ")[0];
            matchingVendors = vendorData.filter(v => {
                const name = v.name?.toLowerCase() || '';
                const email = v.email?.toLowerCase() || '';
                return name.includes(firstWord) || email.includes(firstWord);
            });
        }

        // ✅ Wait for elements to exist
        await waitForElement('.gmNameContainer');

       if (matchingVendors.length === 1) {
    const matched = matchingVendors[0];
    window.currentVendorEmail = matched.email;
updateMultipleSpans('.bidNameContainer', bidName);

    updateMultipleSpans('.vendorNameContainer', matched.name);
    updateMultipleSpans('.vendorEmailWrapper', ` <${matched.email}>`);

        } else if (matchingVendors.length > 1) {
            const branchText = document.querySelector('.branchContainer')?.textContent.trim().toLowerCase();
            if (branchText) {
                const narrowedMatches = matchingVendors.filter(vendor =>
                    vendor.name?.toLowerCase().includes(branchText) ||
                    vendor.email?.toLowerCase().includes(branchText)
                );

                if (narrowedMatches.length === 1) {
                    const matched = narrowedMatches[0];
                    window.currentVendorEmail = matched.email;

                    document.querySelectorAll('.vendorNameContainer').forEach(el => el.textContent = matched.name);
                    document.querySelectorAll('.vendorEmailWrapper').forEach(el => el.textContent = ` <${matched.email}>`);
                    return;
                } else if (narrowedMatches.length > 1) {
                    renderMatchingVendorsToDropdown(matchingVendors);
                    return;
                }
            }
            renderMatchingVendorsToDropdown(matchingVendors);
        } else {
            console.warn(`⚠️ No close vendor matches for "${vendorRaw}" — showing all vendors`);
            renderMatchingVendorsToDropdown([...matchingVendors]);
        }

        // Set remaining fields to spans
       const gm = fields['GM Named']
    ? (Array.isArray(fields['GM Named']) ? fields['GM Named'][0] : fields['GM Named'])
    : deriveNameFromEmail(gmEmail);

// ✅ Use helper for all span population
updateMultipleSpans('.gmNameContainer', gm);
updateMultipleSpans('.gmEmailContainer', gmEmail);
updateMultipleSpans('.acmEmailContainer', acmEmail);

window.currentVendorEmail = vendoremail;

        updateTemplateText(
            bidName,
            builder,
            gmEmail,
            branch,
            projectType,
            materialType,
            numberOfLots,
            anticipatedStartDate,
            vendorRaw,
            AnticipatedDuration,
            gm,
            vendoremail,
            acmEmail
        );

        updateSubcontractorAutocomplete();

        return {
            builder,
            gmEmail,
            branch,
            projectType,
            materialType,
            numberOfLots,
            anticipatedStartDate,
            vendorRaw,
            AnticipatedDuration,
            gm,
            vendoremail,
        };
    } else {
        console.warn("No bid found for the given name:", bidName);
        return {};
    }
}

function showVendorSelectionDropdown(vendorMatches) {
    const container = document.getElementById("vendorEmailContainer");
    if (!container) {
        console.error("No #vendorEmailContainer found.");
        return;
    }

    // Clear any existing dropdown
    const existing = container.querySelector(".vendor-select-dropdown");
    if (existing) existing.remove();

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search vendor...";
    searchInput.style.width = "100%";
    searchInput.style.marginBottom = "10px";
    searchInput.style.padding = "5px";

    const list = document.createElement("div");

function renderList(filteredVendors) {
        list.innerHTML = "";
        if (!filteredVendors.length) {
            list.innerHTML = "<p>No matching vendors found.</p>";
            return;
        }

        filteredVendors.forEach(vendor => {
            const option = document.createElement("div");
            option.className = "vendor-select-option";
            option.style.cursor = "pointer";
            option.style.padding = "5px 0";
option.innerHTML = `<strong>${vendor.name}</strong><br><small>${vendor.email}</small>`;

option.addEventListener("click", () => {
    window.currentVendorEmail = vendor.email;

    document.querySelectorAll('.vendorNameContainer').forEach(el => el.textContent = vendor.name);
    document.querySelectorAll('.vendorEmailWrapper').forEach(el => el.textContent = ` <${vendor.email}>`);

    wrapper.remove(); // Close dropdown
});
            list.appendChild(option);
        });
    }

    renderList(vendorMatches); // initial render

    searchInput.addEventListener("input", () => {
        const query = searchInput.value.trim().toLowerCase();
        const filtered = vendorMatches.filter(v =>
            v.name?.toLowerCase().includes(query) || v.email?.toLowerCase().includes(query)
        );
        renderList(filtered);
    });
}

function renderMatchingVendorsToDropdown(matchingVendors) {
    const dropdown = document.querySelector('.vendor-autocomplete-dropdown');
    if (!dropdown) {
        console.error("Dropdown container not found.");
        return;
    }

    dropdown.innerHTML = ''; // Clear any previous results

    if (!Array.isArray(matchingVendors) || matchingVendors.length === 0) {
        dropdown.innerHTML = '<p>No matching vendors found.</p>';
        return;
    }

    matchingVendors.forEach(vendor => {
        const option = document.createElement('div');
        option.className = 'vendor-autocomplete-option';
        option.style.cursor = 'pointer';
        option.style.padding = '8px 10px';
        option.style.borderBottom = '1px solid #eee';
        const email = vendor.email ? `<br><small>${vendor.email}</small>` : `<br><small style="color:gray;">(no email)</small>`;
        option.innerHTML = `<strong>${vendor.name}</strong>${email}`;

        option.addEventListener('click', () => {
            window.currentVendorEmail = vendor.email;
            document.querySelectorAll('.vendorNameContainer').forEach(el => el.textContent = vendor.name);
            document.querySelectorAll('.vendorEmailWrapper').forEach(el => el.textContent = ` <${vendor.email || ''}>`);
            dropdown.innerHTML = ''; // Close dropdown
        });

        dropdown.appendChild(option);
    });

    dropdown.style.display = 'block';
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

// --- Spinner / loading UI ---
const loadingSpinner = document.createElement("div");
loadingSpinner.className = "autocomplete-loading";
loadingSpinner.innerHTML = `
  <span class="spinner" style="display:inline-block;vertical-align:middle;margin-right:8px;"></span>
  <span style="color:#888;font-size:24px;">Loading bids...</span>
`;
loadingSpinner.style.display = disabled ? "block" : "none";

    // Optionally disable input
    if (disabled) {
        input.disabled = true;
        input.style.background = "#f5f5f5";
        input.style.color = "#bbb";
        input.style.cursor = "not-allowed";
    }

    const dropdown = document.createElement("div");
    dropdown.classList.add(`${type}-autocomplete-dropdown`, "autocomplete-dropdown");

    let currentFocusIndex = -1; // Tracks arrow key focus
    let currentOptions = [];    // Cache for clickable options

    input.addEventListener("input", async function () {
        const inputValue = input.value.toLowerCase();
        dropdown.innerHTML = '';
        currentFocusIndex = -1;
        currentOptions = [];

        if (suggestions && Array.isArray(suggestions)) {
            const filteredSuggestions = suggestions.filter(item => {
                const text = typeof item === 'string' ? item : item.companyName;
                return text.toLowerCase().includes(inputValue);
            });

            filteredSuggestions.forEach((suggestion, index) => {
                const text = typeof suggestion === 'string' ? suggestion : suggestion.companyName;
                const option = document.createElement("div");
                option.classList.add(`${type}-autocomplete-option`, "autocomplete-option");
                option.textContent = text;

                option.addEventListener("click", () => {
                    input.value = text;
                    dropdown.innerHTML = '';
                    fetchDetailsCallback?.(suggestion);
                });

                dropdown.appendChild(option);
                currentOptions.push(option);
            });

            dropdown.style.display = filteredSuggestions.length > 0 ? 'block' : 'none';
        }

        if (fetchDetailsCallback && inputValue.length > 0) {
            const details = await fetchDetailsCallback(inputValue);
            if (details?.city) {
                const citySpan = document.querySelector(".city");
                if (citySpan) citySpan.innerText = details.city;
            }
        }
    });

 input.addEventListener("keydown", (e) => {
    if (!currentOptions.length) return;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        currentFocusIndex = (currentFocusIndex + 1) % currentOptions.length;
        highlightOption(currentFocusIndex);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        currentFocusIndex = (currentFocusIndex - 1 + currentOptions.length) % currentOptions.length;
        highlightOption(currentFocusIndex);
    } else if (e.key === "Enter") {
        e.preventDefault();
        if (currentFocusIndex >= 0) {
            currentOptions[currentFocusIndex].click();
        }
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

    // --- Add helper method to enable input and hide spinner ---
    wrapper.enableInput = function () {
        input.disabled = false;
        input.style.background = "";
        input.style.color = "";
        input.style.cursor = "";
        loadingSpinner.style.display = "none";
        input.focus();
    };

    return wrapper;

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

document.addEventListener("DOMContentLoaded", async () => {
  const bidContainer = await waitForOrCreateBidInputContainer();
  initializeBidAutocomplete(); // now safe to call
});
document.querySelectorAll('.bidNameContainer').forEach(el => {
  el.textContent = selectedBidName;
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    // 1️⃣ Initialize your static template content
    displayEmailContent();
    ensureDynamicContainerExists();
    setupCopySubEmailsButton();
    monitorSubdivisionChanges();

    // 1.5️⃣ Render bid input immediately as disabled/loading
    renderBidInputImmediately(); // <--- this renders the input DISABLED with spinner

    // 2️⃣ Always fetch vendor and bid data first — BEFORE initializing autocomplete logic
    await fetchAllVendorData();
    await fetchBidNameSuggestions(); // 🚩 Ensure bidNameSuggestions[] is ready!

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
    createVendorAutocompleteInput();

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
    textareaObserver.observe(document.body, { childList: true, subtree: true });

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
rick.jinkins@vanirinstalledsales.com, 
josh@vanirinstalledsales.com, 
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
    "josh@vanirinstalledsales.com",
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
async function generateMailtoLinks() {
    try {

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
    vendorEmail,
    vendorEmailWrapper
} = getSharedFieldValues();

if (vendorEmailWrapper) {
    if (vendorEmail !== 'Not Specified' && vendorEmail.includes('@')) {
        vendorEmailWrapper.textContent = ` <${vendorEmail}>`;
    } else {
        vendorEmailWrapper.textContent = '';
    }
}

        // Fetch user signature inputs
        const userNameInput = await waitForElement('#inputUserName');
        const userPhoneInput = await waitForElement('#inputUserPhone');
        const userName = userNameInput.value.trim() || 'Your Name';
        const userPhone = userPhoneInput.value.trim() || 'Your Phone';
        const managementSubject = `Another WIN for Vanir - ${branch} - ${subdivision} - ${builder}`;
        const managementBody = `
        Go !! ${branch},
        
        Major Win with ${builder}!
        
        Here's the breakdown:

        Community Name: 
        - Field Contact: ${cname}


        - ${projectType}
        - Expected Pace: ${epace} ${epace > 1 ? 'days' : 'day'}
        - Expected Start Date: ${anticipatedStartDate}
        - Number of Lots: ${numberOfLots}
        - Special Pricing: ${sprice}
        - PO Customer: ${poCustomer}
        - Material Type: ${materialType}
            
        Kind regards,  
        ${userName}  
        Vanir Installed Sales ${branch || 'LLC'}
        Phone: ${userPhone}  
        https://www.vanirinstalledsales.com  
        Better Look. Better Service. Best Choice.
        `.trim();
      let acmSentence = '';

if (acmName && acmEmailGlobal) {
  const acmNames = acmName.split(',').map(n => n.trim());
  const acmEmails = acmEmailGlobal.split(',').map(e => e.trim());

  const pairs = acmNames.map((name, i) => `${name} at ${acmEmails[i] || ''}`);

  const formatted = pairs.length === 1
    ? pairs[0]
    : pairs.slice(0, -1).join(', ') + ', and ' + pairs[pairs.length - 1];

  const plural = pairs.length > 1 ? 's' : '';
  acmSentence = `, or our Area Construction Manager${plural}, ${formatted}`;
}
        const subcontractorSubject = `Vanir Project Opportunity: ${branch} - ${builder}`;
        const subcontractorBody = `
Greetings from Vanir Installed Sales,

Vanir ${branch} secured the ${subdivision} with ${builder}. We’re eager to get started and ensure excellence throughout the build.
This will be a ${projectType} project, requiring ${materialType} installation.

Project Details:

- Expected Pace: ${epace} ${epace > 1 ? 'days' : 'day'}
- Number of Lots: ${numberOfLots}
- Anticipated Start Date: ${anticipatedStartDate}
- Project Location: ${city}

If you're interested in partnering with us on this opportunity, please contact our General Manager, ${gm} at ${gmEmail}${acmSentence}.

Best regards, ${userName}  
Vanir Installed Sales ${branch || 'LLC'}  
Phone: ${userPhone}  
https://www.vanirinstalledsales.com  
Better Look. Better Service. Best Choice.
`.trim();
        

      // Define these before you use them
const vendorSubject = `Project Awarded | ${subdivision} | ${builder}`;
const vendorBody = `
Hello,

We're excited to share that Vanir ${branch} will be partnering with ${builder}.

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

        // Combine emails for the "To" and "CC" sections
const selectedBranch = document.querySelector('.branchContainer')?.textContent.trim().toLowerCase().replace(/\s+/g, '');
const rawPurchasingEmail = `purchasing.${selectedBranch}@vanirinstalledsales.com`;
const purchasingEmail = normalizePurchasingEmail(rawPurchasingEmail);
const estimatesEmail = `estimates.${selectedBranch}@vanirinstalledsales.com`;

  const teamEmails = [
      "maggie@vanirinstalledsales.com",
      "jason.smith@vanirinstalledsales.com",
      "hunter@vanirinstalledsales.com",
      "rick.jinkins@vanirinstalledsales.com",
      "josh@vanirinstalledsales.com",
      "dallas.hudson@vanirinstalledsales.com",
      "mike.raszmann@vanirinstalledsales.com",
      "ethen.wilson@vanirinstalledsales.com",
      acmEmailGlobal, 
      purchasingEmail,
      estimatesEmail
    ].filter(Boolean).join(", ");

// Combine vendor + purchasing
const vendorToEmail = [vendorEmail, purchasingEmail]
  .filter(email => typeof email === "string" && email.includes('@'))
  .join(',');

const vendorToEncoded = `to=${encodeURIComponent(vendorToEmail)}`;

const vendorGmailLink = vendorToEmail
  ? `https://mail.google.com/mail/?view=cm&fs=1&${vendorToEncoded}&su=${encodeURIComponent(vendorSubject)}&body=${encodeURIComponent(vendorBody)}`
  : gmEmail
    ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(gmEmail)}&su=${encodeURIComponent(vendorSubject)}&body=${encodeURIComponent(vendorBody)}`
  : null;

        // Generate Gmail links for both Management and Subcontractor emails
const managementGmailLink = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(teamEmails)}&su=${encodeURIComponent(managementSubject)}&body=${encodeURIComponent(managementBody)}`;
       // 💥 Properly split into chunks
const sendBlankSubEmail = document.getElementById("optionSendBlankSubEmail")?.checked;
const sendSubEmail = document.getElementById("optionSubcontractor")?.checked;

const filteredEmails = subcontractorSuggestions
    .map(sub => sub.email)
    .filter(email => typeof email === "string" && email.includes('@'));

let subcontractorEmailChunks = [];

if (sendBlankSubEmail) {
  subcontractorEmailChunks = [[]];
} else if (filteredEmails.length > 0) {
  subcontractorEmailChunks = splitIntoChunks(filteredEmails, 30);
}

let emailBody = ''; // Declare outside

if (sendBlankSubEmail) {
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
  window.open(mailtoLink, '_blank');

} else if (sendSubEmail && filteredEmails.length > 0) {
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
    const mailtoLink = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(gmEmail)}${bccPart}&su=${encodeURIComponent(`Vanir Project Opportunity: ${branch} - ${builder}`)}&body=${encodeURIComponent(emailBody)}`;
    subcontractorGmailLinks.push(mailtoLink);
  }
}       
        return {
            managementGmailLink,
            subcontractorGmailLinks, 
            vendorGmailLink
        };
    } catch (error) {
        console.error("Error generating mailto links:", error.message);
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