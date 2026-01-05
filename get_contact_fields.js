const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const GHL_API_KEY = process.env.GHL_API_KEY || 'pit-8f3b0ca9-680b-4a08-b639-c43969eabe05';
const locationId = 'NFWWwK7qd0rXqtNyOINy';

async function getCustomFields() {
    try {
        const response = await axios.get(`https://services.leadconnectorhq.com/locations/${locationId}/customFields?model=contact`, {
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Content-Type': 'application/json'
            }
        });

        fs.writeFileSync('contact_custom_fields.json', JSON.stringify(response.data, null, 2));
        console.log(`Fetched ${response.data.customFields.length} contact custom fields.`);
    } catch (error) {
        console.error('Error fetching custom fields:', error.response ? JSON.stringify(error.response.data) : error.message);
    }
}

getCustomFields();
