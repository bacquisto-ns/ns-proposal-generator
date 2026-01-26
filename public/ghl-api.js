const CONFIG = {
    proxyUrl: '/api/create-opportunity',
    usersUrl: '/api/users',
    contactsUrl: '/api/contacts',
    configUrl: '/api/config',
    locationId: 'NFWWwK7qd0rXqtNyOINy',
    pipelineId: 'X3z6soG2N6TEvus4f9of',
    stageId: '85aa3281-f8ad-4fa4-9ad5-19c33d530080', // RFP From Broker
    STAGE_PROPOSAL_SENT: 'c027c8a1-dafb-4e96-bbf9-c82cfe33890a',
    STAGE_PENDING_APPROVAL: 'e2a38725-aebf-4348-a7a4-38974eefcc70'
};

let PRODUCTS = [];
let TIERS = [];

const productBody = document.getElementById('productBody');
const addProductBtn = document.getElementById('addProductBtn');
const grandTotalEl = document.getElementById('grandTotal');
const yearlyTotalEl = document.getElementById('yearlyTotal');
const summaryEls = {
    monthly: document.getElementById('summaryMonthly'),
    yearly: document.getElementById('summaryYearly'),
    productsCount: document.getElementById('summaryProductsCount'),
    productsList: document.getElementById('summaryProductsList'),
    employees: document.getElementById('summaryEmployees'),
    owner: document.getElementById('summaryOwner'),
    employer: document.getElementById('summaryEmployer'),
    effectiveDate: document.getElementById('summaryEffectiveDate'),
    proposalDate: document.getElementById('summaryProposalDate'),
    approval: document.getElementById('summaryApproval')
};
const summaryState = {
    hasOverride: false,
    monthlyTotal: 0,
    yearlyTotal: 0
};
const totalState = {
    monthly: null,
    yearly: null
};

// HTML escape helper to prevent XSS
const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

function triggerValueBump(el) {
    if (!el) return;
    el.classList.remove('value-bump');
    void el.offsetWidth;
    el.classList.add('value-bump');
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return '--';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[1]}-${parts[2]}-${parts[0]}`;
}

function updateSummary() {
    if (!summaryEls.monthly) return;

    const monthlyText = `$${summaryState.monthlyTotal.toFixed(2)}`;
    const yearlyText = `$${summaryState.yearlyTotal.toFixed(2)}`;

    if (summaryEls.monthly.textContent !== monthlyText) {
        summaryEls.monthly.textContent = monthlyText;
        triggerValueBump(summaryEls.monthly);
    }

    if (summaryEls.yearly.textContent !== yearlyText) {
        summaryEls.yearly.textContent = yearlyText;
        triggerValueBump(summaryEls.yearly);
    }

    if (summaryEls.approval) {
        summaryEls.approval.textContent = summaryState.hasOverride ? 'Approval required' : 'Not required';
        summaryEls.approval.classList.toggle('summary-chip--warning', summaryState.hasOverride);
        summaryEls.approval.classList.toggle('summary-chip--ok', !summaryState.hasOverride);
    }

    const employerInput = document.getElementById('employerName');
    if (summaryEls.employer) {
        summaryEls.employer.textContent = employerInput && employerInput.value ? employerInput.value : '--';
    }

    const employeesInput = document.getElementById('totalEmployees');
    if (summaryEls.employees) {
        summaryEls.employees.textContent = employeesInput && employeesInput.value ? employeesInput.value : '0';
    }

    const ownerSelect = document.getElementById('assignedTo');
    if (summaryEls.owner) {
        let ownerText = 'Not selected';
        if (ownerSelect && ownerSelect.selectedIndex > 0) {
            ownerText = ownerSelect.options[ownerSelect.selectedIndex].text;
        }
        summaryEls.owner.textContent = ownerText;
    }

    const effectiveDateInput = document.getElementById('effectiveDate');
    if (summaryEls.effectiveDate) {
        summaryEls.effectiveDate.textContent = formatDateDisplay(effectiveDateInput ? effectiveDateInput.value : '');
    }

    const proposalDateInput = document.getElementById('proposalDate');
    if (summaryEls.proposalDate) {
        summaryEls.proposalDate.textContent = formatDateDisplay(proposalDateInput ? proposalDateInput.value : '');
    }

    if (summaryEls.productsList) {
        summaryEls.productsList.innerHTML = '';
        let count = 0;
        const mainRows = productBody ? productBody.querySelectorAll('.product-main-row') : [];
        mainRows.forEach(row => {
            const productSelect = row.querySelector('.product-select');
            if (!productSelect || !productSelect.value) return;
            count += 1;

            const item = document.createElement('div');
            item.className = 'summary-product-item';

            const name = document.createElement('span');
            name.className = 'summary-product-name';
            name.textContent = productSelect.value;

            const price = document.createElement('span');
            price.className = 'summary-product-price';
            const rowTotal = row.dataset.rowTotal ? Number(row.dataset.rowTotal) : 0;
            price.textContent = `$${rowTotal.toFixed(2)}`;

            item.appendChild(name);
            item.appendChild(price);
            summaryEls.productsList.appendChild(item);
        });

        if (summaryEls.productsCount) {
            summaryEls.productsCount.textContent = String(count);
        }

        if (count === 0) {
            const empty = document.createElement('div');
            empty.className = 'summary-empty';
            empty.textContent = 'No products selected yet.';
            summaryEls.productsList.appendChild(empty);
        }
    }
}

// --- Broker Lookup Management ---
function initBrokerLookup() {
    const brokerInput = document.getElementById('brokerName');
    const resultsContainer = document.getElementById('brokerLookupResults');
    const brokerEmailInput = document.getElementById('brokerEmail');
    const brokerAgencyInput = document.getElementById('brokerAgency');

    if (!brokerInput || !resultsContainer) return;

    let debounceTimer;

    brokerInput.addEventListener('input', (e) => {
        const query = e.target.value;
        clearTimeout(debounceTimer);

        if (query.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(async () => {
            try {
                const response = await fetch(`${CONFIG.contactsUrl}?query=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error('Failed to fetch contacts');
                const contacts = await response.json();
                displayLookupResults(contacts, resultsContainer, brokerInput, brokerEmailInput, brokerAgencyInput);
            } catch (error) {
                console.error('Error in broker lookup:', error);
            }
        }, 300);
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
        if (!brokerInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });
}

function displayLookupResults(contacts, container, input, emailInput, agencyInput) {
    container.innerHTML = '';

    contacts.forEach(contact => {
        const item = document.createElement('div');
        item.className = 'lookup-item';

        const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'No Name';
        const email = contact.email || 'No Email';
        const agency = contact.companyName || '';

        // Use structured element creation for better security
        const nameEl = document.createElement('strong');
        nameEl.textContent = fullName;

        const emailEl = document.createElement('span');
        emailEl.className = 'lookup-email';
        emailEl.textContent = email;

        item.appendChild(nameEl);
        item.appendChild(emailEl);

        if (agency) {
            const agencyEl = document.createElement('span');
            agencyEl.className = 'lookup-agency';
            agencyEl.textContent = agency;
            item.appendChild(agencyEl);
        }

        item.addEventListener('click', () => {
            input.value = fullName;
            if (emailInput) emailInput.value = email;
            if (agencyInput && agency) agencyInput.value = agency;
            container.style.display = 'none';
        });

        container.appendChild(item);
    });

    const currentQuery = input.value;
    if (currentQuery.length >= 2) {
        const createNewItem = document.createElement('div');
        createNewItem.className = 'lookup-item create-new';

        const contentEl = document.createElement('div');
        contentEl.className = 'create-new-content';

        const plusIcon = document.createElement('span');
        plusIcon.className = 'plus-icon';
        plusIcon.textContent = '+';

        const textEl = document.createElement('strong');
        textEl.textContent = `${currentQuery} (Create New Contact)`;

        contentEl.appendChild(plusIcon);
        contentEl.appendChild(textEl);
        createNewItem.appendChild(contentEl);

        createNewItem.addEventListener('click', () => {
            input.value = currentQuery;
            if (emailInput) {
                emailInput.value = '';
                emailInput.focus();
            }
            if (agencyInput) agencyInput.value = '';
            container.style.display = 'none';
        });

        container.appendChild(createNewItem);
    }

    container.style.display = 'block';
}

initBrokerLookup();

// --- Product Configuration Loading ---
async function loadConfig() {
    try {
        const response = await fetch(CONFIG.configUrl);
        if (!response.ok) throw new Error('Failed to load configuration');
        const config = await response.json();
        PRODUCTS = config.products;
        TIERS = config.tiers;
        console.log('Loaded products and tiers from server.');

        // Initialize the interface after config is loaded
        if (productBody) {
            productBody.innerHTML = '';
            productBody.appendChild(createProductRow());
            updateGrandTotal();
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
}

function isBundled() {
    const rows = productBody.querySelectorAll('tr');
    for (const row of rows) {
        const productSelect = row.querySelector('.product-select');
        if (!productSelect) continue;
        const prod = PRODUCTS.find(p => p.name === productSelect.value);
        if (prod && prod.core) return true;
    }
    return false;
}

function calculateRowTotal(row, bundled) {
    const productSelect = row.querySelector('.product-select');
    const tierSelect = row.querySelector('.tier-select');
    const employeesInput = row.querySelector('.employees-input');
    const rateInput = row.querySelector('.rate-input');
    const overrideCheckbox = row.querySelector('.override-checkbox');
    const waiveMinCheckbox = row.querySelector('.waive-min-checkbox');
    const totalCell = row.querySelector('.row-total');
    const justificationRow = row.nextElementSibling;
    if (justificationRow && justificationRow.classList.contains('override-justification-row')) {
        justificationRow.style.display = overrideCheckbox.checked ? 'table-row' : 'none';
    }

    const product = PRODUCTS.find(p => p.name === productSelect.value);
    const tier = TIERS.find(t => t.label === tierSelect.value);
    const employees = parseInt(employeesInput.value) || 0;

    if (product) {
        let rate;
        if (overrideCheckbox.checked) {
            rateInput.readOnly = false;
            rateInput.style.backgroundColor = 'white';
            rateInput.style.borderColor = 'var(--border)';
            rate = parseFloat(rateInput.value) || 0;
        } else {
            rateInput.readOnly = true;
            rateInput.style.backgroundColor = '#f8fafc';
            rateInput.style.borderColor = 'transparent';

            // Tiered Logic
            const tierData = product.tiers.find(t => employees >= t.min && employees <= t.max) || product.tiers[0];
            const baseRate = (bundled && tierData.bundled) ? tierData.bundled : tierData.rate;

            const multiplier = tier ? tier.multiplier : 1;
            rate = baseRate * multiplier;
            rateInput.value = rate.toFixed(2);
        }

        let total = rate * (product.isFlatFee ? 1 : employees);

        // Min Fee Logic
        const min = (bundled && product.bundledMinFee) ? product.bundledMinFee : product.minFee;
        const waiveMin = waiveMinCheckbox ? waiveMinCheckbox.checked : false;

        if (total > 0 && total < min && !product.isFlatFee && !waiveMin) {
            total = min;
        }

        const nextTotalText = '$' + total.toFixed(2);
        row.dataset.rowTotal = total.toFixed(2);
        if (totalCell && totalCell.textContent !== nextTotalText) {
            totalCell.textContent = nextTotalText;
            triggerValueBump(totalCell);
        } else if (totalCell) {
            totalCell.textContent = nextTotalText;
        }
        return total;
    }
    if (row) {
        row.dataset.rowTotal = '0.00';
    }
    if (totalCell) {
        totalCell.textContent = '$0.00';
    }
    return 0;
}

function updateGrandTotal() {
    let total = 0;
    let hasOverride = false;
    const bundled = isBundled();

    // Process all main rows
    const mainRows = productBody.querySelectorAll('.product-main-row');
    mainRows.forEach(row => {
        total += calculateRowTotal(row, bundled);
        const checkbox = row.querySelector('.override-checkbox');
        if (checkbox && checkbox.checked) {
            hasOverride = true;
        }
    });

    const nextMonthly = Number(total.toFixed(2));
    const nextYearly = Number((total * 12).toFixed(2));

    if (grandTotalEl) {
        const monthlyText = `$${nextMonthly.toFixed(2)}`;
        if (totalState.monthly !== nextMonthly) {
            grandTotalEl.textContent = monthlyText;
            triggerValueBump(grandTotalEl);
            totalState.monthly = nextMonthly;
        } else {
            grandTotalEl.textContent = monthlyText;
        }
    }

    if (yearlyTotalEl) {
        const yearlyText = `$${nextYearly.toFixed(2)}`;
        if (totalState.yearly !== nextYearly) {
            yearlyTotalEl.textContent = yearlyText;
            triggerValueBump(yearlyTotalEl);
            totalState.yearly = nextYearly;
        } else {
            yearlyTotalEl.textContent = yearlyText;
        }
    }

    const approvalNotice = document.getElementById('approvalNotice');
    if (approvalNotice) {
        approvalNotice.style.display = hasOverride ? 'flex' : 'none';
    }

    summaryState.monthlyTotal = nextMonthly;
    summaryState.yearlyTotal = nextYearly;
    summaryState.hasOverride = hasOverride;
    updateSummary();
}

function createProductRow() {
    const template = document.getElementById('productRowTemplate');
    if (!template) return null;

    const fragment = template.content.cloneNode(true);
    const mainRow = fragment.querySelector('.product-main-row');
    const justificationRow = fragment.querySelector('.override-justification-row');

    const productSelect = mainRow.querySelector('.product-select');
    const tierSelect = mainRow.querySelector('.tier-select');
    const employeesInput = mainRow.querySelector('.employees-input');
    const productEffDateInput = mainRow.querySelector('.product-effective-date-input');
    const rateInput = mainRow.querySelector('.rate-input');
    const overrideCheckbox = mainRow.querySelector('.override-checkbox');
    const waiveMinCheckbox = mainRow.querySelector('.waive-min-checkbox');
    const removeBtn = mainRow.querySelector('.remove-btn');
    const justificationInput = justificationRow.querySelector('.justification-input');

    // Default row effective date to global if set
    const globalEffDate = document.getElementById('effectiveDate')?.value;
    if (globalEffDate && productEffDateInput) {
        productEffDateInput.value = globalEffDate;
    }

    if (mainRow) {
        mainRow.classList.add('row-enter');
        setTimeout(() => mainRow.classList.remove('row-enter'), 250);
    }
    if (justificationRow) {
        justificationRow.classList.add('row-enter');
        setTimeout(() => justificationRow.classList.remove('row-enter'), 250);
    }

    // Populate selects
    if (productSelect) {
        PRODUCTS.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            productSelect.appendChild(opt);
        });
        productSelect.addEventListener('change', () => updateGrandTotal());
    }

    if (tierSelect) {
        TIERS.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.label;
            opt.textContent = t.label;
            tierSelect.appendChild(opt);
        });
        tierSelect.addEventListener('change', () => updateGrandTotal());
    }

    if (employeesInput) employeesInput.addEventListener('input', () => updateGrandTotal());
    if (productEffDateInput) productEffDateInput.addEventListener('change', () => updateGrandTotal());
    if (rateInput) rateInput.addEventListener('input', () => updateGrandTotal());
    if (overrideCheckbox) overrideCheckbox.addEventListener('change', () => updateGrandTotal());
    if (waiveMinCheckbox) waiveMinCheckbox.addEventListener('change', () => updateGrandTotal());
    if (justificationInput) justificationInput.addEventListener('input', () => { });

    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            mainRow.classList.add('row-exit');
            if (justificationRow) {
                justificationRow.classList.add('row-exit');
            }
            setTimeout(() => {
                mainRow.remove();
                if (justificationRow) justificationRow.remove();
                updateGrandTotal();
            }, 200);
        });
    }

    return fragment;
}

if (addProductBtn) {
    addProductBtn.addEventListener('click', () => {
        if (productBody) productBody.appendChild(createProductRow());
    });
}

// Initial row will be added by loadConfig()

// Fetch and populate Owners
async function loadOwners() {
    const ownerSelect = document.getElementById('assignedTo');
    if (!ownerSelect) {
        console.error('Owner select element (#assignedTo) not found in DOM');
        return;
    }

    try {
        console.log('Loading owners from:', CONFIG.usersUrl);
        const response = await fetch(CONFIG.usersUrl);

        console.log('Fetch response status:', response.status);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Fetch error response:', errorText);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const users = await response.json();
        console.log('Users received from backend:', users);

        if (!Array.isArray(users)) {
            console.error('Expected array of users, got:', typeof users, users);
            throw new Error(users.error || 'Invalid users data received');
        }

        if (users.length === 0) {
            console.warn('No users returned from GoHighLevel location.');
            ownerSelect.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = '';
            opt.disabled = true;
            opt.selected = true;
            opt.textContent = 'No owners found';
            ownerSelect.appendChild(opt);
            updateSummary();
            return;
        }

        ownerSelect.innerHTML = '';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.disabled = true;
        defaultOpt.selected = true;
        defaultOpt.textContent = 'Select Owner...';
        ownerSelect.appendChild(defaultOpt);
        users.forEach(user => {
            const opt = document.createElement('option');
            opt.value = user.id;
            opt.textContent = `${user.firstName} ${user.lastName}`;
            ownerSelect.appendChild(opt);
        });
        console.log(`Populated ${users.length} owners in dropdown.`);
        updateSummary();
    } catch (error) {
        console.error('Detailed error loading owners:', error);
        ownerSelect.innerHTML = '';
        const errOpt = document.createElement('option');
        errOpt.value = '';
        errOpt.disabled = true;
        errOpt.selected = true;
        errOpt.textContent = 'Error loading owners';
        ownerSelect.appendChild(errOpt);
        updateSummary();
    }
}
// Set default dates on load
function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    const proposalDateInput = document.getElementById('proposalDate');
    const effectiveDateInput = document.getElementById('effectiveDate');

    if (proposalDateInput) proposalDateInput.value = today;
    // Note: effectiveDate is usually a future date, so we leave it to the user but could default to next month
}
// Initialize Portal
const opportunityForm = document.getElementById('opportunityForm');
if (opportunityForm) {
    opportunityForm.addEventListener('input', () => updateSummary());
    opportunityForm.addEventListener('change', (e) => {
        if (e.target.id === 'effectiveDate') {
            const val = e.target.value;
            const rowDates = productBody.querySelectorAll('.product-effective-date-input');
            rowDates.forEach(input => {
                if (!input.value) input.value = val;
            });
        }
        updateSummary();
    });
}

loadConfig().then(() => {
    setDefaultDates();
    loadOwners();
    updateSummary();
});

document.getElementById('opportunityForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';

    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    const formattedEffectiveDate = formatDate(data.effectiveDate);
    const formattedProposalDate = formatDate(data.proposalDate) || formatDate(new Date().toISOString().split('T')[0]);

    // Collect products
    const products = [];
    let hasOverride = false;
    const rows = productBody.querySelectorAll('tr');
    rows.forEach(row => {
        const productSelect = row.querySelector('.product-select');
        if (!productSelect || !productSelect.value) return;

        const product = productSelect.value;
        const tier = row.querySelector('.tier-select').value;
        const employees = row.querySelector('.employees-input').value;
        const rowEffDateRaw = row.querySelector('.product-effective-date-input').value;
        const rate = row.querySelector('.rate-input').value;
        const isOverride = row.querySelector('.override-checkbox').checked;
        const waivedMin = row.querySelector('.waive-min-checkbox').checked;

        // Use formatDate helper for product effective date
        const productEffectiveDate = formatDate(rowEffDateRaw) || formattedEffectiveDate;
        const nextRow = row.nextElementSibling;
        const justification = (isOverride && nextRow) ? nextRow.querySelector('.justification-input').value : '';

        // Added Min Fee calculation for PDF consistency
        const prodData = PRODUCTS.find(p => p.name === product);
        const bundled = isBundled();
        const minFee = prodData ? ((bundled && prodData.bundledMinFee) ? prodData.bundledMinFee : prodData.minFee) : 0;

        products.push({ product, tier, employees, effectiveDate: productEffectiveDate, rate, isOverride, waivedMin, justification, minFee });
        if (isOverride) hasOverride = true;
    });

    // 1. Automated Opportunity Name Generation
    const broker = data.brokerAgency || data.brokerName || data.opportunitySource || 'Direct';
    const business = data.employerName;

    const opportunityName = `${broker} - ${business} - ${formattedEffectiveDate}`;

    console.log('Generated Opportunity Name:', opportunityName);

    // Ensure Opportunity Source fallback
    const source = data.opportunitySource || 'Direct';
    console.log('Sending Opportunity Source:', source);

    // 2. Prepare Payload for GHL v2
    const payload = {
        name: opportunityName,
        employerName: business, // Pass business name explicitly for PDF generation
        effectiveDate: formattedEffectiveDate, // Added for backend PDF generation
        proposalDate: formattedProposalDate,   // Added for backend PDF generation
        pipelineId: CONFIG.pipelineId,
        stageId: hasOverride ? CONFIG.STAGE_PENDING_APPROVAL : CONFIG.STAGE_PROPOSAL_SENT,
        status: 'open',
        locationId: CONFIG.locationId,
        source: source, // Standard GHL Source Field
        assignedTo: data.assignedTo, // Add selected owner
        assignedToName: (() => {
            const el = document.getElementById('assignedTo');
            return el && el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : 'N/A';
        })(),


        monetaryValue: yearlyTotalEl ? parseFloat(yearlyTotalEl.textContent.replace('$', '')) : 0, // Map to Opportunity Value (Yearly)
        contact: {
            name: data.brokerName,
            email: data.brokerEmail,
            companyName: data.brokerAgency // Correctly mapping broker agency
        },
        products: products, // Sent for backend PDF generation and justifications
        brokerAgency: data.brokerAgency, // Passed for Firestore storage
        proposalMessage: data.proposalMessage || '',
        customFields: [
            { id: 'TCajUYyGFfxNawfFVHzH', field_value: formattedEffectiveDate }, // rfp_effective_date: use formatted mm-dd-yyyy
            { id: 'qDAjtgB8BnOe44mmBxZJ', field_value: formattedProposalDate }, // proposal_date: use formatted mm-dd-yyyy
            { id: '1Ns6AFE7tqfjLrSMmlGm', field_value: data.totalEmployees }, // total_employees
            { id: '4Ft4xkId76QFmogGxQLT', field_value: source }, // opportunity_source
            { id: 'gG9uknunlZBamXsF5Ynu', field_value: data.currentAdministrator }, // current_administrator
            { id: 'FbHjdv6IH9saWvWxD9qk', field_value: data.benAdminSystem }, // ben_admin_system
            { id: 'tkeBnMhHQgLtmTeDazj5', field_value: products.map(p => p.product).join(', ') }, // rfp_products_desired
            { id: '7R4mvELrwlpcNtwFbeN1', field_value: grandTotalEl.textContent.replace('$', '') }, // monthly_total
            { id: 'h4RmeiogDVZGhb0DEaia', field_value: yearlyTotalEl ? yearlyTotalEl.textContent.replace('$', '') : '0.00' }, // yearly_total
            { id: 'RjgwrcO6mdOKu80HsZA2', field_value: data.postalCode || '' }, // postal_code
            { id: 'wJbGGl9zanGxn392jFw5', field_value: hasOverride ? 'Yes' : 'No' }, // requires_approval
            { id: 'k29uFeF1SbZ5tIPSn7ro', field_value: hasOverride ? 'Josh Collins' : '' } // approver_name
        ]
    };

    try {
        console.log('Sending payload to local proxy:', payload);

        const response = await fetch(CONFIG.proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.details || errorData.error || 'Failed to create opportunity');
        }

        const result = await response.json();
        console.log('Success from GHL:', result);

        // Check if success view exists
        const successMessage = document.getElementById('successMessage');
        const formSection = document.getElementById('formSection') || document.getElementById('opportunityForm');
        const successDetail = document.getElementById('successDetail');

        if (successMessage && formSection) {
            if (successDetail) {
                successDetail.textContent = `Opportunity "${opportunityName}" created successfully!`;
                const br = document.createElement('br');
                const dlBtn = document.createElement('button');
                dlBtn.id = 'downloadProposal';
                dlBtn.className = 'btn btn-primary';
                dlBtn.style.marginTop = '15px';
                dlBtn.textContent = 'Download Pricing Proposal PDF';
                successDetail.appendChild(br);
                successDetail.appendChild(dlBtn);
            }
            formSection.style.display = 'none';
            successMessage.style.display = 'block';
            document.body.classList.add('success-mode');
            launchConfetti();

            document.getElementById('downloadProposal').addEventListener('click', () => {
                generateProposalPDF({
                    ...data,
                    contactId: result.opportunity?.contactId || result.contactId || data.contactId, // Support different response formats
                    assignedTo: result.opportunity?.assignedTo || result.assignedTo || data.assignedTo,
                    businessName: data.employerName,
                    effectiveDate: formattedEffectiveDate,
                    proposalDate: formattedProposalDate,
                    opportunityName,
                    products,
                    proposalMessage: data.proposalMessage || ''
                });
            });
        } else {
            alert('Opportunity Created Successfully!\nName: ' + opportunityName);
            e.target.reset();
            productBody.innerHTML = '';
            productBody.appendChild(createProductRow());
            updateGrandTotal();
            document.body.classList.remove('success-mode');
        }
    } catch (error) {
        console.error('Error creating opportunity:', error);
        alert('Failed: ' + error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Opportunity';
    }
});

// Reset Portal function (if needed)
window.resetPortal = function () {
    const form = document.getElementById('opportunityForm');
    const formSection = document.getElementById('formSection') || form;
    const successMessage = document.getElementById('successMessage');

    if (form) form.reset();
    if (productBody) {
        productBody.innerHTML = '';
        productBody.appendChild(createProductRow());
        updateGrandTotal();
    }
    const messageInput = document.getElementById('proposalMessage');
    if (messageInput) messageInput.value = '';
    if (successMessage) successMessage.style.display = 'none';
    if (formSection) formSection.style.display = 'block';
    document.body.classList.remove('success-mode');
    updateSummary();
};

function launchConfetti() {
    if (typeof window.confetti !== 'function') return;
    const endTime = Date.now() + 700;
    const colors = ['#00A3E0', '#78BE20', '#002D72'];

    (function frame() {
        window.confetti({
            particleCount: 4,
            angle: 60,
            spread: 55,
            origin: { x: 0.05, y: 0.6 },
            colors: colors
        });
        window.confetti({
            particleCount: 4,
            angle: 120,
            spread: 55,
            origin: { x: 0.95, y: 0.6 },
            colors: colors
        });
        if (Date.now() < endTime) {
            requestAnimationFrame(frame);
        }
    })();
}

async function generateProposalPDF(formData) {
    try {
        const response = await fetch('/api/generate-pdf', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Proposal_${formData.employerName || formData.businessName || 'NueSynergy'}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } else {
            console.error('Failed to generate PDF');
            alert('Failed to generate PDF proposal.');
        }
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Error generating PDF proposal.');
    }
}
