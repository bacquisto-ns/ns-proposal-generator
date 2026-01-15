const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const admin = require('firebase-admin');
require('dotenv').config();

// --- Shared Logic ---
const { sanitizeString, sanitizeEmail, sanitizeNumber, getGHLHeaders } = require('./shared/utils');
const productsConfig = require('./shared/products.json');

// Initialize Firebase Admin (Auto-detects credentials or emulator)
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'nueforms-sales-intake-999'
    });
    admin.firestore().settings({ ignoreUndefinedProperties: true });
}

// --- Audit Logging Helper ---
async function logAudit(action, resourceType, resourceId, details, req = null, status = 'SUCCESS', actor = null) {
    try {
        const logEntry = {
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action: action, // 'CREATE', 'UPDATE', 'DELETE'
            resourceType: resourceType, // 'Opportunity', 'Contact', 'System'
            resourceId: resourceId,
            status: status, // 'SUCCESS', 'FAILURE', 'WARNING'
            actor: actor || { name: 'System', email: 'system@internal' }, // { name: '...', email: '...' }
            details: details,
            metadata: {
                ip: req ? (req.headers['x-forwarded-for'] || req.connection.remoteAddress) : 'system',
                userAgent: req ? req.headers['user-agent'] : 'system',
                endpoint: req ? req.originalUrl : 'internal'
            }
        };

        await admin.firestore().collection('audit_logs').add(logEntry);
        console.log(`[Audit Log] ${action} ${resourceType} (${resourceId}) - ${status}`);
    } catch (error) {
        console.error('[Audit Log] Failed to record entry:', error.message);
        // We don't throw here to ensure the main flow continues even if logging fails
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // Keep open for local development
app.use(express.json());
app.use(express.static('public'));

const GHL_API_KEY = process.env.GHL_API_KEY;
if (!GHL_API_KEY) {
    console.error('FATAL: GHL_API_KEY environment variable is required');
    process.exit(1);
}

// --- Config Endpoint for Frontend ---
app.get('/api/config', (req, res) => {
    res.json({
        products: productsConfig,
        tiers: [
            { label: 'PEPM (Book)', multiplier: 1 },
            { label: 'Preferred Broker', multiplier: 0.85 },
            { label: 'Standard Markup', multiplier: 1.2 },
            { label: 'Premium Markup', multiplier: 1.5 }
        ]
    });
});

const validateOpportunityInput = (data) => {
    const errors = [];

    // Required fields
    if (!data.locationId || typeof data.locationId !== 'string') {
        errors.push('locationId is required');
    }
    if (!data.pipelineId || typeof data.pipelineId !== 'string') {
        errors.push('pipelineId is required');
    }
    if (!data.stageId || typeof data.stageId !== 'string') {
        errors.push('stageId is required');
    }

    // Contact validation
    if (data.contact) {
        if (!data.contact.email || !sanitizeEmail(data.contact.email)) {
            errors.push('Valid contact email is required');
        }
        if (!data.contact.name && !data.contact.firstName) {
            errors.push('Contact name is required');
        }
    } else if (!data.contactId) {
        errors.push('Either contact or contactId is required');
    }

    // Products validation
    if (data.products && !Array.isArray(data.products)) {
        errors.push('products must be an array');
    }

    // Custom fields validation
    if (data.customFields && !Array.isArray(data.customFields)) {
        errors.push('customFields must be an array');
    }

    return errors;
};

const sanitizeOpportunityData = (data) => {
    const sanitized = { ...data };

    // Sanitize basic fields
    sanitized.name = sanitizeString(data.name, 200);
    sanitized.source = sanitizeString(data.source, 100);
    sanitized.employerName = sanitizeString(data.employerName, 200);
    sanitized.brokerAgency = sanitizeString(data.brokerAgency, 200);
    sanitized.monetaryValue = sanitizeNumber(data.monetaryValue);

    // Sanitize contact
    if (data.contact) {
        sanitized.contact = {
            name: sanitizeString(data.contact.name, 100),
            firstName: sanitizeString(data.contact.firstName, 50),
            lastName: sanitizeString(data.contact.lastName, 50),
            email: sanitizeEmail(data.contact.email),
            companyName: sanitizeString(data.contact.companyName, 200)
        };
    }

    // Sanitize products
    if (Array.isArray(data.products)) {
        sanitized.products = data.products.slice(0, 50).map(p => ({
            product: sanitizeString(p.product, 100),
            rate: sanitizeString(String(p.rate || ''), 50),
            effectiveDate: sanitizeString(p.effectiveDate, 20),
            isOverride: Boolean(p.isOverride),
            justification: sanitizeString(p.justification, 500),
            waiveMin: Boolean(p.waiveMin)
        }));
    }

    // Sanitize custom fields
    if (Array.isArray(data.customFields)) {
        sanitized.customFields = data.customFields.slice(0, 100).map(f => ({
            id: sanitizeString(f.id, 50),
            key: sanitizeString(f.key, 100),
            field_value: sanitizeString(String(f.field_value || ''), 500)
        }));
    }

    return sanitized;
};

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

async function createProposalPDF(data, outputPath) {
    try {
        console.log('--- Starting Refined PDF Generation (pdf-lib) ---');
        const templatePath = path.join(__dirname, 'NueSynergy Pricing Proposal_Template 10.25.pdf');
        if (!fs.existsSync(templatePath)) throw new Error(`Template PDF not found at ${templatePath}`);

        const templateBytes = fs.readFileSync(templatePath);
        const templateDoc = await PDFDocument.load(templateBytes);
        const finalDoc = await PDFDocument.create();

        // 1. Copy first 15 pages
        const pageIndices = Array.from({ length: Math.min(15, templateDoc.getPageCount()) }, (_, i) => i);
        const copiedPages = await finalDoc.copyPages(templateDoc, pageIndices);
        copiedPages.forEach((page) => finalDoc.addPage(page));

        const boldFont = await finalDoc.embedFont(StandardFonts.HelveticaBold);
        const regularFont = await finalDoc.embedFont(StandardFonts.Helvetica);

        // Colors
        const primaryColor = rgb(0 / 255, 51 / 255, 102 / 255); // #003366
        const secondaryColor = rgb(128 / 255, 176 / 255, 64 / 255); // #80B040
        const accentColor = rgb(230 / 255, 230 / 255, 230 / 255); // #E6E6E6
        const borderColor = rgb(200 / 255, 200 / 255, 200 / 255);
        const textColor = rgb(51 / 255, 51 / 255, 51 / 255);

        const drawSectionHeader = (page, y, title) => {
            page.drawRectangle({ x: 50, y: y - 20, width: 512, height: 20, color: primaryColor });
            page.drawText(title, { x: 60, y: y - 14, size: 10, font: boldFont, color: rgb(1, 1, 1) });
            page.drawText('Price', { x: 380, y: y - 14, size: 10, font: regularFont, color: rgb(1, 1, 1) });
            page.drawText('Effective Date', { x: 480, y: y - 14, size: 10, font: regularFont, color: rgb(1, 1, 1) });
            return y - 20;
        };

        const drawRow = (page, y, label, price = '-', effectiveDate = '-', isSub = false) => {
            page.drawRectangle({ x: 50, y: y - 20, width: 512, height: 20, borderColor: borderColor, borderLineWidth: 0.5 });
            page.drawText(label, { x: isSub ? 70 : 60, y: y - 14, size: 9, font: isSub ? regularFont : boldFont, color: textColor });
            page.drawText(price, { x: 380, y: y - 14, size: 9, font: regularFont, color: textColor });
            page.drawText(effectiveDate, { x: 480, y: y - 14, size: 9, font: regularFont, color: textColor });
            return y - 20;
        };

        const findRate = (search) => {
            const prod = (data.products || []).find(p => p.product.toLowerCase().includes(search.toLowerCase()));
            if (!prod) return '-';
            const rateStr = isNaN(parseFloat(prod.rate)) ? prod.rate : `$${parseFloat(prod.rate).toFixed(2)}`;
            return prod.isOverride ? `${rateStr}*` : rateStr;
        };

        const findMinFee = (search) => {
            const prod = (data.products || []).find(p => p.product.toLowerCase().includes(search.toLowerCase()));
            if (!prod) return '-';
            if (prod.waivedMin) return 'Waived';
            return prod.minFee ? `$${parseFloat(prod.minFee).toFixed(2)}` : '-';
        };

        // --- PAGE 16 ---
        let page16 = finalDoc.addPage();
        let { width, height } = page16.getSize();

        // Banner
        page16.drawRectangle({ x: 0, y: height - 40, width, height: 40, color: secondaryColor });
        page16.drawRectangle({ x: 0, y: height - 100, width, height: 60, color: primaryColor });
        page16.drawText('PROPOSAL: PLAN OPTIONS', { x: 50, y: height - 75, size: 16, font: boldFont, color: rgb(1, 1, 1) });
        page16.drawText('About NueSynergy', { x: 50, y: height - 90, size: 12, font: regularFont, color: rgb(1, 1, 1) });

        let y = height - 120;
        let effDate = data.effectiveDate || '-';
        if (effDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const parts = effDate.split('-');
            effDate = `${parts[1]}-${parts[2]}-${parts[0]}`;
        }

        // Pre-calculate which products are selected for date display logic
        const hasProduct = (type) => (data.products || []).some(p => p.product === type);
        const selection = {
            hsa: hasProduct('HSA'),
            fsa: hasProduct('FSA'),
            hra: hasProduct('HRA'),
            lsa: hasProduct('LSA'),
            cobra: hasProduct('COBRA'),
            direct: hasProduct('Direct Billing'),
            pop: hasProduct('POP')
        };

        const getDate = (type) => (selection[type] || type === 'always') ? effDate : '-';

        page16.drawRectangle({ x: 50, y: y - 20, width: 512, height: 20, color: accentColor });
        const groupName = data.businessName || data.employerName || '';
        page16.drawText(`GROUP: ${groupName}`, { x: 60, y: y - 14, size: 10, font: boldFont, color: textColor });
        y -= 25;

        // HSA
        y = drawSectionHeader(page16, y, 'HSA Plans');
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('HSA'), getDate('hsa'));
        y = drawRow(page16, y, 'Spouse Saver Incentive Account', '-', getDate('hsa'), true);
        y = drawRow(page16, y, 'Annual Renewal (AFTER YEAR 1)', '-', getDate('hsa'), true);
        y = drawRow(page16, y, 'Monthly Minimum', findMinFee('HSA'), getDate('hsa'), true);
        y -= 10;

        // FSA
        y = drawSectionHeader(page16, y, 'Section 125, FSA Plans');
        y = drawRow(page16, y, 'FSA Plan Documents, Implementation, Design & Installation', findRate('FSA'), getDate('fsa'));
        y = drawRow(page16, y, 'Annual Compliance & Renewal (AFTER YEAR 1)', '-', getDate('fsa'), true);
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('FSA'), getDate('fsa'), true);
        y = drawRow(page16, y, 'Monthly Minimum', findMinFee('FSA'), getDate('fsa'), true);
        y -= 10;

        // HRA
        y = drawSectionHeader(page16, y, 'Section 105, HRA Plans');
        y = drawRow(page16, y, 'HRA Plan Documents, Implementation, Design & Installation', findRate('HRA'), getDate('hra'));
        y = drawRow(page16, y, 'Annual Compliance & Renewal (WAIVED 1st YEAR)', '-', getDate('hra'), true);
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('HRA'), getDate('hra'), true);
        y = drawRow(page16, y, 'Monthly Minimum', findMinFee('HRA'), getDate('hra'), true);
        y -= 10;

        // Miscellaneous
        y = drawSectionHeader(page16, y, 'Miscellaneous Services');
        const miscDate = (selection.hsa || selection.fsa || selection.hra || selection.lsa) ? effDate : '-';
        y = drawRow(page16, y, 'eClaims Manager Per Participant, Monthly', '-', miscDate);
        y = drawRow(page16, y, 'NueSynergy Smart Mobile App', 'Included', miscDate);
        y = drawRow(page16, y, 'Smart Debit Card Setup & Administration Per Participant, Monthly', '-', miscDate);
        y -= 10;

        // LSA
        y = drawSectionHeader(page16, y, 'LSA Plans');
        y = drawRow(page16, y, 'LSA Implementation, Design & Installation', findRate('LSA'), getDate('lsa'));
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('LSA'), getDate('lsa'), true);
        y -= 10;

        // COBRA
        y = drawSectionHeader(page16, y, 'COBRAcare+ Administration');
        y = drawRow(page16, y, 'Per Benefits Enrolled Employee Per Month', findRate('COBRA'), getDate('cobra'));
        y = drawRow(page16, y, 'Current COBRA Continuation', '-', getDate('cobra'), true);
        y = drawRow(page16, y, 'Qualifying Event Notice', '-', getDate('cobra'), true);

        // Page 16 Footer
        page16.drawText('855.890.7239  •  4601 College Blvd. Suite 280, Leawood, KS 66211  •  www.NueSynergy.com', { x: 50, y: 30, size: 8, font: regularFont, color: textColor });

        // --- PAGE 17 ---
        let page17 = finalDoc.addPage();
        page17.drawRectangle({ x: 0, y: height - 40, width, height: 40, color: secondaryColor });
        page17.drawRectangle({ x: 0, y: height - 100, width, height: 60, color: primaryColor });
        page17.drawText('PROPOSAL: CONTINUED', { x: 50, y: height - 75, size: 16, font: boldFont, color: rgb(1, 1, 1) });

        y = height - 120;

        // Direct Bill
        y = drawSectionHeader(page17, y, 'Direct Billing');
        y = drawRow(page17, y, 'Implementation & Setup (YEAR 1)', findRate('Direct'), getDate('direct'));
        y = drawRow(page17, y, 'Annual Renewal (AFTER YEAR 1)', '-', getDate('direct'), true);
        y = drawRow(page17, y, 'Per Direct Bill Participant Per Month', findRate('Direct'), getDate('direct'), true);
        y = drawRow(page17, y, 'Direct Bill Minimum, Monthly', findMinFee('Direct'), getDate('direct'), true);
        y -= 10;

        // POP
        y = drawSectionHeader(page17, y, 'Section 125, Premium Only Plan (POP)');
        y = drawRow(page17, y, 'POP Document (ONE-TIME SETUP FEE)', findRate('POP'), getDate('pop'));
        y = drawRow(page17, y, 'Annual Compliance & Renewal (WAIVED 1st YEAR)', '-', getDate('pop'), true);
        y -= 10;

        // Files
        y = drawSectionHeader(page17, y, 'File Implementation and Processing');
        const anyProduct = Object.values(selection).some(v => v);
        const fileDate = anyProduct ? effDate : '-';
        y = drawRow(page17, y, 'Enrollment/Eligibility File (New Enrollment and Terminations)', '-', fileDate);
        y = drawRow(page17, y, 'Payroll/Contribution File', '-', fileDate);
        y = drawRow(page17, y, 'COBRA Initial Notices', '-', selection.cobra ? effDate : '-');

        // Page 17 Footer
        page17.drawText('855.890.7239  •  4601 College Blvd. Suite 280, Leawood, KS 66211  •  www.NueSynergy.com', { x: 50, y: 30, size: 8, font: regularFont, color: textColor });

        const pdfBytes = await finalDoc.save();
        fs.writeFileSync(outputPath, pdfBytes);
        return outputPath;
    } catch (err) {
        console.error('Error in createProposalPDF:', err);
        throw err;
    }
}

// --- GHL Integration Helper ---

async function uploadFileToGHL(filePath, locationId, opportunityId, contactId, justifications = '') {
    try {
        const stats = fs.statSync(filePath);
        const fileName = path.basename(filePath);

        const form = new FormData();
        form.append('file', fs.createReadStream(filePath), {
            filename: fileName,
            contentType: 'application/pdf',
            knownLength: stats.size
        });

        const uploadResponse = await axios.post(
            `https://services.leadconnectorhq.com/medias/upload-file`,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    ...getGHLHeaders(GHL_API_KEY)
                }
            }
        );

        const fileUrl = uploadResponse.data.url;
        console.log('File uploaded to GHL:', fileUrl);

        await axios.post(
            `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
            {
                body: `NueSynergy Pricing Proposal generated automatically. [Link to Proposal](${fileUrl})${justifications ? '\n\n**Price Override Justifications:**\n' + justifications : ''}`,
            },
            {
                headers: getGHLHeaders(GHL_API_KEY)
            }
        );

        console.log('Proposal linked to Opportunity via Note');
        return fileUrl;
    } catch (error) {
        console.error('GHL File Upload Error:', error.response?.data || error.message);
        throw error;
    }
}

async function sendApprovalEmail(data, opportunityId) {
    try {
        const joshCollinsContactId = '357NYkROmrFIMPiAdpUc';
        const productsWithOverride = (data.products || []).filter(p => p.isOverride);
        console.log(`DEBUG: sendApprovalEmail found ${productsWithOverride.length} overrides.`);

        if (productsWithOverride.length === 0) {
            console.log('DEBUG: No overrides found in sendApprovalEmail, aborting.');
            return;
        }

        const productRows = productsWithOverride.map(p => `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: left;">${p.product}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: left;">${p.employees || '0'}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; color: #d32f2f; font-weight: bold; text-align: left;">$${p.rate}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; font-style: italic; color: #666; text-align: left;">${p.justification || 'N/A'}</td>
            </tr>
        `).join('');

        const baseUrl = 'http://localhost:3000'; // Specific to local development

        const emailBody = `
            <!DOCTYPE html>
            <html>
            <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0;">
                <div style="max-width: 600px; margin: 20px auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <div style="background-color: #003366; color: white; padding: 25px; text-align: center;">
                        <h2 style="margin: 0; font-weight: 300; letter-spacing: 1px;">APPROVAL REQUIRED (LOCAL)</h2>
                    </div>
                    <div style="padding: 30px;">
                        <p style="font-size: 16px;">An opportunity has been created that requires your approval due to price overrides.</p>
                        
                        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 25px;">
                            <h4 style="margin-top: 0; color: #003366; border-bottom: 2px solid #80B040; display: inline-block; padding-bottom: 5px;">Proposal Details</h4>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                                <tr><td style="padding: 5px 0; width: 140px;"><strong>Employer:</strong></td><td>${data.contact?.companyName || data.name}</td></tr>
                                <tr><td style="padding: 5px 0;"><strong>Broker:</strong></td><td>${data.contact?.name || 'N/A'}</td></tr>
                                <tr><td style="padding: 5px 0;"><strong>Sales Person:</strong></td><td>${data.assignedToName || 'N/A'}</td></tr>
                                <tr><td style="padding: 5px 0;"><strong>Total Employees:</strong></td><td>${data.customFields.find(f => f.key === 'opportunity.total_employees')?.field_value || 'N/A'}</td></tr>
                                <tr><td style="padding: 5px 0;"><strong>Effective Date:</strong></td><td>${data.customFields.find(f => f.key === 'opportunity.effective_date')?.field_value || 'N/A'}</td></tr>
                                <tr><td style="padding: 5px 0;"><strong>Yearly Value:</strong></td><td>$${data.monetaryValue}</td></tr>
                            </table>
                        </div>

                        <h4 style="color: #003366; margin-bottom: 10px;">Product Overrides</h4>
                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px; border: 1px solid #eee;">
                            <thead style="background-color: #f1f5f9;">
                                <tr>
                                    <th style="padding: 12px 10px; text-align: left; border-bottom: 2px solid #ddd;">Product</th>
                                    <th style="padding: 12px 10px; text-align: left; border-bottom: 2 solid #ddd;">Employees</th>
                                    <th style="padding: 12px 10px; text-align: left; border-bottom: 2px solid #ddd;">Rate</th>
                                    <th style="padding: 12px 10px; text-align: left; border-bottom: 2px solid #ddd;">Justification</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${productRows}
                            </tbody>
                        </table>

                        <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;">
                            <a href="${baseUrl}/api/approve-opportunity?id=${opportunityId}" 
                               style="background-color: #80B040; color: white; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 0 10px 10px 10px; display: inline-block; min-width: 120px;">
                                APPROVE
                            </a>
                            <a href="${baseUrl}/api/reject-opportunity?id=${opportunityId}" 
                               style="background-color: #d32f2f; color: white; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 0 10px 10px 10px; display: inline-block; min-width: 120px;">
                                REJECT
                            </a>
                        </div>
                        
                        <p style="text-align: center; margin-top: 25px;">
                            <a href="https://app.gohighlevel.com/v2/location/${data.locationId}/opportunities/list" style="color: #003366; font-size: 13px; text-decoration: underline;">
                                View Opportunity in GHL Pipeline
                            </a>
                        </p>
                    </div>
                </div>
                <div style="max-width: 600px; margin: 0 auto; color: #94a3b8; padding: 20px; text-align: center; font-size: 11px;">
                    © ${new Date().getFullYear()} NueSynergy. All rights reserved. <br>
                    This is an automated request from the NueSynergy Sales Intake Portal.
                </div>
            </body>
            </html>
        `;

        const payload = {
            type: 'Email',
            contactId: joshCollinsContactId,
            emailFrom: 'sales-intake@nuesynergy.com',
            subject: `[LOCAL] Action Required: Price Override Approval for ${data.contact?.companyName || data.name}`,
            html: emailBody,
            message: `Action Required: Price override approval for ${data.name}. Visit the portal to review.`
        };

        const response = await axios.post(
            `https://services.leadconnectorhq.com/conversations/messages`,
            payload,
            { headers: getGHLHeaders(GHL_API_KEY) }
        );

        console.log('Approval email sent to Josh Collins:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error sending approval email:', error.response?.data || error.message);
    }
}

// Fetch users for the owner dropdown
app.get('/api/users', async (req, res) => {
    try {
        const locationId = 'NFWWwK7qd0rXqtNyOINy';
        console.log(`[Users API] Requesting users for location: ${locationId}`);

        const response = await axios.get(`https://services.leadconnectorhq.com/users/?locationId=${locationId}`, {
            headers: getGHLHeaders(GHL_API_KEY)
        });

        const users = response.data.users || response.data;
        console.log(`[Users API] Successfully fetched ${Array.isArray(users) ? users.length : 0} users.`);
        res.json(users);
    } catch (error) {
        console.error('[Users API] Error fetching users:', error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(error.response ? error.response.status : 500).json({
            error: 'Failed to fetch users',
            details: error.response ? error.response.data : error.message
        });
    }
});

// Fetch contacts for broker lookup
app.get('/api/contacts', async (req, res) => {
    try {
        const locationId = 'NFWWwK7qd0rXqtNyOINy';
        const query = req.query.query || '';
        console.log(`[Contacts API] Searching contacts for location: ${locationId}, query: ${query}`);

        // Using GET /contacts/ as it supports query and is known working in this project
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&query=${encodeURIComponent(query)}&limit=50`, {
            headers: getGHLHeaders(GHL_API_KEY)
        });

        const contacts = response.data.contacts || [];
        console.log(`[Contacts API] Successfully fetched ${contacts.length} contacts.`);
        res.json(contacts);
    } catch (error) {
        console.error('[Contacts API] Error fetching contacts:', error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(error.response ? error.response.status : 500).json({
            error: 'Failed to fetch contacts',
            details: error.response ? error.response.data : error.message
        });
    }
});

// Proxy endpoint for GHL Opportunity Creation
app.post('/api/create-opportunity', async (req, res) => {
    // Input Validation
    const validationErrors = validateOpportunityInput(req.body);
    if (validationErrors.length > 0) {
        console.error('Validation errors:', validationErrors);
        return res.status(400).json({
            error: 'Validation failed',
            details: validationErrors
        });
    }

    // Sanitize all input data
    const data = sanitizeOpportunityData(req.body);
    const locationId = data.locationId;

    // Extract Actor (Broker/User) from sanitized data
    const actor = {
        name: data.contact?.name || 'Unknown Broker',
        email: data.contact?.email || 'N/A',
        role: 'Broker'
    };

    try {
        console.log('--- Processing New Opportunity Request ---');
        console.log('Request Payload (sanitized):', JSON.stringify(data, null, 2));

        // 1. Establish ContactId atomically via Upsert
        let contactId = data.contactId;
        if (!contactId && data.contact) {
            console.log('Upserting Contact (Local Proxy)...');
            const upsertPayload = {
                firstName: data.contact.firstName || data.contact.name.split(' ')[0],
                lastName: data.contact.lastName || data.contact.name.split(' ').slice(1).join(' '),
                email: data.contact.email,
                companyName: data.contact.companyName,
                locationId: locationId
            };

            const upsertRes = await axios.post(
                'https://services.leadconnectorhq.com/contacts/upsert',
                upsertPayload,
                { headers: getGHLHeaders(GHL_API_KEY) }
            );

            contactId = upsertRes.data.contact.id;
            const isNew = upsertRes.data.new;

            console.log(`${isNew ? 'Created' : 'Updated'} contact via Upsert: ${contactId}`);

            if (isNew) {
                await logAudit('CREATE', 'Contact', contactId, upsertPayload, req, 'SUCCESS', actor);
            }
        }

        // 2. Create the Opportunity
        console.log('Creating Opportunity...');
        const opportunityPayload = {
            name: data.name,
            pipelineId: data.pipelineId,
            pipelineStageId: data.stageId,
            status: data.status || 'open',
            contactId: contactId,
            locationId: locationId,
            assignedTo: data.assignedTo,
            monetaryValue: data.monetaryValue,
            source: data.source,
            customFields: data.customFields
        };

        const oppRes = await axios.post('https://services.leadconnectorhq.com/opportunities/', opportunityPayload, { headers: getGHLHeaders(GHL_API_KEY) });
        const opportunity = oppRes.data.opportunity || oppRes.data;
        console.log('Opportunity Created Successfully!');

        // Log Opportunity Creation
        await logAudit('CREATE', 'Opportunity', opportunity.id, {
            name: data.name,
            monetaryValue: data.monetaryValue,
            pipelineId: data.pipelineId,
            status: data.status
        }, req, 'SUCCESS', actor);

        // 3. Dual-Write to Firestore
        try {
            console.log('Saving to Firestore...');
            const firestoreData = {
                employerName: data.employerName || data.contact?.companyName || data.name,
                status: 'new',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                broker: {
                    name: data.contact?.name || `${data.contact?.firstName || ''} ${data.contact?.lastName || ''}`.trim(),
                    email: data.contact?.email,
                    agency: data.brokerAgency || ''
                },
                details: {
                    effectiveDate: data.customFields.find(f => f.id === 'TCajUYyGFfxNawfFVHzH' || f.key === 'opportunity.rfp_effective_date')?.field_value,
                    proposalDate: data.customFields.find(f => f.id === 'qDAjtgB8BnOe44mmBxZJ' || f.key === 'opportunity.proposal_date')?.field_value,
                    totalEmployees: parseInt(data.customFields.find(f => f.id === '1Ns6AFE7tqfjLrSMmlGm' || f.key === 'opportunity.total_employees')?.field_value || '0'),
                    source: data.source || data.customFields.find(f => f.id === '4Ft4xkId76QFmogGxQLT' || f.key === 'opportunity.opportunity_source' || f.key === 'opportunity.source')?.field_value,
                    currentAdministrator: data.customFields.find(f => f.id === 'gG9uknunlZBamXsF5Ynu' || f.key === 'opportunity.current_administrator')?.field_value,
                    benAdminSystem: data.customFields.find(f => f.id === 'FbHjdv6IH9saWvWxD9qk' || f.key === 'opportunity.ben_admin_system')?.field_value,
                    postalCode: data.customFields.find(f => f.id === 'RjgwrcO6mdOKu80HsZA2' || f.key === 'opportunity.postal_code')?.field_value || ''
                },
                assignment: {
                    assignedToUser: data.assignedTo
                },
                products: data.products,
                financials: {
                    monthlyTotal: parseFloat(data.customFields.find(f => f.id === '7R4mvELrwlpcNtwFbeN1' || f.key === 'opportunity.monthly_total')?.field_value || '0'),
                    yearlyTotal: parseFloat(data.customFields.find(f => f.id === 'h4RmeiogDVZGhb0DEaia' || f.key === 'opportunity.yearly_total')?.field_value || '0')
                },
                approval: {
                    requiresApproval: data.customFields.find(f => f.id === 'wJbGGl9zanGxn392jFw5' || f.key === 'opportunity.requires_approval')?.field_value === 'Yes',
                    approverName: data.customFields.find(f => f.id === 'k29uFeF1SbZ5tIPSn7ro' || f.key === 'opportunity.approver_name')?.field_value
                },
                ghl: {
                    locationId: locationId,
                    contactId: contactId,
                    opportunityId: opportunity.id,
                    pipelineId: data.pipelineId,
                    syncedAt: admin.firestore.FieldValue.serverTimestamp()
                }
            };

            await admin.firestore().collection('opportunities').add(firestoreData);
            console.log('Saved to Firestore successfully.');
        } catch (fsError) {
            console.error('Firestore Save Failed:', fsError.message);
        }

        // 4. Automated PDF Upload
        try {
            const tempDir = path.join(__dirname, 'temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
            const fileName = `Proposal_${data.employerName || 'Group'}_${Date.now()}.pdf`;
            const filePath = path.join(tempDir, fileName);
            const justifications = (data.products || [])
                .filter(p => p.isOverride && p.justification)
                .map(p => `- ${p.product}: ${p.justification}`)
                .join('\n');

            const pdfData = {
                businessName: data.employerName || data.contact?.companyName || 'N/A',
                effectiveDate: data.customFields.find(f => f.id === 'TCajUYyGFfxNawfFVHzH' || f.key === 'opportunity.rfp_effective_date')?.field_value,
                proposalDate: data.customFields.find(f => f.id === 'qDAjtgB8BnOe44mmBxZJ' || f.key === 'opportunity.proposal_date')?.field_value,
                products: data.products,
                justifications: justifications
            };

            await createProposalPDF(pdfData, filePath);
            await uploadFileToGHL(filePath, locationId, opportunity.id, contactId, justifications);
        } catch (pdfErr) {
            console.error('Automated PDF Generation/Upload Failed:', pdfErr.message);
        }

        // 5. Send Approval Email (Independent of PDF success)
        try {
            // Debug Logging for Approval
            const approvalField = data.customFields.find(f => f.id === 'wJbGGl9zanGxn392jFw5' || f.key === 'opportunity.requires_approval');
            console.log('DEBUG: Approval Field:', JSON.stringify(approvalField, null, 2));
            console.log('DEBUG: Custom Fields:', JSON.stringify(data.customFields, null, 2));
            console.log('DEBUG: Products with Override:', JSON.stringify(data.products.filter(p => p.isOverride), null, 2));

            if (approvalField?.field_value === 'Yes') {
                console.log('DEBUG: Triggering approval email...');
                await sendApprovalEmail(data, opportunity.id);
            } else {
                console.log('DEBUG: Approval condition not met.');
            }
        } catch (emailErr) {
            console.error('Approval Email Failed:', emailErr.message);
        }

        res.json(oppRes.data);

    } catch (error) {
        console.error('ERROR:', error.response ? JSON.stringify(error.response.data) : error.message);

        await logAudit('CREATE', 'Opportunity', 'FAILED', {
            error: error.message,
            payload: req.body
        }, req, 'FAILURE', actor);

        res.status(error.response ? error.response.status : 500).json({
            error: 'Failed to process request',
            details: error.response ? error.response.data : error.message
        });
    }
});

// Endpoint for manual PDF generation (On-demand)
app.post('/api/generate-pdf', async (req, res) => {
    try {
        console.log('Generating On-Demand PDF...');
        const data = req.body;
        const fileName = `Proposal_${Date.now()}.pdf`;
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
        const outputPath = path.join(tempDir, fileName);

        await createProposalPDF(data, outputPath);
        res.download(outputPath, fileName, (err) => {
            if (err) console.error('Error downloading file:', err);
        });
    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

// Fetch all opportunities from Firestore
app.get('/api/opportunities', async (req, res) => {
    try {
        console.log('[Opportunities API] Fetching all opportunities...');
        const snapshot = await admin.firestore().collection('opportunities')
            .orderBy('createdAt', 'desc')
            .get();

        const opportunities = [];
        snapshot.forEach(doc => {
            opportunities.push({ id: doc.id, ...doc.data() });
        });

        console.log(`[Opportunities API] Found ${opportunities.length} records.`);
        res.json(opportunities);
    } catch (error) {
        console.error('[Opportunities API] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch opportunities' });
    }
});

app.get('/api/approve-opportunity', async (req, res) => {
    try {
        const opportunityId = req.query.id;
        if (!opportunityId) return res.status(400).send('Opportunity ID is required');

        // 1. Update Firestore
        const snapshot = await admin.firestore().collection('opportunities')
            .where('ghl.opportunityId', '==', opportunityId)
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            await doc.ref.update({
                'approval.status': 'approved',
                'approval.updatedAt': admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // 2. Add note to GHL
        await axios.post(`https://services.leadconnectorhq.com/opportunities/${opportunityId}/notes`, {
            body: `**Price override approved by Josh Collins via email.**`
        }, { headers });

        res.send(`
            <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background-color: #f8fafc;">
                    <div style="background: white; max-width: 500px; margin: 0 auto; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                        <div style="color: #80B040; font-size: 64px; margin-bottom: 20px;">✓</div>
                        <h2 style="color: #003366; margin-bottom: 15px;">Opportunity Approved</h2>
                        <p style="color: #64748b; line-height: 1.6;">The price override for this opportunity has been successfully approved. A note has been added to the opportunity in GHL.</p>
                        <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
                             <p style="font-size: 13px; color: #94a3b8;">You can now close this window.</p>
                        </div>
                    </div>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('Approval Error:', error.message);
        res.status(500).send('Error processing approval');
    }
});

app.get('/api/reject-opportunity', async (req, res) => {
    try {
        const opportunityId = req.query.id;
        if (!opportunityId) return res.status(400).send('Opportunity ID is required');

        // 1. Update Firestore
        const snapshot = await admin.firestore().collection('opportunities')
            .where('ghl.opportunityId', '==', opportunityId)
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            await doc.ref.update({
                'approval.status': 'rejected',
                'approval.updatedAt': admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // 2. Add note to GHL
        await axios.post(`https://services.leadconnectorhq.com/opportunities/${opportunityId}/notes`, {
            body: `**Price override rejected by Josh Collins via email.**`
        }, { headers });

        res.send(`
            <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background-color: #f8fafc;">
                    <div style="background: white; max-width: 500px; margin: 0 auto; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                        <div style="color: #d32f2f; font-size: 64px; margin-bottom: 20px;">✕</div>
                        <h2 style="color: #630000; margin-bottom: 15px;">Opportunity Rejected</h2>
                        <p style="color: #64748b; line-height: 1.6;">The price override for this opportunity has been rejected. A note has been added to the opportunity in GHL.</p>
                        <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
                             <p style="font-size: 13px; color: #94a3b8;">You can now close this window.</p>
                        </div>
                    </div>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('Rejection Error:', error.message);
        res.status(500).send('Error processing rejection');
    }
});

// Fetch audit logs
app.get('/api/audit-logs', async (req, res) => {
    try {
        console.log('[Audit Logs API] Fetching audit logs...');
        const limit = parseInt(req.query.limit) || 50;
        const startAfter = req.query.startAfter;
        const action = req.query.action;
        const status = req.query.status;
        const resourceId = req.query.resourceId;

        let query = admin.firestore().collection('audit_logs');

        // Apply filters
        if (action) query = query.where('action', '==', action);
        if (status) query = query.where('status', '==', status);
        if (resourceId) query = query.where('resourceId', '==', resourceId);

        // Apply ordering and limits
        query = query.orderBy('timestamp', 'desc').limit(limit);

        if (startAfter) {
            // Assume startAfter is seconds (timestamp)
            const seconds = parseInt(startAfter);
            if (!isNaN(seconds)) {
                const ts = new admin.firestore.Timestamp(seconds, 0);
                query = query.startAfter(ts);
            }
        }

        const snapshot = await query.get();

        const logs = [];
        snapshot.forEach(doc => {
            logs.push({ id: doc.id, ...doc.data() });
        });

        console.log(`[Audit Logs API] Found ${logs.length} records.`);
        res.json(logs);
    } catch (error) {
        console.error('[Audit Logs API] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

app.listen(PORT, () => {
    console.log(`GHL Proxy Server running at http://localhost:${PORT}`);
});
