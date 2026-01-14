const axios = require('axios');
require('dotenv').config();

const GHL_API_KEY = process.env.GHL_API_KEY;
if (!GHL_API_KEY) {
    console.error('ERROR: GHL_API_KEY environment variable is required');
    process.exit(1);
}
const locationId = 'NFWWwK7qd0rXqtNyOINy';

const REQUIRED_FIELDS = [
    { name: 'Total Employees', dataType: 'NUMERICAL', fieldKey: 'opportunity.total_employees' },
    { name: 'Opportunity Source', dataType: 'TEXT', fieldKey: 'opportunity.source' },
    { name: 'Current Administrator', dataType: 'TEXT', fieldKey: 'opportunity.current_administrator' },
    { name: 'Ben Admin System', dataType: 'TEXT', fieldKey: 'opportunity.ben_admin_system' },
    { name: 'Monthly Total', dataType: 'NUMERICAL', fieldKey: 'opportunity.monthly_total' },
    { name: 'Yearly Total', dataType: 'NUMERICAL', fieldKey: 'opportunity.yearly_total' },
    { name: 'Requires Approval', dataType: 'TEXT', fieldKey: 'opportunity.requires_approval' },
    { name: 'Approver Name', dataType: 'TEXT', fieldKey: 'opportunity.approver_name' }
];

async function ensureFields() {
    try {
        console.log('Checking existing fields...');
        const existingRes = await axios.get(`https://services.leadconnectorhq.com/locations/${locationId}/customFields?model=opportunity`, {
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28'
            }
        });

        const existingKeys = existingRes.data.customFields.map(f => f.fieldKey);
        console.log('Existing keys:', existingKeys);

        for (const field of REQUIRED_FIELDS) {
            if (existingKeys.includes(field.fieldKey)) {
                console.log(`Field ${field.fieldKey} already exists.`);
                continue;
            }

            console.log(`Creating field: ${field.name} (${field.fieldKey})...`);
            try {
                await axios.post(`https://services.leadconnectorhq.com/locations/${locationId}/customFields`, {
                    name: field.name,
                    dataType: field.dataType,
                    model: 'opportunity',
                    placeholder: field.name
                }, {
                    headers: {
                        'Authorization': `Bearer ${GHL_API_KEY}`,
                        'Version': '2021-07-28',
                        'Content-Type': 'application/json'
                    }
                });
                console.log(`Successfully created ${field.fieldKey}`);
            } catch (err) {
                console.error(`Failed to create ${field.fieldKey}:`, err.response ? JSON.stringify(err.response.data) : err.message);
            }
        }
    } catch (error) {
        console.error('Error in ensureFields:', error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

ensureFields();
