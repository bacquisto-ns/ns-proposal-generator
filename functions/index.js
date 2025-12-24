const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require('firebase-functions/params');
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const FormData = require('form-data');
const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
    admin.firestore().settings({ ignoreUndefinedProperties: true });
}

// --- Audit Logging Helper ---
async function logAudit(action, resourceType, resourceId, details, req = null) {
    try {
        const logEntry = {
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action: action, // 'CREATE', 'UPDATE', 'DELETE'
            resourceType: resourceType, // 'Opportunity', 'Contact', 'System'
            resourceId: resourceId,
            details: details,
            metadata: {
                ip: req ? (req.headers['x-forwarded-for'] || req.ip) : 'system',
                userAgent: req ? req.headers['user-agent'] : 'system',
                endpoint: req ? req.originalUrl : 'internal'
            }
        };

        await admin.firestore().collection('audit_logs').add(logEntry);
        console.log(`[Audit Log] ${action} ${resourceType} (${resourceId}) recorded.`);
    } catch (error) {
        console.error('[Audit Log] Failed to record entry:', error.message);
    }
}

const ghlApiKey = defineSecret("GHL_API_KEY");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const FALLBACK_API_KEY = 'pit-8f3b0ca9-680b-4a08-b639-c43969eabe05';

const getHeaders = (apiKey) => {
    const key = (apiKey && apiKey.trim()) ? apiKey.trim() : FALLBACK_API_KEY;
    return {
        'Authorization': `Bearer ${key}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
    };
};

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

async function createProposalPDF(data, outputPath) {
    try {
        const templatePath = path.join(__dirname, 'NueSynergy Pricing Proposal_Template 10.25.pdf');
        // Note: In Firebase Functions, files in the function directory are included in the deployment
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
            const rateStr = `$${parseFloat(prod.rate).toFixed(2)}`;
            return prod.isOverride ? `${rateStr}*` : rateStr;
        };

        // --- PAGE 16 ---
        let page16 = finalDoc.addPage();
        const { width, height } = page16.getSize();

        // Banner
        page16.drawRectangle({ x: 0, y: height - 40, width, height: 40, color: secondaryColor });
        page16.drawRectangle({ x: 0, y: height - 100, width, height: 60, color: primaryColor });
        page16.drawText('PROPOSAL: PLAN OPTIONS', { x: 50, y: height - 75, size: 16, font: boldFont, color: rgb(1, 1, 1) });
        page16.drawText('About NueSynergy', { x: 50, y: height - 90, size: 12, font: regularFont, color: rgb(1, 1, 1) });

        let y = height - 120;
        const effDate = data.effectiveDate || '-';

        page16.drawRectangle({ x: 50, y: y - 20, width: 512, height: 20, color: accentColor });
        page16.drawText(`GROUP: ${data.businessName || ''}`, { x: 60, y: y - 14, size: 10, font: boldFont, color: textColor });
        y -= 25;

        // HSA
        y = drawSectionHeader(page16, y, 'HSA Plans');
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('HSA'), effDate);
        y = drawRow(page16, y, 'Spouse Saver Incentive Account', '-', effDate, true);
        y = drawRow(page16, y, 'Annual Renewal (AFTER YEAR 1)', '-', effDate, true);
        y = drawRow(page16, y, 'Monthly Minimum', '-', effDate, true);
        y -= 10;

        // FSA
        y = drawSectionHeader(page16, y, 'Section 125, FSA Plans');
        y = drawRow(page16, y, 'FSA Plan Documents, Implementation, Design & Installation', findRate('FSA'), effDate);
        y = drawRow(page16, y, 'Annual Compliance & Renewal (AFTER YEAR 1)', '-', effDate, true);
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('FSA'), effDate, true);
        y = drawRow(page16, y, 'Monthly Minimum', '-', effDate, true);
        y -= 10;

        // HRA
        y = drawSectionHeader(page16, y, 'Section 105, HRA Plans');
        y = drawRow(page16, y, 'HRA Plan Documents, Implementation, Design & Installation', findRate('HRA'), effDate);
        y = drawRow(page16, y, 'Annual Compliance & Renewal (WAIVED 1st YEAR)', '-', effDate, true);
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('HRA'), effDate, true);
        y = drawRow(page16, y, 'Monthly Minimum', '-', effDate, true);
        y -= 10;

        // Miscellaneous
        y = drawSectionHeader(page16, y, 'Miscellaneous Services');
        y = drawRow(page16, y, 'eClaims Manager Per Participant, Monthly', '-', effDate);
        y = drawRow(page16, y, 'NueSynergy Smart Mobile App', 'Included', effDate);
        y = drawRow(page16, y, 'Smart Debit Card Setup & Administration Per Participant, Monthly', '-', effDate);
        y -= 10;

        // LSA
        y = drawSectionHeader(page16, y, 'LSA Plans');
        y = drawRow(page16, y, 'LSA Implementation, Design & Installation', findRate('LSA'), effDate);
        y = drawRow(page16, y, 'Per Participant Per Month', findRate('LSA'), effDate, true);
        y -= 10;

        // COBRA
        y = drawSectionHeader(page16, y, 'COBRAcare+ Administration');
        y = drawRow(page16, y, 'Per Benefits Enrolled Employee Per Month', findRate('COBRA'), effDate);
        y = drawRow(page16, y, 'Current COBRA Continuation', '-', effDate, true);
        y = drawRow(page16, y, 'Qualifying Event Notice', '-', effDate, true);

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
        y = drawRow(page17, y, 'Implementation & Setup (YEAR 1)', findRate('Direct'), effDate);
        y = drawRow(page17, y, 'Annual Renewal (AFTER YEAR 1)', '-', effDate, true);
        y = drawRow(page17, y, 'Per Direct Bill Participant Per Month', findRate('Direct'), effDate, true);
        y = drawRow(page17, y, 'Direct Bill Minimum, Monthly', '-', effDate, true);
        y -= 10;

        // POP
        y = drawSectionHeader(page17, y, 'Section 125, Premium Only Plan (POP)');
        y = drawRow(page17, y, 'POP Document (ONE-TIME SETUP FEE)', findRate('POP'), effDate);
        y = drawRow(page17, y, 'Annual Compliance & Renewal (WAIVED 1st YEAR)', '-', effDate, true);
        y -= 10;

        // Files
        y = drawSectionHeader(page17, y, 'File Implementation and Processing');
        y = drawRow(page17, y, 'Enrollment/Eligibility File (New Enrollment and Terminations)', '-', effDate);
        y = drawRow(page17, y, 'Payroll/Contribution File', '-', effDate);
        y = drawRow(page17, y, 'COBRA Initial Notices', '-', effDate);

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

async function sendApprovalEmail(data, opportunityId, apiKey) {
    try {
        const joshCollinsContactId = '357NYkROmrFIMPiAdpUc';
        const productsWithOverride = (data.products || []).filter(p => p.isOverride);

        if (productsWithOverride.length === 0) return;

        const productDetailsHtml = productsWithOverride.map(p => `
            <li>
                <strong>Product:</strong> ${p.product}<br>
                <strong>Override Rate:</strong> $${p.rate}<br>
                <strong>Justification:</strong> ${p.justification || 'No justification provided'}
            </li>
        `).join('');

        const emailBody = `
            <h3>Price Override Approval Request</h3>
            <p>An opportunity has been created that requires your approval due to price overrides.</p>
            <ul>
                <li><strong>Employer:</strong> ${data.name}</li>
                <li><strong>Opportunity Name:</strong> ${data.name}</li>
                <li><strong>Broker:</strong> ${data.contact?.name || 'N/A'}</li>
                <li><strong>Effective Date:</strong> ${data.customFields.find(f => f.key === 'opportunity.effective_date')?.field_value || 'N/A'}</li>
                <li><strong>Yearly Value:</strong> $${data.monetaryValue}</li>
            </ul>
            <h4>Overrides:</h4>
            <ul>
                ${productDetailsHtml}
            </ul>
            <p>Please review this opportunity in GHL: <a href="https://app.gohighlevel.com/v2/location/${data.locationId}/opportunities/list">Opportunity Pipeline</a></p>
        `;

        const payload = {
            type: 'Email',
            contactId: joshCollinsContactId,
            emailFrom: 'sales-intake@nuesynergy.com',
            subject: `Approval Required: Price Override for ${data.name}`,
            html: emailBody,
            message: emailBody.replace(/<[^>]*>?/gm, '') // Plain text fallback
        };

        const response = await axios.post(
            `https://services.leadconnectorhq.com/conversations/messages`,
            payload,
            { headers: getHeaders(apiKey) }
        );

        console.log('Approval email sent to Josh Collins:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error sending approval email:', error.response?.data || error.message);
    }
}

// Routes
app.get('/api/users', async (req, res) => {
    try {
        const apiKey = ghlApiKey.value();
        const locationId = 'NFWWwK7qd0rXqtNyOINy';
        console.log(`[Users API] Requesting users for location: ${locationId}`);

        const response = await axios.get(`https://services.leadconnectorhq.com/users/?locationId=${locationId}`, {
            headers: getHeaders(apiKey)
        });

        const users = response.data.users || response.data;
        console.log(`[Users API] Successfully fetched ${Array.isArray(users) ? users.length : 0} users.`);
        res.json(users);
    } catch (error) {
        console.error('[Users API] Error fetching users:', error.message);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.get('/api/contacts', async (req, res) => {
    try {
        const apiKey = ghlApiKey.value();
        const locationId = 'NFWWwK7qd0rXqtNyOINy';
        const query = req.query.query || '';
        console.log(`[Contacts API] Searching contacts for location: ${locationId}, query: ${query}`);

        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&query=${encodeURIComponent(query)}&limit=50`, {
            headers: getHeaders(apiKey)
        });

        const contacts = response.data.contacts || [];
        console.log(`[Contacts API] Successfully fetched ${contacts.length} contacts.`);
        res.json(contacts);
    } catch (error) {
        console.error('[Contacts API] Error fetching contacts:', error.message);
        res.status(500).json({ error: 'Failed to fetch contacts' });
    }
});

app.post('/api/create-opportunity', async (req, res) => {
    try {
        const apiKey = ghlApiKey.value();
        const headers = getHeaders(apiKey);
        const data = req.body;
        const locationId = data.locationId;

        // Contact Logic
        let contactId = data.contactId;
        if (!contactId && data.contact) {
            try {
                const contactRes = await axios.post('https://services.leadconnectorhq.com/contacts/', {
                    firstName: data.contact.firstName || data.contact.name.split(' ')[0],
                    lastName: data.contact.lastName || data.contact.name.split(' ').slice(1).join(' '),
                    email: data.contact.email,
                    companyName: data.contact.companyName,
                    locationId: locationId,
                    customFields: data.customFields
                }, { headers });
                contactId = contactRes.data.contact.id;
                await logAudit('CREATE', 'Contact', contactId, { name: data.contact.name, email: data.contact.email, company: data.contact.companyName }, req);
            } catch (err) {
                if (err.response && (err.response.status === 400 || err.response.status === 409)) {
                    const searchRes = await axios.get(`https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&query=${data.contact.email}`, { headers });
                    if (searchRes.data.contacts.length > 0) contactId = searchRes.data.contacts[0].id;
                }
                if (!contactId) throw err;
            }
        }

        const oppRes = await axios.post('https://services.leadconnectorhq.com/opportunities/', {
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
        }, { headers });

        const opportunity = oppRes.data.opportunity || oppRes.data;

        await logAudit('CREATE', 'Opportunity', opportunity.id, {
            name: data.name,
            monetaryValue: data.monetaryValue,
            pipelineId: data.pipelineId,
            status: data.status,
            contactId: contactId
        }, req);

        // Dual-Write to Firestore
        try {
            console.log('Saving to Firestore...');
            const firestoreData = {
                employerName: data.contact?.companyName || data.name,
                status: 'new',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                broker: {
                    name: data.contact?.name || `${data.contact?.firstName || ''} ${data.contact?.lastName || ''}`.trim(),
                    email: data.contact?.email,
                    agency: data.brokerAgency || ''
                },
                details: {
                    effectiveDate: data.customFields.find(f => f.key === 'opportunity.effective_date')?.field_value,
                    proposalDate: data.customFields.find(f => f.key === 'opportunity.proposal_date')?.field_value,
                    totalEmployees: parseInt(data.customFields.find(f => f.key === 'opportunity.total_employees')?.field_value || '0'),
                    source: data.source || data.customFields.find(f => f.key === 'opportunity.source')?.field_value,
                    currentAdministrator: data.customFields.find(f => f.key === 'opportunity.current_administrator')?.field_value,
                    benAdminSystem: data.customFields.find(f => f.key === 'opportunity.ben_admin_system')?.field_value
                },
                assignment: {
                    assignedToUser: data.assignedTo
                },
                products: JSON.parse(data.customFields.find(f => f.key === 'opportunity.rfp_products_desired')?.field_value || '[]'),
                financials: {
                    monthlyTotal: parseFloat(data.customFields.find(f => f.key === 'opportunity.monthly_total')?.field_value || '0'),
                    yearlyTotal: parseFloat(data.customFields.find(f => f.key === 'opportunity.yearly_total')?.field_value || '0')
                },
                approval: {
                    requiresApproval: data.customFields.find(f => f.key === 'opportunity.requires_approval')?.field_value === 'Yes',
                    approverName: data.customFields.find(f => f.key === 'opportunity.approver_name')?.field_value
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

        // Automation
        try {
            const fileName = `Proposal_${Date.now()}.pdf`;
            const filePath = path.join(os.tmpdir(), fileName);
            const justifications = (data.products || [])
                .filter(p => p.isOverride && p.justification)
                .map(p => `- ${p.product}: ${p.justification}`)
                .join('\n');

            const pdfData = {
                businessName: data.contact?.companyName,
                effectiveDate: data.customFields.find(f => f.key === 'opportunity.effective_date' || f.key === 'rfp_effective_date')?.field_value,
                proposalDate: data.customFields.find(f => f.key === 'opportunity.proposal_date' || f.key === 'proposal_date')?.field_value,
                products: data.products,
                justifications: justifications
            };
            await createProposalPDF(pdfData, filePath);

            const stats = fs.statSync(filePath);
            const form = new FormData();
            form.append('file', fs.createReadStream(filePath), { filename: fileName, contentType: 'application/pdf', knownLength: stats.size });

            const uploadRes = await axios.post(`https://services.leadconnectorhq.com/locations/${locationId}/custom-files/upload`, form, {
                headers: { ...form.getHeaders(), 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28' }
            });

            await axios.post(`https://services.leadconnectorhq.com/opportunities/${opportunity.id}/notes`, {
                body: `NueSynergy Pricing Proposal generated automatically. [Link to Proposal](${uploadRes.data.url})${justifications ? '\n\n**Price Override Justifications:**\n' + justifications : ''}`
            }, { headers });
        } catch (automationErr) {
            console.error('Automation Failed (PDF):', automationErr.message);
        }

        // Send Approval Email if overrides exist (Independent)
        try {
            if (data.customFields.find(f => f.key === 'opportunity.requires_approval')?.field_value === 'Yes') {
                await sendApprovalEmail(data, opportunity.id, apiKey);
            }
        } catch (emailErr) {
            console.error('Approval Email Failed:', emailErr.message);
        }

        res.json(oppRes.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/generate-pdf', async (req, res) => {
    try {
        const data = req.body;
        const fileName = `Proposal_${Date.now()}.pdf`;
        const filePath = path.join(os.tmpdir(), fileName);
        await createProposalPDF(data, filePath);
        res.download(filePath, fileName);
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

app.get('/api/opportunities', async (req, res) => {
    try {
        const snapshot = await admin.firestore().collection('opportunities')
            .orderBy('createdAt', 'desc')
            .get();

        const opportunities = [];
        snapshot.forEach(doc => {
            opportunities.push({ id: doc.id, ...doc.data() });
        });

        res.json(opportunities);
    } catch (error) {
        console.error('[Opportunities API] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch opportunities' });
    }
});

app.get('/api/audit-logs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const startAfter = req.query.startAfter;

        let query = admin.firestore().collection('audit_logs')
            .orderBy('timestamp', 'desc')
            .limit(limit);

        if (startAfter) {
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

        res.json(logs);
    } catch (error) {
        console.error('[Audit Logs API] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

exports.api = onRequest({ secrets: [ghlApiKey] }, app);
