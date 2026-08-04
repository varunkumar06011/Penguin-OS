let ventureAnalysisData = null;
let ventureAnalysisExpanded = {};

function openVentureAnalysisPanel() {
    hideAllMainPanels();
    var panel = document.getElementById('ventureAnalysisPanel');
    if (panel) panel.style.display = '';
    renderVentureAnalysis();
    navigateTo('#/venture-analysis');
}

async function renderVentureAnalysis() {
    const container = document.getElementById('ventureAnalysisContent');
    if (!container) return;
    container.innerHTML = '<div style="padding:24px;color:#888;text-align:center;">Loading venture analysis...</div>';

    try {
        const data = await apiGet('/api/venture-analysis');
        ventureAnalysisData = data;
        renderVentureAnalysisContent(container, data);
    } catch (err) {
        console.error('Failed to load venture analysis:', err);
        container.innerHTML = '<div style="padding:24px;color:#c0392b;text-align:center;">Failed to load venture analysis. Please try again.</div>';
    }
}

function renderVentureAnalysisContent(container, data) {
    const ventures = data.ventures || [];
    if (ventures.length === 0) {
        container.innerHTML = '<div style="padding:24px;color:#888;text-align:center;">No ventures found.</div>';
        return;
    }

    let html = '<div class="va-container">';

    // Summary cards
    const totalDone = ventures.reduce((s, v) => s + v.work_done, 0);
    const totalPending = ventures.reduce((s, v) => s + v.work_pending, 0);
    const totalInvQty = ventures.reduce((s, v) => s + v.inventory_used_qty, 0);
    const totalInvCost = ventures.reduce((s, v) => s + v.inventory_used_cost, 0);

    html += '<div class="va-summary-grid">';
    html += summaryCard('Work Done (Tasks)', totalDone.toLocaleString('en-IN'), '#27ae60');
    html += summaryCard('Work Pending (Tasks)', totalPending.toLocaleString('en-IN'), '#e74c3c');
    html += summaryCard('Inventory Used (Qty)', totalInvQty.toLocaleString('en-IN', { maximumFractionDigits: 2 }), '#f39c12');
    html += summaryCard('Inventory Used Cost', '\u20B9' + totalInvCost.toLocaleString('en-IN', { maximumFractionDigits: 2 }), '#3498db');
    html += '</div>';

    // Venture cards
    ventures.forEach(v => {
        const expanded = ventureAnalysisExpanded[v.venture_id];
        const sb = v.status_breakdown;
        const donePct = v.work_pct;
        const barColor = donePct >= 75 ? '#27ae60' : donePct >= 40 ? '#f39c12' : donePct > 0 ? '#3498db' : '#e74c3c';

        html += '<div class="va-card">';
        html += '<div class="va-card-header" onclick="toggleVentureAnalysis(\'' + v.venture_id + '\')">';
        html += '<div class="va-card-top">';
        html += '<div><h3 class="va-card-title">' + escapeHtml(v.venture_name) + '</h3>';
        html += '<span class="va-card-subtitle">' + v.work_done + ' / ' + v.work_total + ' tasks done (' + donePct + '%)</span></div>';
        html += '<div class="va-card-stats">';
        html += '<span class="va-stat va-stat-done"><strong>' + v.work_done + '</strong> Done</span>';
        html += '<span class="va-stat va-stat-pending"><strong>' + v.work_pending + '</strong> Pending</span>';
        html += '<span class="va-stat va-stat-qty"><strong>' + v.inventory_used_qty.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + '</strong> Qty Used</span>';
        if (v.inventory_used_cost > 0) {
            html += '<span class="va-stat va-stat-cost"><strong>\u20B9' + v.inventory_used_cost.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + '</strong> Cost</span>';
        }
        html += '</div></div>';

        // Progress bar
        html += '<div class="va-progress-bar"><div class="va-progress-fill" style="width:' + donePct + '%;background:' + barColor + ';"></div></div>';

        // Status breakdown badges
        html += '<div class="va-badges">';
        if (sb.green > 0) html += '<span class="va-badge va-badge-done">Done: ' + sb.green + '</span>';
        if (sb.yellow > 0) html += '<span class="va-badge va-badge-progress">In Progress: ' + sb.yellow + '</span>';
        if (sb.blue > 0) html += '<span class="va-badge va-badge-patch">Patch Work: ' + sb.blue + '</span>';
        if (sb.red > 0) html += '<span class="va-badge va-badge-pending">Pending: ' + sb.red + '</span>';
        html += '</div>';
        html += '</div>';

        // Expanded section
        if (expanded) {
            html += '<div class="va-expanded">';

            // Top materials used
            if (v.top_materials && v.top_materials.length > 0) {
                html += '<h4 class="va-section-title">Materials Used in This Venture</h4>';
                html += '<div class="va-table-wrap"><table class="va-table"><thead><tr><th>Material</th><th>Qty</th><th>Unit</th><th>Cost (\u20B9)</th></tr></thead><tbody>';
                v.top_materials.forEach(m => {
                    html += '<tr><td data-label="Material">' + escapeHtml(m.name) + '</td><td data-label="Qty">' + m.qty + '</td><td data-label="Unit">' + escapeHtml(m.unit || '') + '</td><td data-label="Cost">' + (m.cost > 0 ? m.cost.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-') + '</td></tr>';
                });
                html += '</tbody></table></div>';
            } else {
                html += '<div class="va-empty">No inventory usage recorded for this venture yet.</div>';
            }

            // Flat-wise usage
            if (v.flat_usage && v.flat_usage.length > 0) {
                html += '<h4 class="va-section-title">Flat-wise Usage</h4>';
                html += '<div class="va-table-wrap"><table class="va-table"><thead><tr><th>Flat No</th><th>Total Qty</th><th>Cost (\u20B9)</th><th>Top Materials</th></tr></thead><tbody>';
                v.flat_usage.forEach(f => {
                    const matStr = f.materials.map(m => m.name + ' (' + m.qty + ')').join(', ');
                    html += '<tr><td data-label="Flat No"><strong>' + escapeHtml(f.flat) + '</strong></td><td data-label="Total Qty">' + f.qty + '</td><td data-label="Cost">' + (f.cost > 0 ? f.cost.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-') + '</td><td data-label="Top Materials" class="va-cell-materials">' + escapeHtml(matStr) + '</td></tr>';
                });
                html += '</tbody></table></div>';
            }

            html += '</div>';
        }

        html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

function summaryCard(label, value, color) {
    return '<div class="va-summary-card">' +
        '<div class="va-summary-value" style="color:' + color + ';">' + value + '</div>' +
        '<div class="va-summary-label">' + label + '</div></div>';
}

function toggleVentureAnalysis(ventureId) {
    ventureAnalysisExpanded[ventureId] = !ventureAnalysisExpanded[ventureId];
    if (ventureAnalysisData) {
        const container = document.getElementById('ventureAnalysisContent');
        renderVentureAnalysisContent(container, ventureAnalysisData);
    }
}

document.getElementById('backFromVentureAnalysis').addEventListener('click', () => {
    navigateTo('#/ventures');
});
