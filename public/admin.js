async function loadOpportunities() {
    const tbody = document.getElementById('adminBody');
    try {
        const response = await fetch('/api/opportunities');
        if (!response.ok) throw new Error('Failed to fetch data');

        const data = await response.json();

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center">No opportunities found.</td></tr>';
            return;
        }

        tbody.innerHTML = '';

        data.forEach(opp => {
            const tr = document.createElement('tr');

            // Date Formatting
            let dateStr = 'N/A';
            if (opp.createdAt && opp.createdAt._seconds) {
                dateStr = new Date(opp.createdAt._seconds * 1000).toLocaleDateString();
            } else if (opp.createdAt) {
                dateStr = new Date(opp.createdAt).toLocaleDateString();
            }

            // Product Summary
            const products = (opp.products || []).map(p => p.name).join(', ');

            // Status Badge
            const statusClass = opp.status === 'new' ? 'badge-new' : 'badge-default';

            tr.innerHTML = `
                <td>${dateStr}</td>
                <td><strong>${opp.employerName || 'N/A'}</strong></td>
                <td>
                    ${opp.broker?.name || 'N/A'}<br>
                    <small class="text-muted">${opp.broker?.agency || ''}</small>
                </td>
                <td><small>${products}</small></td>
                <td>${opp.details?.totalEmployees || 0}</td>
                <td>$${(opp.financials?.yearlyTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td><span class="badge ${statusClass}">${opp.status || 'new'}</span></td>
                <td>
                    ${opp.ghl?.opportunityId ? `<span class="text-success">Synced</span>` : '<span class="text-danger">Failed</span>'}
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (error) {
        console.error('Error loading admin data:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Error loading data. Check console.</td></tr>';
    }
}

let lastAuditDoc = null;
let auditLogsCache = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 20;

async function loadAuditLogs(direction = 'first') {
    const tbody = document.getElementById('auditBody');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');

    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading audit logs...</td></tr>';

    try {
        let url = `/api/audit-logs?limit=${ITEMS_PER_PAGE}`;
        if (direction === 'next' && lastAuditDoc) {
            url += `&startAfter=${lastAuditDoc}`;
            currentPage++;
        } else if (direction === 'first') {
            currentPage = 1;
            lastAuditDoc = null;
        }
        // Note: Simple 'prev' logic isn't easily supported with Firestore cursor without tracking history.
        // For this simple implementation, we'll reset on 'prev' if we don't have a history stack, or just support Next/Reset.
        // To properly support Previous, we'd need to cache pages or use offsets (expensive).
        // Let's implement a "Reset/First" and "Next" for now, or use a simple client-side array if generic.
        // User requested pagination "when applicable". Let's try server-side cursor.

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch data');

        const data = await response.json();

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">No more audit logs found.</td></tr>';
            nextBtn.disabled = true;
            if (currentPage > 1) currentPage--; // Revert
            return;
        }

        // Update cursor
        lastAuditDoc = data[data.length - 1].timestamp?._seconds || data[data.length - 1].id;

        // Render
        tbody.innerHTML = '';
        data.forEach(log => {
            const tr = document.createElement('tr');

            let dateStr = 'N/A';
            if (log.timestamp && log.timestamp._seconds) {
                dateStr = new Date(log.timestamp._seconds * 1000).toLocaleString();
            } else if (log.timestamp) {
                dateStr = new Date(log.timestamp).toLocaleString();
            }

            let actionClass = 'text-muted';
            if (log.action === 'CREATE') actionClass = 'text-success';
            if (log.action === 'UPDATE') actionClass = 'text-primary';
            if (log.action === 'DELETE') actionClass = 'text-danger';

            const detailsJson = JSON.stringify(log.details, null, 2);

            tr.innerHTML = `
                <td>${dateStr}</td>
                <td><span class="${actionClass}" style="font-weight:bold;">${log.action}</span></td>
                <td>${log.resourceType || 'N/A'}</td>
                <td><small>${log.resourceId || 'N/A'}</small></td>
                <td><pre>${detailsJson}</pre></td>
                <td>${log.metadata?.ip || 'N/A'}</td>
            `;
            tbody.appendChild(tr);
        });

        // Update UI
        pageInfo.innerText = `Page ${currentPage}`;
        prevBtn.disabled = currentPage === 1;
        nextBtn.disabled = data.length < ITEMS_PER_PAGE;

    } catch (error) {
        console.error('Error loading audit logs:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error loading audit logs. Check console.</td></tr>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadOpportunities();

    // Tab Logic
    const tabs = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.view-section');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (prevBtn) prevBtn.addEventListener('click', () => loadAuditLogs('first')); // Reset for now as simple prev is hard
    if (nextBtn) nextBtn.addEventListener('click', () => loadAuditLogs('next'));

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            views.forEach(v => v.style.display = 'none');
            const selectedTab = tab.getAttribute('data-tab');
            if (selectedTab === 'opportunities') {
                document.getElementById('opportunitiesView').style.display = 'flex'; // Changed to flex for full height
                loadOpportunities();
            } else if (selectedTab === 'auditLogs') {
                document.getElementById('auditLogsView').style.display = 'flex'; // Changed to flex for full height
                loadAuditLogs('first');
            }
        });
    });
});
