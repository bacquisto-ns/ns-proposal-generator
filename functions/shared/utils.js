const sanitizeString = (str, maxLength = 500) => {
    if (typeof str !== 'string') return '';
    // Use a more robust character map for escaping instead of simple removal
    return str
        .slice(0, maxLength)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .trim();
};

const sanitizeEmail = (email) => {
    if (typeof email !== 'string') return '';
    const sanitized = email.toLowerCase().trim().slice(0, 254);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(sanitized) ? sanitized : '';
};

const sanitizeNumber = (val, defaultVal = 0) => {
    const num = parseFloat(val);
    return isNaN(num) ? defaultVal : num;
};

const getGHLHeaders = (apiKey) => {
    if (!apiKey || !apiKey.trim()) {
        throw new Error('GHL_API_KEY is not configured.');
    }
    return {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
    };
};

module.exports = {
    sanitizeString,
    sanitizeEmail,
    sanitizeNumber,
    getGHLHeaders
};
