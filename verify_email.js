const fs = require('fs');
const path = require('path');

// --- Email Template Helper (copied from server.js for testing) ---
function loadTemplate(templateName, data) {
    try {
        const templatePath = path.join(__dirname, 'shared', 'email-templates', `${templateName}.html`);
        let content = fs.readFileSync(templatePath, 'utf8');

        // Replace placeholders {{key}}
        Object.keys(data).forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            content = content.replace(regex, data[key]);
        });

        return content;
    } catch (error) {
        console.error(`[loadTemplate] Error loading template ${templateName}:`, error.message);
        throw error;
    }
}

const data = {
    name: 'Test Business Inc.',
    contact: {
        name: 'John Broker',
        companyName: 'Test Business Inc.'
    },
    monetaryValue: '1250.00',
    locationId: 'NFWWwK7qd0rXqtNyOINy',
    customFields: [
        { key: 'opportunity.effective_date', field_value: '01-01-2026' }
    ],
    products: [
        { product: 'FSA', rate: '3.50', isOverride: true, justification: 'Key client discount' },
        { product: 'HSA', rate: '1.50', isOverride: true, justification: 'Bundled with health' }
    ]
};

const opportunityId = 'mock_opp_123';
const productsWithOverride = data.products.filter(p => p.isOverride);

const productRows = productsWithOverride.map(p => `
    <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: left;">${p.product}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #d32f2f; font-weight: bold; text-align: left;">$${p.rate}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; font-style: italic; color: #666; text-align: left;">${p.justification || 'N/A'}</td>
    </tr>
`).join('');

const baseUrl = 'https://nueforms-sales-intake-999.web.app';

const emailBody = loadTemplate('approval-email', {
    employerName: data.contact?.companyName || data.name,
    brokerName: data.contact?.name || 'N/A',
    salesPerson: 'Test Sales Person',
    totalEmployees: '100', // Mocked
    effectiveDate: data.customFields.find(f => f.key === 'opportunity.effective_date')?.field_value || 'N/A',
    yearlyValue: data.monetaryValue,
    productRows,
    baseUrl,
    opportunityId,
    locationId: data.locationId,
    currentYear: new Date().getFullYear()
});

const previewPath = path.join(__dirname, 'shared', 'email-templates', 'previews', 'approval-email-preview.html');
require('fs').writeFileSync(previewPath, emailBody);
console.log(`Email preview generated: ${previewPath}`);
