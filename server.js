const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const admin = require('firebase-admin');
require('dotenv').config();

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

// --- Email Template Helper ---
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

// --- Email Template Management (Admin) ---
app.get('/api/admin/email-templates', async (req, res) => {
    try {
        const templatesDir = path.join(__dirname, 'shared', 'email-templates');
        const files = fs.readdirSync(templatesDir);
        const templates = files.filter(f => f.endsWith('.html')).map(f => f.replace('.html', ''));
        res.json(templates);
    } catch (error) {
        console.error('[Admin] Failed to list templates:', error);
        res.status(500).json({ error: 'Failed to list templates' });
    }
});

app.get('/api/admin/email-templates/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const templatePath = path.join(__dirname, 'shared', 'email-templates', `${name}.html`);
        if (!fs.existsSync(templatePath)) {
            return res.status(404).json({ error: 'Template not found' });
        }
        const content = fs.readFileSync(templatePath, 'utf8');
        res.json({ name, content });
    } catch (error) {
        console.error('[Admin] Failed to read template:', error);
        res.status(500).json({ error: 'Failed to read template' });
    }
});

app.post('/api/admin/email-templates/preview', async (req, res) => {
    try {
        const { content, data } = req.body;
        if (!content) return res.status(400).json({ error: 'Content is required' });

        let rendered = content;
        const previewData = data || {};

        // Replace placeholders {{key}}
        Object.keys(previewData).forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            rendered = rendered.replace(regex, previewData[key]);
        });

        res.json({ html: rendered });
    } catch (error) {
        console.error('[Admin] Failed to preview template:', error);
        res.status(500).json({ error: 'Failed to preview template' });
    }
});

app.post('/api/admin/email-templates/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: 'Content is required' });

        const templatePath = path.join(__dirname, 'shared', 'email-templates', `${name}.html`);
        const prodTemplatePath = path.join(__dirname, 'functions', 'shared', 'email-templates', `${name}.html`);

        // Save locally
        fs.writeFileSync(templatePath, content, 'utf8');

        // Sync to functions directory if it exists
        if (fs.existsSync(path.dirname(prodTemplatePath))) {
            fs.writeFileSync(prodTemplatePath, content, 'utf8');
        }

        await logAudit('TEMPLATE_UPDATE', 'System', name, { name }, req, 'SUCCESS');
        res.json({ message: 'Template updated successfully' });
    } catch (error) {
        console.error('[Admin] Failed to update template:', error);
        res.status(500).json({ error: 'Failed to update template' });
    }
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
    sanitized.proposalMessage = sanitizeString(data.proposalMessage, 500);
    sanitized.monetaryValue = sanitizeNumber(data.monetaryValue);
    sanitized.effectiveDate = sanitizeString(data.effectiveDate, 20);
    sanitized.proposalDate = sanitizeString(data.proposalDate, 20);
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

        const getProductDate = (search) => {
            const prod = (data.products || []).find(p => p.product.toLowerCase().includes(search.toLowerCase()));
            if (!prod) return '-';
            return prod.effectiveDate || effDate;
        };

        page16.drawRectangle({ x: 50, y: y - 20, width: 512, height: 20, color: accentColor });
        const groupName = data.businessName || data.employerName || '';
        page16.drawText(`GROUP: ${groupName}`, { x: 60, y: y - 14, size: 10, font: boldFont, color: textColor });
        y -= 25;

        // HSA
        y = drawSectionHeader(page16, y, 'HSA Plans');
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('HSA'), getProductDate('HSA'));
        y = drawRow(page16, y, 'Spouse Saver Incentive Account', '-', getProductDate('HSA'), true);
        y = drawRow(page16, y, 'Annual Renewal (AFTER YEAR 1)', '-', getProductDate('HSA'), true);
        y = drawRow(page16, y, 'Monthly Minimum', findMinFee('HSA'), getProductDate('HSA'), true);
        y -= 10;

        // FSA
        y = drawSectionHeader(page16, y, 'Section 125, FSA Plans');
        y = drawRow(page16, y, 'FSA Plan Documents, Implementation, Design & Installation', findRate('FSA'), getProductDate('FSA'));
        y = drawRow(page16, y, 'Annual Compliance & Renewal (AFTER YEAR 1)', '-', getProductDate('FSA'), true);
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('FSA'), getProductDate('FSA'), true);
        y = drawRow(page16, y, 'Monthly Minimum', findMinFee('FSA'), getProductDate('FSA'), true);
        y -= 10;

        // HRA
        y = drawSectionHeader(page16, y, 'Section 105, HRA Plans');
        y = drawRow(page16, y, 'HRA Plan Documents, Implementation, Design & Installation', findRate('HRA'), getProductDate('HRA'));
        y = drawRow(page16, y, 'Annual Compliance & Renewal (WAIVED 1st YEAR)', '-', getProductDate('HRA'), true);
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('HRA'), getProductDate('HRA'), true);
        y = drawRow(page16, y, 'Monthly Minimum', findMinFee('HRA'), getProductDate('HRA'), true);
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
        y = drawRow(page16, y, 'LSA Implementation, Design & Installation', findRate('LSA'), getProductDate('LSA'));
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('LSA'), getProductDate('LSA'), true);
        y -= 10;

        // COBRA
        y = drawSectionHeader(page16, y, 'COBRAcare+ Administration');
        y = drawRow(page16, y, 'Per Benefits Enrolled Employee Per Month', findRate('COBRA'), getProductDate('COBRA'));
        y = drawRow(page16, y, 'Current COBRA Continuation', '-', getProductDate('COBRA'), true);
        y = drawRow(page16, y, 'Qualifying Event Notice', '-', getProductDate('COBRA'), true);

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
        y = drawRow(page17, y, 'Implementation & Setup (YEAR 1)', findRate('Direct'), getProductDate('Direct'));
        y = drawRow(page17, y, 'Annual Renewal (AFTER YEAR 1)', '-', getProductDate('Direct'), true);
        y = drawRow(page17, y, 'Per Direct Bill Participant Per Month', findRate('Direct'), getProductDate('Direct'), true);
        y = drawRow(page17, y, 'Direct Bill Minimum, Monthly', findMinFee('Direct'), getProductDate('Direct'), true);
        y -= 10;

        // POP
        y = drawSectionHeader(page17, y, 'Section 125, Premium Only Plan (POP)');
        y = drawRow(page17, y, 'POP Document (ONE-TIME SETUP FEE)', findRate('POP'), getProductDate('POP'));
        y = drawRow(page17, y, 'Annual Compliance & Renewal (WAIVED 1st YEAR)', '-', getProductDate('POP'), true);
        y -= 10;

        // Files
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

async function uploadFileToGHL(filePath, locationId, opportunityId, contactId, ghlService, justifications = '') {
    try {
        const stats = fs.statSync(filePath);
        const fileName = path.basename(filePath);

        const form = new FormData();
        form.append('file', fs.createReadStream(filePath), {
            filename: fileName,
            contentType: 'application/pdf',
            knownLength: stats.size
        });

        const uploadResponse = await ghlService.uploadFile(form);

        const fileUrl = uploadResponse.url || uploadResponse.data?.url;
        console.log('File uploaded to GHL:', fileUrl);

        await ghlService.addContactNote(contactId, `NueSynergy Pricing Proposal generated automatically. [Link to Proposal](${fileUrl})${justifications ? '\n\n**Price Override Justifications:**\n' + justifications : ''}`);

        console.log('Proposal linked to Opportunity via Note');
        return fileUrl;
    } catch (error) {
        console.error('GHL File Upload Error:', error.response?.data || error.message);
        throw error;
    }
}

async function sendApprovalEmail(data, opportunityId, ghlService) {
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

        const emailBody = loadTemplate('approval-email', {
            employerName: data.contact?.companyName || data.name,
            brokerName: data.contact?.name || 'N/A',
            salesPerson: data.assignedToName || 'N/A',
            totalEmployees: data.customFields.find(f => f.key === 'opportunity.total_employees')?.field_value || 'N/A',
            effectiveDate: data.customFields.find(f => f.key === 'opportunity.effective_date')?.field_value || 'N/A',
            yearlyValue: data.monetaryValue,
            productRows,
            baseUrl,
            opportunityId,
            locationId: data.locationId,
            currentYear: new Date().getFullYear()
        });

        const payload = {
            type: 'Email',
            contactId: joshCollinsContactId,
            emailFrom: 'sales-intake@nuesynergy.com',
            subject: `[LOCAL] Action Required: Price Override Approval for ${data.contact?.companyName || data.name}`,
            html: emailBody,
            message: `Action Required: Price override approval for ${data.name}. Visit the portal to review.`
        };

        const response = await ghlService.sendMessage(payload);

        console.log('Approval email sent to Josh Collins:', response);
        return response;
    } catch (error) {
        console.error('Error sending approval email:', error.response?.data || error.message);
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
        console.error('[resolveContactEmail] Failed to fetch contact email:', error.message);
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
        console.error('[resolveOwnerEmail] Failed to fetch owner email:', error.message);
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

/**
 * Sends a proposal email to the Broker and CCs the Opportunity Owner
 */
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
            console.warn('[sendProposalEmail] Missing contactId, skipping email.');
            return result;
        }

        if (!pdfUrl) {
            result.error = 'missing_pdf_url';
            console.warn('[sendProposalEmail] Missing pdfUrl, skipping email.');
            return result;
        }

        const brokerEmail = await resolveContactEmail({ ...data, contactId }, ghlService);
        result.brokerEmail = brokerEmail;
        if (!brokerEmail) {
            result.error = 'missing_broker_email';
            console.warn('[sendProposalEmail] Missing broker email, skipping email.');
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

        const productTableRowsArr = (data.products || []).map(p => `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: left;">${p.product}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: left;">${p.effectiveDate || data.effectiveDate || 'N/A'}</td>
            </tr>
        `);
        const productTableRows = productTableRowsArr.join('');

        const emailBody = loadTemplate('proposal-email', {
            businessName,
            pdfUrl,
            productTableRows,
            proposalMessageBlock,
            effectiveDate: data.effectiveDate || 'N/A',
            currentYear: new Date().getFullYear()
        });

        const payload = {
            type: 'Email',
            contactId: contactId,
            emailFrom: 'sales-intake@nuesynergy.com',
            emailTo: brokerEmail,
            subject: `Pricing Proposal: ${businessName}`,
            html: emailBody,
            message: `Please find the pricing proposal for ${businessName} here: ${pdfUrl}`
        };

        if (ownerEmail && ownerEmail !== brokerEmail) {
            payload.emailCc = ownerEmail;
        }

        const response = await ghlService.sendMessage(payload);
        console.log('[sendProposalEmail] Proposal email sent successfully:', response);
        result.ok = true;
        return result;
    } catch (error) {
        console.error('[sendProposalEmail] Error sending proposal email:', error.response?.data || error.message);
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

// Fetch users for the owner dropdown
app.get('/api/users', async (req, res) => {
    try {
        const ghlService = await getGHLService(GHL_API_KEY);
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

// Fetch contacts for broker lookup
app.get('/api/contacts', async (req, res) => {
    try {
        const query = req.query.query || '';
        const ghlService = await getGHLService(GHL_API_KEY);
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
        const ghlService = await getGHLService(GHL_API_KEY);
        console.log('--- Processing New Opportunity Request ---');
        console.log('Request Payload (sanitized):', JSON.stringify(data, null, 2));

        // 1. Establish ContactId atomically via Upsert
        let contactId = data.contactId;
        if (!contactId && data.contact) {
            console.log('Upserting Contact via GHLService...');
            const upsertPayload = {
                firstName: data.contact.firstName || data.contact.name.split(' ')[0],
                lastName: data.contact.lastName || data.contact.name.split(' ').slice(1).join(' '),
                email: data.contact.email,
                companyName: data.contact.companyName
            };

            await logAudit('CONTACT_UPSERT_ATTEMPT', 'Contact', 'NEW', upsertPayload, req, 'SUCCESS', actor);

            const upsertRes = await ghlService.upsertContact(upsertPayload);

            contactId = upsertRes.contact.id;
            const isNew = upsertRes.new;

            console.log(`${isNew ? 'Created' : 'Updated'} contact via GHLService: ${contactId}`);

            await logAudit('CONTACT_UPSERT_SUCCESS', 'Contact', contactId, { isNew, ...upsertPayload }, req, 'SUCCESS', actor);
        }

        // 2. Create Opportunity with defensive logging
        console.log(`Creating Opportunity for Contact: ${contactId || 'MISSING' || 'N/A'}`);
        if (!contactId) {
            throw new Error('Cannot create opportunity: contactId is null or undefined.');
        }

        const opportunityPayload = {
            name: data.name,
            pipelineId: data.pipelineId,
            pipelineStageId: data.stageId,
            status: data.status || 'open',
            contactId: contactId,
            assignedTo: data.assignedTo,
            monetaryValue: data.monetaryValue,
            source: data.source,
            customFields: data.customFields
        };

        console.log('Opportunity Payload:', JSON.stringify(opportunityPayload, null, 2));
        await logAudit('OPPORTUNITY_CREATE_ATTEMPT', 'Opportunity', 'NEW', opportunityPayload, req, 'SUCCESS', actor);

        const oppRes = await ghlService.createOpportunity(opportunityPayload);

        console.log('GHL Opportunity Response:', JSON.stringify(oppRes, null, 2));

        const opportunity = oppRes.opportunity || oppRes;
        if (!opportunity || !opportunity.id) {
            throw new Error('GHL failed to return an opportunity ID in the service response.');
        }
        console.log('Opportunity Created Successfully!');

        // Log Opportunity Creation Success
        await logAudit('OPPORTUNITY_CREATE_SUCCESS', 'Opportunity', opportunity.id, {
            name: data.name,
            monetaryValue: data.monetaryValue,
            pipelineId: data.pipelineId,
            status: data.status
        }, req, 'SUCCESS', actor);

        const approvalField = data.customFields.find(f => f.id === 'wJbGGl9zanGxn392jFw5' || f.key === 'opportunity.requires_approval');
        const requiresApproval = approvalField?.field_value === 'Yes';

        // 3. Dual-Write to Firestore
        let firestoreDocRef = null;
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
                    locationId: locationId,
                    contactId: contactId,
                    opportunityId: opportunity.id,
                    pipelineId: data.pipelineId,
                    syncedAt: admin.firestore.FieldValue.serverTimestamp()
                }
            };

            firestoreDocRef = await admin.firestore().collection('opportunities').add(firestoreData);
            console.log('Saved to Firestore successfully.');
        } catch (fsError) {
            console.error('Firestore Save Failed:', fsError.message);
        }

        // 4. Automated PDF Generation & Processing
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
                justifications: justifications,
                proposalMessage: data.proposalMessage || ''
            };

            console.log('Generating automated PDF...');
            await logAudit('PDF_GEN_ATTEMPT', 'Opportunity', opportunity.id, pdfData, req, 'SUCCESS', actor);
            await createProposalPDF(pdfData, filePath);
            await logAudit('PDF_GEN_SUCCESS', 'Opportunity', opportunity.id, { fileName }, req, 'SUCCESS', actor);

            let pdfUrl = null;
            if (contactId) {
                try {
                    const stats = fs.statSync(filePath);
                    const form = new FormData();
                    form.append('file', fs.createReadStream(filePath), { filename: fileName, contentType: 'application/pdf', knownLength: stats.size });

                    console.log('Uploading PDF to GHL Media Library...');
                    await logAudit('FILE_UPLOAD_ATTEMPT', 'Opportunity', opportunity.id, { fileName }, req, 'SUCCESS', actor);
                    const uploadRes = await ghlService.uploadFile(form);
                    pdfUrl = uploadRes.url || uploadRes.data?.url;

                    if (pdfUrl) {
                        await logAudit('FILE_UPLOAD_SUCCESS', 'Opportunity', opportunity.id, { pdfUrl }, req, 'SUCCESS', actor);

                        await logAudit('NOTE_CREATE_ATTEMPT', 'Contact', contactId, { type: 'ProposalLink' }, req, 'SUCCESS', actor);
                        await ghlService.addContactNote(contactId,
                            `NueSynergy Pricing Proposal generated automatically. [Link to Proposal](${pdfUrl})${justifications ? '\n\n**Price Override Justifications:**\n' + justifications : ''}`
                        );
                        await logAudit('NOTE_CREATE_SUCCESS', 'Contact', contactId, { type: 'ProposalLink' }, req, 'SUCCESS', actor);
                        console.log('Automated PDF linked to contact.');
                    }
                } catch (pdfErr) {
                    console.error('Automated PDF Upload Failed:', pdfErr.message);
                }
            }

            if (firestoreDocRef && pdfUrl) {
                await firestoreDocRef.update({
                    'proposal.pdfUrl': pdfUrl,
                    'proposal.generatedAt': admin.firestore.FieldValue.serverTimestamp()
                });
            }

            // 5. Automation: Approval vs Direct Email
            if (requiresApproval) {
                console.log('Price override detected. Sending approval request to Josh Collins...');
                await logAudit('APPROVAL_EMAIL_ATTEMPT', 'Opportunity', opportunity.id, { recipient: 'Josh Collins' }, req, 'SUCCESS', actor);
                await sendApprovalEmail(data, opportunity.id, ghlService);
                await logAudit('APPROVAL_EMAIL_SUCCESS', 'Opportunity', opportunity.id, { recipient: 'Josh Collins' }, req, 'SUCCESS', actor);
            } else if (pdfUrl) {
                console.log('No approval required. Sending proposal email to Broker immediately...');
                await logAudit('PROPOSAL_EMAIL_ATTEMPT', 'Opportunity', opportunity.id, { contactId, pdfUrl }, req, 'SUCCESS', actor);
                const sendResult = await sendProposalEmail({
                    ...data,
                    contactId: contactId
                }, pdfUrl, ghlService);
                await logAudit('PROPOSAL_EMAIL_SUCCESS', 'Opportunity', opportunity.id, { ok: sendResult.ok }, req, 'SUCCESS', actor);

                if (sendResult.ok) {
                    await logAudit('NOTE_CREATE_ATTEMPT', 'Contact', contactId, { type: 'ProposalSent' }, req, 'SUCCESS', actor);
                    await ghlService.addContactNote(contactId,
                        `Pricing Proposal sent to Broker via automated email. [Link to Proposal](${pdfUrl})`
                    );
                    await logAudit('NOTE_CREATE_SUCCESS', 'Contact', contactId, { type: 'ProposalSent' }, req, 'SUCCESS', actor);
                }

                await applyProposalEmailUpdate(firestoreDocRef, sendResult);
            }

        } catch (pdfErr) {
            console.error('Automated PDF Generation/Automation Failed:', pdfErr.message);
        }


        res.json(oppRes);

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

// Update the generate-pdf endpoint to also handle sending emails if metadata is present
app.post('/api/generate-pdf', async (req, res) => {
    try {
        console.log('Generating On-Demand PDF & Sending Email...');
        const data = req.body;
        const fileName = `Proposal_${data.employerName || data.businessName || 'Group'}_${Date.now()}.pdf`;
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
        const outputPath = path.join(tempDir, fileName);

        // 1. Generate PDF
        await createProposalPDF(data, outputPath);

        // 2. Metadata presence (optional: could be used for logging or future enhancements, 
        // but we no longer send emails automatically from this endpoint to avoid duplicates)
        if (data.contactId) {
            console.log(`[PDF API] On-demand PDF generated for contact: ${data.contactId}`);
        }

        // 3. Trigger Download
        res.download(outputPath, fileName, (err) => {
            if (err) console.error('Error downloading file:', err);
        });
    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

app.get('/api/approve-opportunity', async (req, res) => {
    try {
        const opportunityId = req.query.id;
        if (!opportunityId) return res.status(400).send('Opportunity ID is required');

        // 1. Update Firestore
        await logAudit('OPPORTUNITY_APPROVE_ATTEMPT', 'Opportunity', opportunityId, { actor: 'Josh Collins' }, req, 'SUCCESS');
        let oppDocRef = null;
        let oppData = null;
        const snapshot = await admin.firestore().collection('opportunities')
            .where('ghl.opportunityId', '==', opportunityId)
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

        // 2. Add note to GHL
        const ghlService = await getGHLService(GHL_API_KEY);

        // Update opportunity stage in GHL to "Proposal Sent"
        console.log(`[Approval API] Moving opportunity ${opportunityId} to stage ${STAGE_PROPOSAL_SENT}`);
        await logAudit('UPDATE_STAGE_ATTEMPT', 'Opportunity', opportunityId, { stage: STAGE_PROPOSAL_SENT }, req, 'SUCCESS');
        await ghlService.updateOpportunity(opportunityId, {
            stageId: STAGE_PROPOSAL_SENT
        });
        await logAudit('UPDATE_STAGE_SUCCESS', 'Opportunity', opportunityId, { stage: STAGE_PROPOSAL_SENT }, req, 'SUCCESS');

        await logAudit('NOTE_CREATE_ATTEMPT', 'Opportunity', opportunityId, { type: 'ApprovalNote' }, req, 'SUCCESS');
        await ghlService.addOpportunityNote(opportunityId, '**Price override approved by Josh Collins via email. Opportunity moved to Proposal Sent stage.**');
        await logAudit('NOTE_CREATE_SUCCESS', 'Opportunity', opportunityId, { type: 'ApprovalNote' }, req, 'SUCCESS');

        // 3. Send proposal after approval
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

            await logAudit('PROPOSAL_EMAIL_ATTEMPT', 'Opportunity', opportunityId, { contactId: oppData.ghl.contactId, pdfUrl: oppData.proposal.pdfUrl }, req, 'SUCCESS');
            const sendResult = await sendProposalEmail(sendData, oppData.proposal.pdfUrl, ghlService);
            await logAudit('PROPOSAL_EMAIL_SUCCESS', 'Opportunity', opportunityId, { ok: sendResult.ok }, req, 'SUCCESS');
            await applyProposalEmailUpdate(oppDocRef, sendResult);

            if (sendResult.ok) {
                await logAudit('NOTE_CREATE_ATTEMPT', 'Contact', oppData.ghl.contactId, { type: 'ProposalSentPostApproval' }, req, 'SUCCESS');
                await ghlService.addContactNote(oppData.ghl.contactId,
                    `Pricing Proposal sent to Broker via automated email after approval. [Link to Proposal](${oppData.proposal.pdfUrl})`
                );
                await logAudit('NOTE_CREATE_SUCCESS', 'Contact', oppData.ghl.contactId, { type: 'ProposalSentPostApproval' }, req, 'SUCCESS');
            }
        } else if (oppDocRef) {
            await oppDocRef.update({
                'proposal.emailStatus': 'failed',
                'proposal.lastAttemptAt': admin.firestore.FieldValue.serverTimestamp(),
                'proposal.lastError': 'missing_pdf_or_contact'
            });
            await logAudit('OPPORTUNITY_APPROVE_ERROR', 'Opportunity', opportunityId, { error: 'missing_pdf_or_contact' }, req, 'FAILURE');
        }

        await logAudit('OPPORTUNITY_APPROVE_SUCCESS', 'Opportunity', opportunityId, { actor: 'Josh Collins' }, req, 'SUCCESS');

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
            const oppData = doc.data(); // Fetch data to use below
            const assignedTo = oppData?.assignment?.assignedToUser;
            const ownerEmail = await resolveOwnerEmail(assignedTo, ghlService);

            if (ownerEmail) {
                const businessName = oppData?.employerName || 'Group';
                const joshCollinsContactId = '357NYkROmrFIMPiAdpUc';

                console.log(`[Rejection API] Sending notification to owner ${ownerEmail}`);
                await ghlService.sendMessage({
                    type: 'Email',
                    contactId: joshCollinsContactId, // Send to Josh but CC the owner
                    emailFrom: 'sales-intake@nuesynergy.com',
                    subject: `Proposal REJECTED: ${businessName}`,
                    cc: [ownerEmail],
                    html: `
                        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
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
        }

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
