const CONFIG = {
    proxyUrl: '/api/create-opportunity',
    usersUrl: '/api/users',
    contactsUrl: '/api/contacts',
    locationId: 'NFWWwK7qd0rXqtNyOINy',
    pipelineId: 'X3z6soG2N6TEvus4f9of',
    stageId: '85aa3281-f8ad-4fa4-9ad5-19c33d530080' // RFP From Broker
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

    // Add search results
    contacts.forEach(contact => {
        const item = document.createElement('div');
        item.className = 'lookup-item';

        const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'No Name';
        const email = contact.email || 'No Email';
        const agency = contact.companyName || '';

        item.innerHTML = `
            <strong>${escapeHtml(fullName)}</strong>
            <span class="lookup-email">${escapeHtml(email)}</span>
            ${agency ? `<span class="lookup-agency">${escapeHtml(agency)}</span>` : ''}
        `;

        item.addEventListener('click', () => {
            input.value = fullName;
            if (emailInput) emailInput.value = email;
            if (agencyInput && agency) agencyInput.value = agency;
            container.style.display = 'none';
        });

        container.appendChild(item);
    });

    // --- Added "Create New Contact" Option ---
    const currentQuery = input.value;
    if (currentQuery.length >= 2) {
        const createNewItem = document.createElement('div');
        createNewItem.className = 'lookup-item create-new';
        createNewItem.innerHTML = `
            <div class="create-new-content">
                <span class="plus-icon">+</span>
                <strong>${escapeHtml(currentQuery)} (Create New Contact)</strong>
            </div>
        `;

        createNewItem.addEventListener('click', () => {
            // Fill the name field with exactly what they typed
            input.value = currentQuery;
            // Clear but focus the email field to prompt for new info
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

// --- Product Row Management ---
const productBody = document.getElementById('productBody');
const addProductBtn = document.getElementById('addProductBtn');
const grandTotalEl = document.getElementById('grandTotal');
const yearlyTotalEl = document.getElementById('yearlyTotal');

const PRODUCTS = [
    {
        name: 'FSA',
        core: true,
        tiers: [{ min: 1, max: 250, rate: 4.25 }, { min: 251, max: 999, rate: 4.00 }, { min: 1000, max: Infinity, rate: 3.50 }],
        minFee: 50.00
    },
    {
        name: 'HSA',
        core: true,
        tiers: [{ min: 1, max: 250, rate: 2.25 }, { min: 251, max: 999, rate: 2.15 }, { min: 1000, max: Infinity, rate: 1.85 }],
        minFee: 50.00
    },
    {
        name: 'HRA',
        core: true,
        tiers: [{ min: 1, max: 250, rate: 4.25 }, { min: 251, max: 999, rate: 4.00 }, { min: 1000, max: Infinity, rate: 3.50 }],
        minFee: 50.00
    },
    {
        name: 'LSA',
        core: true,
        tiers: [{ min: 1, max: 250, rate: 5.00 }, { min: 251, max: 999, rate: 4.75 }, { min: 1000, max: Infinity, rate: 4.25 }],
        minFee: 50.00
    },
    {
        name: 'COBRA',
        core: true,
        tiers: [{ min: 1, max: 250, rate: 1.00 }, { min: 251, max: 500, rate: 0.85 }, { min: 501, max: 999, rate: 0.75 }, { min: 1000, max: Infinity, rate: 0.75 }],
        minFee: 50.00
    },
    {
        name: 'Combined Billing - Reconcile',
        tiers: [{ min: 1, max: 250, rate: 2.00, bundled: 1.75 }, { min: 251, max: 999, rate: 1.75, bundled: 1.50 }, { min: 1000, max: Infinity, rate: 1.35, bundled: 1.00 }],
        minFee: 200.00,
        bundledMinFee: 150.00
    },
    {
        name: 'Combined Billing - Reconcile & Pay',
        tiers: [{ min: 1, max: 250, rate: 2.50, bundled: 2.25 }, { min: 251, max: 999, rate: 2.25, bundled: 2.00 }, { min: 1000, max: Infinity, rate: 1.85, bundled: 1.50 }],
        minFee: 250.00, // Updated from 200.00 based on JSON
        bundledMinFee: 200.00  // Updated from 150.00 based on JSON
    },
    {
        name: 'Direct Billing',
        tiers: [{ min: 1, max: 250, rate: 5.00, bundled: 4.75 }, { min: 251, max: 999, rate: 4.50, bundled: 4.25 }, { min: 1000, max: Infinity, rate: 3.75, bundled: 3.50 }],
        minFee: 75.00,
        bundledMinFee: 50.00
    },
    {
        name: 'Spousesaver',
        tiers: [{ min: 1, max: Infinity, rate: 18.00, bundled: 16.00 }],
        minFee: 150.00,
        bundledMinFee: 125.00
    },
    {
        name: 'POP',
        tiers: [{ min: 1, max: Infinity, rate: 350.00 }],
        minFee: 350.00,
        isFlatFee: true
    }
];

const TIERS = [
    { label: 'PEPM (Book)', multiplier: 1 },
    { label: 'Preferred Broker', multiplier: 0.85 }, // Hypothetical preferred discount
    { label: 'Standard Markup', multiplier: 1.2 },
    { label: 'Premium Markup', multiplier: 1.5 }
];

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

        totalCell.textContent = '$' + total.toFixed(2);
        return total;
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

    grandTotalEl.textContent = '$' + total.toFixed(2);

    if (yearlyTotalEl) {
        const yearlyTotal = total * 12;
        yearlyTotalEl.textContent = '$' + yearlyTotal.toFixed(2);
    }

    const approvalNotice = document.getElementById('approvalNotice');
    if (approvalNotice) {
        approvalNotice.style.display = hasOverride ? 'flex' : 'none';
    }
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
    const rateInput = mainRow.querySelector('.rate-input');
    const overrideCheckbox = mainRow.querySelector('.override-checkbox');
    const waiveMinCheckbox = mainRow.querySelector('.waive-min-checkbox');
    const removeBtn = mainRow.querySelector('.remove-btn');
    const justificationInput = justificationRow.querySelector('.justification-input');

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
    if (rateInput) rateInput.addEventListener('input', () => updateGrandTotal());
    if (overrideCheckbox) overrideCheckbox.addEventListener('change', () => updateGrandTotal());
    if (waiveMinCheckbox) waiveMinCheckbox.addEventListener('change', () => updateGrandTotal());
    if (justificationInput) justificationInput.addEventListener('input', () => { });

    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            mainRow.remove();
            if (justificationRow) justificationRow.remove();
            updateGrandTotal();
        });
    }

    return fragment;
}

if (addProductBtn) {
    addProductBtn.addEventListener('click', () => {
        if (productBody) productBody.appendChild(createProductRow());
    });
}

// Initial row
if (productBody) {
    productBody.appendChild(createProductRow());
}

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
            ownerSelect.innerHTML = '<option value="" disabled selected>No owners found</option>';
            return;
        }

        ownerSelect.innerHTML = '<option value="" disabled selected>Select Owner...</option>';
        users.forEach(user => {
            const opt = document.createElement('option');
            opt.value = user.id;
            opt.textContent = `${user.firstName} ${user.lastName}`;
            ownerSelect.appendChild(opt);
        });
        console.log(`Populated ${users.length} owners in dropdown.`);
    } catch (error) {
        console.error('Detailed error loading owners:', error);
        ownerSelect.innerHTML = '<option value="" disabled selected>Error loading owners</option>';
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
setDefaultDates();

loadOwners();

document.getElementById('opportunityForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';

    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

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
        const rate = row.querySelector('.rate-input').value;
        const isOverride = row.querySelector('.override-checkbox').checked;
        const waivedMin = row.querySelector('.waive-min-checkbox').checked;
        const nextRow = row.nextElementSibling;
        const justification = (isOverride && nextRow) ? nextRow.querySelector('.justification-input').value : '';

        // Added Min Fee calculation for PDF consistency
        const prodData = PRODUCTS.find(p => p.name === product);
        const bundled = isBundled();
        const minFee = prodData ? ((bundled && prodData.bundledMinFee) ? prodData.bundledMinFee : prodData.minFee) : 0;

        products.push({ product, tier, employees, rate, isOverride, waivedMin, justification, minFee });
        if (isOverride) hasOverride = true;
    });

    // 1. Automated Opportunity Name Generation
    const broker = data.brokerAgency || data.brokerName || data.opportunitySource || 'Direct';
    const business = data.employerName;

    // Helper to format YYYY-MM-DD to MM-DD-YYYY
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        return `${parts[1]}-${parts[2]}-${parts[0]}`;
    };

    const formattedEffectiveDate = formatDate(data.effectiveDate);
    const formattedProposalDate = formatDate(data.proposalDate) || formatDate(new Date().toISOString().split('T')[0]);

    const opportunityName = `${broker} - ${business} - ${formattedEffectiveDate}`;

    console.log('Generated Opportunity Name:', opportunityName);

    // Ensure Opportunity Source fallback
    const source = data.opportunitySource || 'Direct';
    console.log('Sending Opportunity Source:', source);

    // 2. Prepare Payload for GHL v2
    const payload = {
        name: opportunityName,
        employerName: business, // Pass business name explicitly for PDF generation
        pipelineId: CONFIG.pipelineId,
        stageId: CONFIG.stageId,
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
            if (successDetail) successDetail.innerHTML = `Opportunity "${opportunityName}" created successfully!<br><button id="downloadProposal" class="btn btn-primary" style="margin-top: 15px;">Download Pricing Proposal PDF</button>`;
            formSection.style.display = 'none';
            successMessage.style.display = 'block';

            document.getElementById('downloadProposal').addEventListener('click', () => {
                generateProposalPDF({
                    ...data,
                    businessName: data.employerName,
                    effectiveDate: formattedEffectiveDate,
                    proposalDate: formattedProposalDate,
                    opportunityName,
                    products
                });
            });
        } else {
            alert('Opportunity Created Successfully!\nName: ' + opportunityName);
            e.target.reset();
            productBody.innerHTML = '';
            productBody.appendChild(createProductRow());
            updateGrandTotal();
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
    if (successMessage) successMessage.style.display = 'none';
    if (formSection) formSection.style.display = 'block';
};

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
