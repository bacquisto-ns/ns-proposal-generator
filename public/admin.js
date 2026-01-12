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
            const formatDateObj = (d) => {
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                const year = d.getFullYear();
                return `${month}-${day}-${year}`;
            };

            if (opp.createdAt && opp.createdAt._seconds) {
                dateStr = formatDateObj(new Date(opp.createdAt._seconds * 1000));
            } else if (opp.createdAt) {
                dateStr = formatDateObj(new Date(opp.createdAt));
            }

            // Product Summary
            const products = (opp.products || []).map(p => p.name).join(', ');

            // Status Badge
            const statusClass = opp.status === 'new' ? 'badge-new' : 'badge-default';

            tr.innerHTML = `
                <td>${dateStr}</td>
                <td><strong>${opp.employerName || 'N/A'}</strong></td>
                <td>${opp.details?.effectiveDate || '-'}</td>
                <td>${opp.details?.proposalDate || '-'}</td>
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

    // Get Filters
    const action = document.getElementById('filterAction').value;
    const status = document.getElementById('filterStatus').value;
    const resourceId = document.getElementById('filterResourceId').value;

    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading audit logs...</td></tr>';

    try {
        let url = `/api/audit-logs?limit=${ITEMS_PER_PAGE}`;
        if (action) url += `&action=${action}`;
        if (status) url += `&status=${status}`;
        if (resourceId) url += `&resourceId=${resourceId}`;

        if (direction === 'next' && lastAuditDoc) {
            url += `&startAfter=${lastAuditDoc}`;
            currentPage++;
        } else if (direction === 'first') {
            currentPage = 1;
            lastAuditDoc = null;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch data');

        const data = await response.json();

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">No logs found matching criteria.</td></tr>';
            nextBtn.disabled = true;
            if (currentPage > 1) currentPage--; // Revert
            return;
        }

        // Update cursor
        lastAuditDoc = data[data.length - 1].timestamp?._seconds || data[data.length - 1].id;

        // Helper for consistent formatting
        const formatDateTime = (d) => {
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const year = d.getFullYear();
            const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `${month}-${day}-${year} ${time}`;
        };

        // Render
        tbody.innerHTML = '';
        data.forEach(log => {
            const tr = document.createElement('tr');

            let dateStr = 'N/A';
            if (log.timestamp && log.timestamp._seconds) {
                dateStr = formatDateTime(new Date(log.timestamp._seconds * 1000));
            } else if (log.timestamp) {
                dateStr = formatDateTime(new Date(log.timestamp));
            }

            let actionClass = 'text-muted';
            if (log.action === 'CREATE') actionClass = 'text-success';
            if (log.action === 'UPDATE') actionClass = 'text-primary';
            if (log.action === 'DELETE') actionClass = 'text-danger';

            let statusClass = 'badge-default';
            if (log.status === 'SUCCESS') statusClass = 'badge-new';
            if (log.status === 'FAILURE') statusClass = 'badge-danger';

            const actorName = log.actor?.name || log.metadata?.ip || 'System';
            const detailsJson = JSON.stringify(log.details, null, 2);

            tr.innerHTML = `
                <td>${dateStr}</td>
                <td><span class="badge ${statusClass}">${log.status || 'SUCCESS'}</span></td>
                <td><strong>${actorName}</strong></td>
                <td><span class="${actionClass}" style="font-weight:bold;">${log.action}</span></td>
                <td>${log.resourceType || 'N/A'}</td>
                <td><small>${log.resourceId || 'N/A'}</small></td>
                <td><button class="view-payload-btn" data-details='${detailsJson.replace(/'/g, "&apos;")}'>View Details</button></td>
            `;
            tbody.appendChild(tr);
        });

        // Add event listeners to buttons
        document.querySelectorAll('.view-payload-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const details = btn.getAttribute('data-details');
                document.getElementById('modalJson').textContent = details;
                document.getElementById('detailsModal').style.display = 'block';
            });
        });

        // Update UI
        pageInfo.innerText = `Page ${currentPage}`;
        prevBtn.disabled = currentPage === 1;
        nextBtn.disabled = data.length < ITEMS_PER_PAGE;

    } catch (error) {
        console.error('Error loading audit logs:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error loading audit logs. Check console.</td></tr>';
    }
}

function exportToCSV() {
    // Basic CSV export of currently visible data (or fetch all - for now, simple)
    // To implement "True Export", we should hit an API endpoint that streams all data. 
    // For this prototype, I'll fetch the first 1000 logs matching filters.
    const action = document.getElementById('filterAction').value;
    const status = document.getElementById('filterStatus').value;
    const resourceId = document.getElementById('filterResourceId').value;

    let url = `/api/audit-logs?limit=1000`;
    if (action) url += `&action=${action}`;
    if (status) url += `&status=${status}`;
    if (resourceId) url += `&resourceId=${resourceId}`;

    fetch(url).then(res => res.json()).then(data => {
        if (!data || data.length === 0) {
            alert('No data to export');
            return;
        }

        const headers = ['Timestamp', 'Status', 'Actor', 'Action', 'Resource Type', 'Resource ID', 'Details'];
        const rows = data.map(log => {
            let dateStr = '';
            if (log.timestamp && log.timestamp._seconds) {
                dateStr = new Date(log.timestamp._seconds * 1000).toISOString();
            }
            
            // Escape CSV fields
            const clean = (text) => `"${String(text || '').replace(/"/g, '""')}"`;
            
            return [
                clean(dateStr),
                clean(log.status || 'SUCCESS'),
                clean(log.actor?.name || 'System'),
                clean(log.action),
                clean(log.resourceType),
                clean(log.resourceId),
                clean(JSON.stringify(log.details))
            ].join(',');
        });

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `audit_logs_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }).catch(err => {
        console.error('Export failed:', err);
        alert('Export failed');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    loadOpportunities();

    // Filter Buttons
    document.getElementById('applyFiltersBtn')?.addEventListener('click', () => loadAuditLogs('first'));
    document.getElementById('exportCsvBtn')?.addEventListener('click', exportToCSV);

    // Modal close logic
    const modal = document.getElementById('detailsModal');
    const closeBtn = document.querySelector('.close-modal');
    if (closeBtn) {
        closeBtn.onclick = () => modal.style.display = 'none';
    }
    window.onclick = (event) => {
        if (event.target == modal) modal.style.display = 'none';
    };

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
