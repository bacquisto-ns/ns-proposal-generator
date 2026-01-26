const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require('firebase-functions/params');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const FormData = require('form-data');
const admin = require('firebase-admin');

// --- Shared Logic ---
const { sanitizeString, sanitizeEmail, sanitizeNumber } = require('./shared/utils');
const { GHLService } = require('./shared/ghl-service');
const productsConfig = require('./shared/products.json');

// --- GHL Service Instance (lazy initialization) ---
let ghlServiceInstance = null;
const GHL_LOCATION_ID = 'NFWWwK7qd0rXqtNyOINy';
const STAGE_PROPOSAL_SENT = 'c027c8a1-dafb-4e96-bbf9-c82cfe33890a';
const STAGE_PENDING_APPROVAL = 'e2a38725-aebf-4348-a7a4-38974eefcc70';

async function getGHLService(apiKey) {
    if (!ghlServiceInstance || ghlServiceInstance.apiKey !== apiKey) {
        ghlServiceInstance = new GHLService(apiKey, GHL_LOCATION_ID, {
            useMCP: true,
            useRateLimiting: true,
            retryOnError: true
        });
        await ghlServiceInstance.initialize();
    }
    return ghlServiceInstance;
}

if (!admin.apps.length) {
    admin.initializeApp();
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
                ip: req ? (req.headers['x-forwarded-for'] || req.ip) : 'system',
                userAgent: req ? req.headers['user-agent'] : 'system',
                endpoint: req ? req.originalUrl : 'internal'
            }
        };

        await admin.firestore().collection('audit_logs').add(logEntry);
        console.log(`[Audit Log] ${action} ${resourceType} (${resourceId}) - ${status}`);
    } catch (error) {
        console.error('[Audit Log] Failed to record entry:', error.message);
    }
}

const ghlApiKey = defineSecret("GHL_API_KEY");

const app = express();

// Restrict CORS to specific domain in production
const allowedOrigins = [
    'https://nueforms-sales-intake-999.web.app',
    'http://localhost:3000',
    'http://localhost:5000'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
}));
app.use(express.json());

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
    if (!data.locationId || typeof data.locationId !== 'string') {
        errors.push('locationId is required');
    }
    if (!data.pipelineId || typeof data.pipelineId !== 'string') {
        errors.push('pipelineId is required');
    }
    if (!data.stageId || typeof data.stageId !== 'string') {
        errors.push('stageId is required');
    }
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
    if (data.products && !Array.isArray(data.products)) {
        errors.push('products must be an array');
    }
    if (data.customFields && !Array.isArray(data.customFields)) {
        errors.push('customFields must be an array');
    }
    return errors;
};

const sanitizeOpportunityData = (data) => {
    const sanitized = { ...data };
    sanitized.name = sanitizeString(data.name, 200);
    sanitized.source = sanitizeString(data.source, 100);
    sanitized.employerName = sanitizeString(data.employerName, 200);
    sanitized.brokerAgency = sanitizeString(data.brokerAgency, 200);
    sanitized.proposalMessage = sanitizeString(data.proposalMessage, 500);
    sanitized.monetaryValue = sanitizeNumber(data.monetaryValue);
    if (data.contact) {
        sanitized.contact = {
            name: sanitizeString(data.contact.name, 100),
            firstName: sanitizeString(data.contact.firstName, 50),
            lastName: sanitizeString(data.contact.lastName, 50),
            email: sanitizeEmail(data.contact.email),
            companyName: sanitizeString(data.contact.companyName, 200)
        };
    }
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
        const templatePath = path.join(__dirname, 'NueSynergy Pricing Proposal_Template 10.25.pdf');
        if (!fs.existsSync(templatePath)) {
            console.warn(`Template PDF not found at ${templatePath}. Creating a blank document instead.`);
            const doc = await PDFDocument.create();
            const page = doc.addPage();
            page.drawText('Template Not Found', { x: 50, y: 700 });
            const bytes = await doc.save();
            fs.writeFileSync(outputPath, bytes);
            return outputPath;
        }

        const templateBytes = fs.readFileSync(templatePath);
        const templateDoc = await PDFDocument.load(templateBytes);
        const finalDoc = await PDFDocument.create();

        const pageIndices = Array.from({ length: Math.min(15, templateDoc.getPageCount()) }, (_, i) => i);
        const copiedPages = await finalDoc.copyPages(templateDoc, pageIndices);
        copiedPages.forEach((page) => finalDoc.addPage(page));

        const boldFont = await finalDoc.embedFont(StandardFonts.HelveticaBold);
        const regularFont = await finalDoc.embedFont(StandardFonts.Helvetica);

        const primaryColor = rgb(0 / 255, 51 / 255, 102 / 255);
        const secondaryColor = rgb(128 / 255, 176 / 255, 64 / 255);
        const accentColor = rgb(230 / 255, 230 / 255, 230 / 255);
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

        const wrapText = (text, maxWidth, fontSize, font) => {
            const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
            if (!cleaned) return [];
            const words = cleaned.split(' ');
            const lines = [];
            let current = '';

            words.forEach(word => {
                const testLine = current ? `${current} ${word}` : word;
                if (font.widthOfTextAtSize(testLine, fontSize) <= maxWidth) {
                    current = testLine;
                } else {
                    if (current) lines.push(current);
                    current = word;
                }
            });

            if (current) lines.push(current);
            return lines;
        };

        // --- PAGE 16 ---
        let page16 = finalDoc.addPage();
        const { width, height } = page16.getSize();

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

        y = drawSectionHeader(page16, y, 'HSA Plans');
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('HSA'), getDate('hsa'));
        y = drawRow(page16, y, 'Spouse Saver Incentive Account', '-', getDate('hsa'), true);
        y = drawRow(page16, y, 'Annual Renewal (AFTER YEAR 1)', '-', getDate('hsa'), true);
        y = drawRow(page16, y, 'Monthly Minimum', findMinFee('HSA'), getDate('hsa'), true);
        y -= 10;

        y = drawSectionHeader(page16, y, 'Section 125, FSA Plans');
        y = drawRow(page16, y, 'FSA Plan Documents, Implementation, Design & Installation', findRate('FSA'), getDate('fsa'));
        y = drawRow(page16, y, 'Annual Compliance & Renewal (AFTER YEAR 1)', '-', getDate('fsa'), true);
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('FSA'), getDate('fsa'), true);
        y = drawRow(page16, y, 'Monthly Minimum', findMinFee('FSA'), getDate('fsa'), true);
        y -= 10;

        y = drawSectionHeader(page16, y, 'Section 105, HRA Plans');
        y = drawRow(page16, y, 'HRA Plan Documents, Implementation, Design & Installation', findRate('HRA'), getDate('hra'));
        y = drawRow(page16, y, 'Annual Compliance & Renewal (WAIVED 1st YEAR)', '-', getDate('hra'), true);
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('HRA'), getDate('hra'), true);
        y = drawRow(page16, y, 'Monthly Minimum', findMinFee('HRA'), getDate('hra'), true);
        y -= 10;

        y = drawSectionHeader(page16, y, 'Miscellaneous Services');
        const miscDate = (selection.hsa || selection.fsa || selection.hra || selection.lsa) ? effDate : '-';
        y = drawRow(page16, y, 'eClaims Manager Per Participant, Monthly', '-', miscDate);
        y = drawRow(page16, y, 'NueSynergy Smart Mobile App', 'Included', miscDate);
        y = drawRow(page16, y, 'Smart Debit Card Setup & Administration Per Participant, Monthly', '-', miscDate);
        y -= 10;

        y = drawSectionHeader(page16, y, 'LSA Plans');
        y = drawRow(page16, y, 'LSA Implementation, Design & Installation', findRate('LSA'), getDate('lsa'));
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('LSA'), getDate('lsa'), true);
        y -= 10;

        y = drawSectionHeader(page16, y, 'COBRAcare+ Administration');
        y = drawRow(page16, y, 'Per Benefits Enrolled Employee Per Month', findRate('COBRA'), getDate('cobra'));
        y = drawRow(page16, y, 'Current COBRA Continuation', '-', getDate('cobra'), true);
        y = drawRow(page16, y, 'Qualifying Event Notice', '-', getDate('cobra'), true);

        page16.drawText('855.890.7239  •  4601 College Blvd. Suite 280, Leawood, KS 66211  •  www.NueSynergy.com', { x: 50, y: 30, size: 8, font: regularFont, color: textColor });

        let page17 = finalDoc.addPage();
        page17.drawRectangle({ x: 0, y: height - 40, width, height: 40, color: secondaryColor });
        page17.drawRectangle({ x: 0, y: height - 100, width, height: 60, color: primaryColor });
        page17.drawText('PROPOSAL: CONTINUED', { x: 50, y: height - 75, size: 16, font: boldFont, color: rgb(1, 1, 1) });

        y = height - 120;

        y = drawSectionHeader(page17, y, 'Direct Billing');
        y = drawRow(page17, y, 'Implementation & Setup (YEAR 1)', findRate('Direct'), getDate('direct'));
        y = drawRow(page17, y, 'Annual Renewal (AFTER YEAR 1)', '-', getDate('direct'), true);
        y = drawRow(page17, y, 'Per Direct Bill Participant Per Month', findRate('Direct'), getDate('direct'), true);
        y = drawRow(page17, y, 'Direct Bill Minimum, Monthly', findMinFee('Direct'), getDate('direct'), true);
        y -= 10;

        y = drawSectionHeader(page17, y, 'Section 125, Premium Only Plan (POP)');
        y = drawRow(page17, y, 'POP Document (ONE-TIME SETUP FEE)', findRate('POP'), getDate('pop'));
        y = drawRow(page17, y, 'Annual Compliance & Renewal (WAIVED 1st YEAR)', '-', getDate('pop'), true);
        y -= 10;

        y = drawSectionHeader(page17, y, 'File Implementation and Processing');
        const anyProduct = Object.values(selection).some(v => v);
        const fileDate = anyProduct ? effDate : '-';
        y = drawRow(page17, y, 'Enrollment/Eligibility File (New Enrollment and Terminations)', '-', fileDate);
        y = drawRow(page17, y, 'Payroll/Contribution File', '-', fileDate);
        y = drawRow(page17, y, 'COBRA Initial Notices', '-', selection.cobra ? effDate : '-');

        const customMessage = String(data.proposalMessage || '').trim();
        if (customMessage) {
            const lineHeight = 12;
            y -= 28;
            page17.drawText('Custom Message', { x: 50, y, size: 10, font: boldFont, color: textColor });
            y -= 14;
            const lines = wrapText(customMessage, 500, 9, regularFont);
            const maxLines = Math.max(Math.floor((y - 40) / lineHeight), 0);
            lines.slice(0, maxLines).forEach(line => {
                page17.drawText(line, { x: 50, y, size: 9, font: regularFont, color: textColor });
                y -= lineHeight;
            });
        }

        page17.drawText('855.890.7239  •  4601 College Blvd. Suite 280, Leawood, KS 66211  •  www.NueSynergy.com', { x: 50, y: 30, size: 8, font: regularFont, color: textColor });

        const pdfBytes = await finalDoc.save();
        fs.writeFileSync(outputPath, pdfBytes);
        return outputPath;
    } catch (err) {
        console.error('Error in createProposalPDF:', err);
        throw err;
    }
}

async function sendApprovalEmail(data, opportunityId, ghlService) {
    try {
        const joshCollinsContactId = '357NYkROmrFIMPiAdpUc';
        const productsWithOverride = (data.products || []).filter(p => p.isOverride);

        if (productsWithOverride.length === 0) return;

        const productRows = productsWithOverride.map(p => `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: left;">${p.product}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: left;">${p.employees || '0'}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; color: #d32f2f; font-weight: bold; text-align: left;">$${p.rate}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; font-style: italic; color: #666; text-align: left;">${p.justification || 'N/A'}</td>
            </tr>
        `).join('');

        const baseUrl = 'https://nueforms-sales-intake-999.web.app';

        const emailBody = `
            <!DOCTYPE html>
            <html>
            <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0;">
                <div style="max-width: 600px; margin: 20px auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <div style="background-color: #ffffff; color: #003366; padding: 25px; text-align: center; border-bottom: 2px solid #003366;">
                        <img src="https://nuesynergy.com/wp-content/uploads/2023/02/nuesynergy_logo.png" alt="NueSynergy" style="max-width: 180px; width: 100%; height: auto; display: block; margin: 0 auto 12px;">
                        <h2 style="margin: 0; font-weight: bold; letter-spacing: 1px; color: #003366;">APPROVAL REQUIRED</h2>
                    </div>
                    <div style="padding: 30px;">
                        <p style="font-size: 16px;">An opportunity has been created that requires your approval due to price overrides.</p>
                        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 25px;">
                            <h4 style="margin-top: 0; color: #003366;">Proposal Details</h4>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                                <tr><td><strong>Employer:</strong></td><td>${data.employerName || data.name}</td></tr>
                                <tr><td><strong>Sales Person:</strong></td><td>${data.assignedToName || 'N/A'}</td></tr>
                                <tr><td><strong>Yearly Value:</strong></td><td>$${data.monetaryValue}</td></tr>
                            </table>
                        </div>
                        <h4 style="color: #003366;">Product Overrides</h4>
                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px; border: 1px solid #eee;">
                            <thead style="background-color: #f1f5f9;">
                                <tr>
                                    <th style="padding: 12px 10px; text-align: left;">Product</th>
                                    <th style="padding: 12px 10px; text-align: left;">Employees</th>
                                    <th style="padding: 12px 10px; text-align: left;">Rate</th>
                                    <th style="padding: 12px 10px; text-align: left;">Justification</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${productRows}
                            </tbody>
                        </table>
                        <div style="text-align: center;">
                            <a href="${baseUrl}/api/approve-opportunity?id=${opportunityId}" style="background-color: #80B040; color: white; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-right: 10px;">APPROVE</a>
                            <a href="${baseUrl}/api/reject-opportunity?id=${opportunityId}" style="background-color: #d32f2f; color: white; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">REJECT</a>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const payload = {
            type: 'Email',
            contactId: joshCollinsContactId,
            emailFrom: 'sales-intake@nuesynergy.com',
            subject: `Action Required: Price Override Approval for ${data.employerName || data.name}`,
            html: emailBody
        };

        return await ghlService.sendMessage(payload);
    } catch (error) {
        console.error('Error sending approval email:', error.message);
    }
}

async function resolveContactEmail(data, ghlService) {
    const email = data.contactEmail || data.contact?.email || data.brokerEmail || data.broker?.email;
    if (email) return email;
    if (!data.contactId) return null;

    try {
        const contactRes = await ghlService.getContact(data.contactId);
        const contact = contactRes.contact || contactRes;
        return contact?.email || null;
    } catch (error) {
        console.error('Failed to fetch contact email:', error.message);
        return null;
    }
}

async function resolveOwnerEmail(assignedTo, ghlService) {
    if (!assignedTo) return null;
    try {
        const users = await ghlService.getUsers();
        const userList = users.users || users;
        const owner = userList.find(u => u.id === assignedTo);
        return owner ? owner.email : null;
    } catch (error) {
        console.error('Failed to fetch owner email:', error.message);
        return null;
    }
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function sendProposalEmail(data, pdfUrl, ghlService) {
    const result = {
        ok: false,
        brokerEmail: null,
        ownerEmail: null,
        error: null
    };

    try {
        const contactId = data.contactId || data.ghl?.contactId;
        const assignedTo = data.assignedTo || data.assignment?.assignedToUser;
        const businessName = data.employerName || data.businessName || data.contact?.companyName || data.name || 'Group';

        if (!contactId) {
            result.error = 'missing_contact_id';
            return result;
        }

        if (!pdfUrl) {
            result.error = 'missing_pdf_url';
            return result;
        }

        const brokerEmail = await resolveContactEmail({ ...data, contactId }, ghlService);
        result.brokerEmail = brokerEmail;
        if (!brokerEmail) {
            result.error = 'missing_broker_email';
            return result;
        }

        const ownerEmail = await resolveOwnerEmail(assignedTo, ghlService);
        result.ownerEmail = ownerEmail;

        const proposalMessageRaw = data.proposalMessage || data.details?.proposalMessage || '';
        const proposalMessage = escapeHtml(proposalMessageRaw).trim().replace(/\n/g, '<br>');
        const proposalMessageBlock = proposalMessage
            ? `
                        <div style="margin-top: 20px; padding: 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                            <p style="margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b;"><strong>Proposal Message</strong></p>
                            <p style="margin: 0; font-size: 14px; color: #334155;">${proposalMessage}</p>
                        </div>
            `
            : '';

        const emailBody = `
            <!DOCTYPE html>
            <html>
            <body style="font-family: sans-serif;">
                <div style="max-width: 600px; margin: 20px auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <div style="background-color: #ffffff; color: #003366; padding: 25px; text-align: center; border-bottom: 2px solid #003366;">
                        <img src="https://nuesynergy.com/wp-content/uploads/2023/02/nuesynergy_logo.png" alt="NueSynergy" style="max-width: 180px; width: 100%; height: auto; display: block; margin: 0 auto 12px;">
                        <h2 style="margin: 0; font-weight: bold; letter-spacing: 1px; color: #003366;">PRICING PROPOSAL</h2>
                    </div>
                    <div style="padding: 30px;">
                    <p>Hello,</p>
                    <p>Please find the pricing proposal for <strong>${businessName}</strong> attached or via the link below:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${pdfUrl}" style="background-color: #80B040; color: white; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">VIEW PROPOSAL PDF</a>
                    </div>
                    <p style="font-size: 14px; color: #666;">If you have any questions, please reach out to your NueSynergy representative.</p>
                    ${proposalMessageBlock}
                    </div>
                </div>
            </body>
            </html>
        `;

        const payload = {
            type: 'Email',
            contactId: contactId,
            emailFrom: 'sales-intake@nuesynergy.com',
            emailTo: brokerEmail,
            subject: `Pricing Proposal: ${businessName}`,
            html: emailBody
        };

        if (ownerEmail && ownerEmail !== brokerEmail) {
            payload.emailCc = ownerEmail;
        }

        const response = await ghlService.sendMessage(payload);
        result.ok = true;
        return result;
    } catch (error) {
        console.error('Error sending proposal email:', error.message);
        result.error = error.message;
        return result;
    }
}

async function applyProposalEmailUpdate(docRef, result) {
    if (!docRef || !result) return;

    const update = {
        'proposal.lastAttemptAt': admin.firestore.FieldValue.serverTimestamp(),
        'proposal.attemptCount': admin.firestore.FieldValue.increment(1),
        'proposal.brokerEmail': result.brokerEmail || null,
        'proposal.ownerEmail': result.ownerEmail || null,
        'proposal.lastError': result.ok ? null : (result.error || 'send_failed'),
        'proposal.emailStatus': result.ok ? 'sent' : 'failed'
    };

    if (result.ok) {
        update['proposal.sentAt'] = admin.firestore.FieldValue.serverTimestamp();
    }

    await docRef.update(update);
}

app.get('/api/users', async (req, res) => {
    try {
        const apiKey = ghlApiKey.value();
        const ghlService = await getGHLService(apiKey);
        console.log(`[Users API] Requesting users for location: ${GHL_LOCATION_ID}`);

        const response = await ghlService.getUsers();
        const users = response.users || response;

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

app.get('/api/contacts', async (req, res) => {
    try {
        const query = req.query.query || '';
        const apiKey = ghlApiKey.value();
        const ghlService = await getGHLService(apiKey);
        console.log(`[Contacts API] Searching contacts for location: ${GHL_LOCATION_ID}, query: ${query}`);

        const response = await ghlService.searchContacts(query, { limit: 50 });
        const contacts = response.contacts || [];

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

app.get('/api/opportunities', async (req, res) => {
    try {
        console.log('[Opportunities API] Fetching opportunities...');
        const limit = parseInt(req.query.limit) || 50;
        const snapshot = await admin.firestore().collection('opportunities')
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        const opportunities = [];
        snapshot.forEach(doc => opportunities.push({ id: doc.id, ...doc.data() }));

        console.log(`[Opportunities API] Found ${opportunities.length} records.`);
        res.json(opportunities);
    } catch (error) {
        console.error('[Opportunities API] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch opportunities' });
    }
});

app.post('/api/create-opportunity', async (req, res) => {
    try {
        const data = sanitizeOpportunityData(req.body);
        const apiKey = ghlApiKey.value();
        const ghlService = await getGHLService(apiKey);

        let contactId = data.contactId;
        if (!contactId && data.contact) {
            const upsertRes = await ghlService.upsertContact(data.contact);
            contactId = upsertRes.contact.id;
        }

        const opportunityPayload = {
            name: data.name,
            pipelineId: data.pipelineId,
            pipelineStageId: data.stageId,
            status: 'open',
            contactId: contactId,
            assignedTo: data.assignedTo,
            monetaryValue: data.monetaryValue,
            customFields: data.customFields
        };

        const oppRes = await ghlService.createOpportunity(opportunityPayload);
        const opportunity = oppRes.opportunity || oppRes;

        const approvalField = data.customFields.find(f => f.id === 'wJbGGl9zanGxn392jFw5' || f.key === 'opportunity.requires_approval');
        const requiresApproval = approvalField?.field_value === 'Yes';

        let firestoreDocRef = null;
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
                postalCode: data.customFields.find(f => f.id === 'RjgwrcO6mdOKu80HsZA2' || f.key === 'opportunity.postal_code')?.field_value || '',
                proposalMessage: data.proposalMessage || ''
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
                requiresApproval: requiresApproval,
                approverName: data.customFields.find(f => f.id === 'k29uFeF1SbZ5tIPSn7ro' || f.key === 'opportunity.approver_name')?.field_value,
                status: requiresApproval ? 'pending' : 'not_required'
            },
            proposal: {
                pdfUrl: null,
                generatedAt: null,
                emailStatus: requiresApproval ? 'awaiting_approval' : 'pending',
                sentAt: null,
                lastAttemptAt: null,
                lastError: null,
                attemptCount: 0
            },
            ghl: {
                locationId: data.locationId,
                contactId: contactId,
                opportunityId: opportunity.id,
                pipelineId: data.pipelineId,
                syncedAt: admin.firestore.FieldValue.serverTimestamp()
            }
        };

        firestoreDocRef = await admin.firestore().collection('opportunities').add(firestoreData);

        // Automation
        try {
            const fileName = `Proposal_${Date.now()}.pdf`;
            const filePath = path.join(os.tmpdir(), fileName);
            await createProposalPDF(data, filePath);

            const form = new FormData();
            form.append('file', fs.createReadStream(filePath), { filename: fileName });
            const uploadRes = await ghlService.uploadFile(form);
            const pdfUrl = uploadRes.url || uploadRes.data?.url;

            if (firestoreDocRef && pdfUrl) {
                await firestoreDocRef.update({
                    'proposal.pdfUrl': pdfUrl,
                    'proposal.generatedAt': admin.firestore.FieldValue.serverTimestamp()
                });
            }

            if (requiresApproval) {
                await sendApprovalEmail(data, opportunity.id, ghlService);
            } else if (pdfUrl) {
                const sendResult = await sendProposalEmail({ ...data, contactId }, pdfUrl, ghlService);
                await applyProposalEmailUpdate(firestoreDocRef, sendResult);

                if (sendResult.ok && contactId) {
                    await ghlService.addContactNote(contactId,
                        `Pricing Proposal sent to Broker via automated email. [Link to Proposal](${pdfUrl})`
                    );
                }
            }
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (e) {
            console.error('PDF Flow failed', e);
        }

        res.json(opportunity);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/generate-pdf', async (req, res) => {
    try {
        const data = req.body;
        const fileName = `Manual_${Date.now()}.pdf`;
        const filePath = path.join(os.tmpdir(), fileName);
        await createProposalPDF(data, filePath);

        if (data.contactId) {
            console.log(`[PDF API] On-demand PDF generated for contact: ${data.contactId}`);
        }

        res.download(filePath);
    } catch (e) {
        res.status(500).send('Error');
    }
});

app.get('/api/approve-opportunity', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).send('Opportunity ID is required');
        const apiKey = ghlApiKey.value();
        const ghlService = await getGHLService(apiKey);

        let oppDocRef = null;
        let oppData = null;
        const snapshot = await admin.firestore().collection('opportunities')
            .where('ghl.opportunityId', '==', id)
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            oppDocRef = doc.ref;
            oppData = doc.data();
            await doc.ref.update({
                'approval.status': 'approved',
                'approval.updatedAt': admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // Update opportunity stage in GHL to "Proposal Sent"
        console.log(`[Approval API] Moving opportunity ${id} to stage ${STAGE_PROPOSAL_SENT}`);
        await ghlService.updateOpportunity(id, {
            stageId: STAGE_PROPOSAL_SENT
        });

        await ghlService.addOpportunityNote(id, '**Price override approved by Josh Collins via email. Opportunity moved to Proposal Sent stage.**');

        if (oppData?.proposal?.pdfUrl && oppData?.ghl?.contactId) {
            const sendData = {
                contactId: oppData.ghl.contactId,
                assignedTo: oppData.assignment?.assignedToUser,
                brokerEmail: oppData.broker?.email,
                employerName: oppData.employerName,
                businessName: oppData.employerName,
                effectiveDate: oppData.details?.effectiveDate,
                proposalMessage: oppData.details?.proposalMessage
            };
            const sendResult = await sendProposalEmail(sendData, oppData.proposal.pdfUrl, ghlService);
            await applyProposalEmailUpdate(oppDocRef, sendResult);

            if (sendResult.ok) {
                await ghlService.addContactNote(oppData.ghl.contactId,
                    `Pricing Proposal sent to Broker via automated email after approval. [Link to Proposal](${oppData.proposal.pdfUrl})`
                );
            }
        } else if (oppDocRef) {
            await oppDocRef.update({
                'proposal.emailStatus': 'failed',
                'proposal.lastAttemptAt': admin.firestore.FieldValue.serverTimestamp(),
                'proposal.lastError': 'missing_pdf_or_contact'
            });
        }

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
    } catch (e) {
        console.error('Approval Error:', e.message);
        res.status(500).send('Error');
    }
});

app.get('/api/reject-opportunity', async (req, res) => {
    try {
        const id = req.query.id;
        const apiKey = ghlApiKey.value();
        const ghlService = await getGHLService(apiKey);
        await ghlService.addOpportunityNote(id, '**Price override rejected by Josh Collins via email.**');

        // 3. Notify Opportunity Owner
        const snapshot = await admin.firestore().collection('opportunities')
            .where('ghl.opportunityId', '==', id)
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            const oppData = doc.data();
            const assignedTo = oppData?.assignment?.assignedToUser;
            const ownerEmail = await resolveOwnerEmail(assignedTo, ghlService);

            if (ownerEmail) {
                const businessName = oppData?.employerName || 'Group';
                const joshCollinsContactId = '357NYkROmrFIMPiAdpUc';

                console.log(`[Rejection API] Sending notification to owner ${ownerEmail}`);
                await ghlService.sendMessage({
                    type: 'Email',
                    contactId: joshCollinsContactId, // Send to Josh but CC the owner
                    cc: [ownerEmail],
                    html: `
                    <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                        <div style="background-color: #d32f2f; color: white; padding: 20px; text-align: center;">
                            <h2 style="margin: 0;">Proposal Rejected</h2>
                        </div>
                        <div style="padding: 30px;">
                            <p>The price override for <strong>${businessName}</strong> has been rejected by Josh Collins.</p>
                            <p><strong>Note:</strong> No proposal email was sent to the broker. If changes are needed, please update the opportunity in GHL and resubmit if necessary.</p>
                             <div style="text-align: center; margin-top: 30px;">
                                <a href="https://app.gohighlevel.com/v2/location/${GHL_LOCATION_ID}/opportunities/list" 
                                   style="background-color: #003366; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                                    View in GHL
                                </a>
                            </div>
                        </div>
                    </div>
                `
                });
            }

            await doc.ref.update({
                'approval.status': 'rejected',
                'approval.updatedAt': admin.firestore.FieldValue.serverTimestamp()
            });

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
        } else {
            res.status(404).send('Opportunity not found in system records.');
        }
    } catch (e) {
        console.error('Rejection Error:', e.message);
        res.status(500).send('Error processing rejection');
    }
});

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
            const seconds = parseInt(startAfter);
            if (!isNaN(seconds)) {
                const ts = new admin.firestore.Timestamp(seconds, 0);
                query = query.startAfter(ts);
            }
        }

        const snapshot = await query.get();
        const logs = [];
        snapshot.forEach(doc => logs.push({ id: doc.id, ...doc.data() }));

        console.log(`[Audit Logs API] Found ${logs.length} records.`);
        res.json(logs);
    } catch (error) {
        console.error('[Audit Logs API] Error:', error.message);
        res.status(500).json({
            error: 'Failed to fetch audit logs',
            details: error.message
        });
    }
});

exports.api = onRequest({ secrets: [ghlApiKey] }, app);
