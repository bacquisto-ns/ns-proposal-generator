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

const emailBody = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0;">
        <div style="max-width: 600px; margin: 20px auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <div style="background-color: #003366; color: white; padding: 25px; text-align: center;">
                <h2 style="margin: 0; font-weight: 300; letter-spacing: 1px;">APPROVAL REQUIRED</h2>
            </div>
            <div style="padding: 30px;">
                <p style="font-size: 16px;">An opportunity has been created that requires your approval due to price overrides.</p>
                
                <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 25px;">
                    <h4 style="margin-top: 0; color: #003366; border-bottom: 2px solid #80B040; display: inline-block; padding-bottom: 5px;">Proposal Details</h4>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        <tr><td style="padding: 5px 0; width: 140px;"><strong>Employer:</strong></td><td>${data.contact?.companyName || data.name}</td></tr>
                        <tr><td style="padding: 5px 0;"><strong>Broker:</strong></td><td>${data.contact?.name || 'N/A'}</td></tr>
                        <tr><td style="padding: 5px 0;"><strong>Effective Date:</strong></td><td>${data.customFields.find(f => f.key === 'opportunity.effective_date')?.field_value || 'N/A'}</td></tr>
                        <tr><td style="padding: 5px 0;"><strong>Yearly Value:</strong></td><td>$${data.monetaryValue}</td></tr>
                    </table>
                </div>

                <h4 style="color: #003366; margin-bottom: 10px;">Product Overrides</h4>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px; border: 1px solid #eee;">
                    <thead style="background-color: #f1f5f9;">
                        <tr>
                            <th style="padding: 12px 10px; text-align: left; border-bottom: 2px solid #ddd;">Product</th>
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

require('fs').writeFileSync('email_preview.html', emailBody);
console.log('Email preview generated: email_preview.html');
