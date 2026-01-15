// HTML escape helper to prevent XSS
const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// --- Dashboard & Visualizations ---
let oppGrid;
let charts = {};

async function loadDashboard() {
    try {
        const response = await fetch('/api/opportunities');
        if (!response.ok) throw new Error('Failed to fetch data');
        const data = await response.json();

        // 1. Render Charts
        renderCharts(data);

        // 2. Initialize/Update Grid
        initOpportunityGrid(data);

    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

function renderCharts(data) {
    // Process Data for Charts
    const statusCounts = {};
    const monthlyCounts = {};

    data.forEach(opp => {
        // Status Distribution
        const status = opp.status || 'unknown';
        statusCounts[status] = (statusCounts[status] || 0) + 1;

        // Monthly Trend
        const date = opp.createdAt && opp.createdAt._seconds
            ? new Date(opp.createdAt._seconds * 1000)
            : new Date(opp.createdAt);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyCounts[monthKey] = (monthlyCounts[monthKey] || 0) + 1;
    });

    // --- Status Chart (Doughnut) ---
    const statusCtx = document.getElementById('statusChart').getContext('2d');
    if (charts.status) charts.status.destroy();

    charts.status = new Chart(statusCtx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(statusCounts).map(s => s.toUpperCase()),
            datasets: [{
                data: Object.values(statusCounts),
                backgroundColor: ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b'],
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });

    // --- Trend Chart (Bar) ---
    const trendCtx = document.getElementById('trendChart').getContext('2d');
    if (charts.trend) charts.trend.destroy();

    const sortedMonths = Object.keys(monthlyCounts).sort();

    charts.trend = new Chart(trendCtx, {
        type: 'bar',
        data: {
            labels: sortedMonths,
            datasets: [{
                label: 'New Opportunities',
                data: sortedMonths.map(m => monthlyCounts[m]),
                backgroundColor: '#80B040',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });
}

function initOpportunityGrid(data) {
    const gridContainer = document.getElementById('oppGrid');
    if (gridContainer.innerHTML !== '') return; // Already initialized (or update logic if needed)

    // Helper to format date
    const formatDate = (cell) => {
        if (!cell) return '-';
        const d = cell._seconds ? new Date(cell._seconds * 1000) : new Date(cell);
        return d.toLocaleDateString();
    }

    oppGrid = new gridjs.Grid({
        columns: [
            { name: 'Date', formatter: (cell) => formatDate(cell) },
            { name: 'Employer', formatter: (cell) => gridjs.html(`<strong>${escapeHtml(cell)}</strong>`) },
            'Effective',
            'Broker',
            { name: 'Products', width: '200px', formatter: (cell) => gridjs.html(`<small>${escapeHtml(cell)}</small>`) },
            { name: 'Employees', width: '100px' },
            { name: 'Yearly Total', formatter: (cell) => `$${parseFloat(cell || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
            {
                name: 'Status',
                formatter: (cell) => {
                    const cls = cell === 'new' ? 'badge-new' : 'badge-default';
                    return gridjs.html(`<span class="badge ${cls}">${escapeHtml(cell)}</span>`);
                }
            },
            {
                name: 'GHL',
                formatter: (cell) => cell ? gridjs.html('<span class="text-success">Synced</span>') : gridjs.html('<span class="text-danger">Failed</span>')
            }
        ],
        data: data.map(opp => [
            opp.createdAt,
            opp.employerName || 'N/A',
            opp.details?.effectiveDate || '-',
            opp.broker?.name || 'N/A',
            (opp.products || []).map(p => p.name).join(', '),
            opp.details?.totalEmployees || 0,
            opp.financials?.yearlyTotal || 0,
            opp.status || 'new',
            opp.ghl?.opportunityId
        ]),
        search: true,
        sort: true,
        pagination: {
            enabled: true,
            limit: 10
        },
        style: {
            table: { 'font-size': '14px' },
            th: { 'background-color': '#f8f9fc', 'color': '#858796' }
        },
        className: {
            table: 'table table-bordered'
        }
    }).render(gridContainer);
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
                <td>${escapeHtml(dateStr)}</td>
                <td><span class="badge ${statusClass}">${escapeHtml(log.status || 'SUCCESS')}</span></td>
                <td><strong>${escapeHtml(actorName)}</strong></td>
                <td><span class="${actionClass}" style="font-weight:bold;">${escapeHtml(log.action)}</span></td>
                <td>${escapeHtml(log.resourceType || 'N/A')}</td>
                <td><small>${escapeHtml(log.resourceId || 'N/A')}</small></td>
                <td><button class="view-payload-btn" data-details='${escapeHtml(detailsJson)}'>View Details</button></td>
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

            // Escape CSV fields and prevent CSV injection
            const clean = (text) => {
                let str = String(text || '').replace(/"/g, '""');
                // Prefix with single quote if starts with formula characters
                if (/^[=+\-@\t\r]/.test(str)) {
                    str = "'" + str;
                }
                return `"${str}"`;
            };

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
        link.setAttribute("download", `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }).catch(err => {
        console.error('Export failed:', err);
        alert('Export failed');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Initial Load
    loadDashboard();

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
            const view = document.getElementById(`${selectedTab}View`);
            if (view) view.style.display = 'flex';

            if (selectedTab === 'dashboard') {
                // Refresh Dashboard
                loadDashboard();
            } else if (selectedTab === 'opportunities') {
                // Grid is already loaded by loadDashboard, just showing the view
            } else if (selectedTab === 'auditLogs') {
                loadAuditLogs('first');
            }
        });
    });
});
