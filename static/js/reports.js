// ========================
// Reports Panel Renderer
// ========================

function renderReportsPanel() {
    const container = document.getElementById('reportsPanelContent');
    if (!container) return;
    container.innerHTML = '';

    const v = currentVenture;
    if (!v) {
        container.innerHTML = '<div style="padding:24px;color:#888;">Please select a venture from the dashboard.</div>';
        return;
    }

    if (!currentBlockObj || !v.blocks.find(b => b.id === currentBlockObj.id)) {
        currentBlockObj = v.blocks && v.blocks[0] ? v.blocks[0] : { id: 'A', floors: 5 };
    }
    currentBlock = currentBlockObj.id;
    homeQuickReportFloor = currentFloor || 1;
    homeQuickReportFlat = 'all';

    const header = document.createElement('div');
    header.className = 'pending-filter-bar';
    header.style.marginBottom = '16px';
    header.innerHTML = `
        <div class="pending-filter-group"><label>Venture</label><div class="pending-readonly">${escapeHtml(v.name)}</div></div>
        <div class="pending-filter-group"><label>Block</label><select id="reportBlockSelect" class="pending-filter-group-select"></select></div>
        <div class="pending-filter-group"><label>Floor</label><select id="reportFloorSelect" class="pending-filter-group-select"></select></div>
        <div class="pending-filter-group"><label>Flat</label><select id="reportFlatSelect" class="pending-filter-group-select"></select></div>
    `;
    container.appendChild(header);

    populateReportBlockSelect();
    populateReportFloorSelect();
    populateReportFlatSelect();

    document.getElementById('reportBlockSelect').addEventListener('change', () => {
        currentBlockObj = v.blocks.find(b => b.id === document.getElementById('reportBlockSelect').value) || v.blocks[0];
        currentBlock = currentBlockObj.id;
        homeQuickReportFloor = 1;
        homeQuickReportFlat = 'all';
        populateReportFloorSelect();
        populateReportFlatSelect();
        regenerateReports();
    });

    document.getElementById('reportFloorSelect').addEventListener('change', () => {
        homeQuickReportFloor = parseInt(document.getElementById('reportFloorSelect').value) || 1;
        homeQuickReportFlat = 'all';
        populateReportFlatSelect();
        regenerateReports();
    });

    document.getElementById('reportFlatSelect').addEventListener('change', () => {
        homeQuickReportFlat = document.getElementById('reportFlatSelect').value;
        regenerateReports();
    });

    const reportContainer = document.createElement('div');
    reportContainer.id = 'reportsChartContainer';
    reportContainer.className = 'grid-container';
    container.appendChild(reportContainer);

    renderHomeReports(reportContainer);
}

function populateReportBlockSelect() {
    const select = document.getElementById('reportBlockSelect');
    if (!select || !currentVenture) return;
    select.innerHTML = '';
    currentVenture.blocks.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name || b.id;
        select.appendChild(opt);
    });
    select.value = currentBlockObj.id;
}

function populateReportFloorSelect() {
    const select = document.getElementById('reportFloorSelect');
    if (!select || !currentBlockObj) return;
    const floors = currentBlockObj.floors || 5;
    const floorLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
    select.innerHTML = '';
    for (let i = 1; i <= floors; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = floorLabels[i - 1] || `${i}th`;
        select.appendChild(opt);
    }
    select.value = String(homeQuickReportFloor);
}

function populateReportFlatSelect() {
    const select = document.getElementById('reportFlatSelect');
    if (!select || !currentBlockObj) return;
    const flatsPerFloor = currentBlockObj.flats_per_floor || FLATS_PER_FLOOR;
    select.innerHTML = '<option value="all">All Flats</option>';
    for (let i = 1; i <= flatsPerFloor; i++) {
        const flatNum = (homeQuickReportFloor * 100) + i;
        const opt = document.createElement('option');
        opt.value = flatNum;
        opt.textContent = flatNum;
        select.appendChild(opt);
    }
    select.value = String(homeQuickReportFlat);
}

function regenerateReports() {
    const container = document.getElementById('reportsChartContainer');
    if (!container) return;
    container.innerHTML = '';
    renderHomeReports(container);
}

// ========================
// Instant Reports Renderer
// ========================

async function renderInstantReports() {
    const container = document.getElementById('instantReportsContent');
    if (!container) return;
    container.innerHTML = '<div style="padding:24px;color:#888;">Loading instant reports...</div>';

    const ventureSelect = document.createElement('select');
    ventureSelect.className = 'pending-filter-group-select';
    ventureSelect.style.cssText = 'padding:8px 12px;border:1px solid #ccc;border-radius:6px;font-size:0.9rem;margin:16px 24px;';
    ventureSelect.innerHTML = '<option value="">-- Select Venture --</option>';
    venturesList.forEach(v => {
        ventureSelect.innerHTML += `<option value="${v.id}">${v.name}</option>`;
    });
    container.innerHTML = '';
    container.appendChild(ventureSelect);

    const outputDiv = document.createElement('div');
    outputDiv.style.cssText = 'padding:0 24px;';
    container.appendChild(outputDiv);

    ventureSelect.addEventListener('change', async () => {
        const vid = ventureSelect.value;
        if (!vid) { outputDiv.innerHTML = ''; return; }
        outputDiv.innerHTML = '<div style="padding:24px;color:#888;">Loading...</div>';
        try {
            const data = await apiGet(`/api/reports/instant?venture_id=${encodeURIComponent(vid)}`);
            let html = '<div style="display:flex;gap:24px;flex-wrap:wrap;padding:16px 0;">';

            // Spend summary
            html += '<div style="flex:1;min-width:200px;background:#fff;border:1px solid #e0e4e8;border-radius:8px;padding:16px;">';
            html += '<h4 style="margin:0 0 12px 0;font-size:0.9rem;">Total Spend</h4>';
            html += `<div style="font-size:1.4rem;font-weight:700;">&#8377; ${(data.spend.invoices + data.spend.purchase_orders).toLocaleString('en-IN')}</div>`;
            html += `<div style="font-size:0.8rem;color:#888;margin-top:4px;">Invoices: &#8377; ${data.spend.invoices.toLocaleString('en-IN')} | POs: &#8377; ${data.spend.purchase_orders.toLocaleString('en-IN')}</div>`;
            html += '</div>';

            // Block completion
            if (data.blocks.length > 0) {
                html += '<div style="flex:2;min-width:300px;background:#fff;border:1px solid #e0e4e8;border-radius:8px;padding:16px;">';
                html += '<h4 style="margin:0 0 12px 0;font-size:0.9rem;">Block Completion</h4>';
                html += '<table class="tracker-table" style="font-size:0.85rem;"><thead><tr><th>Block</th><th>Floor</th><th>Total</th><th>Done</th><th>%</th></tr></thead><tbody>';
                data.blocks.forEach(b => {
                    html += `<tr><td>${b.block}</td><td>${b.floor}</td><td>${b.total}</td><td>${b.completed}</td><td>${b.pct_complete}%</td></tr>`;
                });
                html += '</tbody></table></div>';
            }

            // Consumption
            if (data.consumption.length > 0) {
                html += '<div style="flex:1;min-width:200px;background:#fff;border:1px solid #e0e4e8;border-radius:8px;padding:16px;">';
                html += '<h4 style="margin:0 0 12px 0;font-size:0.9rem;">Material Consumption</h4>';
                data.consumption.forEach(c => {
                    html += `<div style="font-size:0.8rem;padding:4px 0;">${c.material_id}: ${c.total_qty}</div>`;
                });
                html += '</div>';
            }

            html += '</div>';
            outputDiv.innerHTML = html;
        } catch (err) {
            outputDiv.innerHTML = `<div style="padding:24px;color:#c0392b;">Error: ${err.message}</div>`;
        }
    });
}

// ========================
// Inventory Audit Renderer
// ========================

async function renderInventoryAudit() {
    const container = document.getElementById('inventoryAuditContent');
    if (!container) return;
    container.innerHTML = '';

    const ventureSelect = document.createElement('select');
    ventureSelect.style.cssText = 'padding:8px 12px;border:1px solid #ccc;border-radius:6px;font-size:0.9rem;margin:16px 24px;';
    ventureSelect.innerHTML = '<option value="">-- Select Venture --</option>';
    venturesList.forEach(v => {
        ventureSelect.innerHTML += `<option value="${v.id}">${v.name}</option>`;
    });
    container.appendChild(ventureSelect);

    const outputDiv = document.createElement('div');
    outputDiv.style.cssText = 'padding:0 24px;';
    container.appendChild(outputDiv);

    ventureSelect.addEventListener('change', async () => {
        const vid = ventureSelect.value;
        if (!vid) { outputDiv.innerHTML = ''; return; }
        outputDiv.innerHTML = '<div style="padding:24px;color:#888;">Loading audit...</div>';
        try {
            const rows = await apiGet(`/api/inventory/audit?venture_id=${encodeURIComponent(vid)}`);
            if (!rows.length) {
                outputDiv.innerHTML = '<div style="padding:24px;color:#888;">No materials found for this venture.</div>';
                return;
            }
            let html = '<table class="tracker-table" style="font-size:0.85rem;margin-top:16px;">';
            html += '<thead><tr><th>Material</th><th>Ordered</th><th>Received</th><th>Consumed</th><th>Expected Rem.</th><th>Actual Bal.</th><th>Short Del.</th><th>Flag</th></tr></thead><tbody>';
            rows.forEach(r => {
                const flagClass = r.discrepancy_flag ? ' style="background:#f5f5f5;font-weight:600;"' : '';
                const flagText = r.discrepancy_flag ? '⚠ Discrepancy' : (r.short_delivery > 0 ? 'Short Delivery' : 'OK');
                html += `<tr${flagClass}><td>${r.material_name}</td><td>${r.ordered_qty} ${r.unit}</td><td>${r.received_qty} ${r.unit}</td><td>${r.consumed_qty} ${r.unit}</td><td>${r.expected_remaining} ${r.unit}</td><td>${r.actual_balance} ${r.unit}</td><td>${r.short_delivery} ${r.unit}</td><td>${flagText}</td></tr>`;
            });
            html += '</tbody></table>';
            outputDiv.innerHTML = html;
        } catch (err) {
            outputDiv.innerHTML = `<div style="padding:24px;color:#c0392b;">Error: ${err.message}</div>`;
        }
    });
}


// ========================
// Expenditure Renderer
// ========================

async function loadExpenditures(ventureId) {
    try {
        expenditureList = await apiGet('/api/expenditures?venture_id=' + encodeURIComponent(ventureId)) || [];
    } catch (e) {
        expenditureList = [];
    }
}

function expenditureTotals(entries) {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const from = expenditureFromDate || '1900-01-01';
    const to = expenditureToDate || '9999-12-31';

    let todayTotal = 0;
    let monthTotal = 0;
    let rangeTotal = 0;

    entries.forEach(e => {
        const d = e.date || e.created_at?.slice(0, 10) || today;
        const amt = parseFloat(e.amount) || 0;
        if (d === today) todayTotal += amt;
        if (d >= monthStart && d <= today) monthTotal += amt;
        if (d >= from && d <= to) rangeTotal += amt;
    });

    return { todayTotal, monthTotal, rangeTotal };
}

function filteredExpenditures() {
    const user = currentUser || '';
    const role = currentUserRole || 'supervisor';

    // Supervisor tab only shows own entries; manager/admin tabs show all for the venture
    if (expenditureActiveTab === 'supervisor') {
        return expenditureList.filter(e => (e.created_by || '').toLowerCase() === user.toLowerCase());
    }
    return expenditureList;
}

function renderExpenditureList(container) {
    container.innerHTML = '';
    const entries = filteredExpenditures();
    const table = document.createElement('table');
    table.className = 'tracker-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Date</th>
                <th>Paid To</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Approved By</th>
                <th>Entered By</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:24px;">No expenditure entries found.</td></tr>';
    } else {
        entries.forEach(e => {
            const tr = document.createElement('tr');
            const date = e.date || (e.created_at ? e.created_at.slice(0, 10) : '-');
            const amount = parseFloat(e.amount) || 0;
            const canDelete = currentUserRole === 'admin' || (e.created_by || '').toLowerCase() === (currentUser || '').toLowerCase();
            tr.innerHTML = `
                <td data-label="Date">${date}</td>
                <td data-label="Paid To">${escapeHtml(e.paid_to || '')}</td>
                <td data-label="Amount">${amount.toLocaleString('en-IN', {maximumFractionDigits: 2})}</td>
                <td data-label="Reason">${escapeHtml(e.reason || '')}</td>
                <td data-label="Approved By">${escapeHtml(e.approved_by || '')}</td>
                <td data-label="Entered By">${escapeHtml(e.created_by || '')}</td>
                <td data-label="Actions" style="text-align:center;">
                    ${canDelete ? `<button class="btn-text exp-delete-btn" data-id="${e.id}" style="color:#c0392b;font-size:0.78rem;">Delete</button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.exp-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                if (!confirm('Delete this expenditure entry?')) return;
                try {
                    await apiDelete('/api/expenditure/' + encodeURIComponent(id));
                    showToast('Expenditure deleted');
                    await loadExpenditures(expenditureActiveVenture().id);
                    renderExpenditureView();
                } catch (err) {
                    showToast('Failed to delete', true);
                }
            });
        });
    }

    container.appendChild(table);
}

async function renderExpenditureView() {
    const container = document.getElementById('expenditureContent');
    if (!container) return;
    container.innerHTML = '';

    const v = expenditureActiveVenture();
    if (!v) {
        container.innerHTML = '<div style="padding:24px;color:#999;">No venture available.</div>';
        return;
    }

    // Load data
    await loadExpenditures(v.id);
    const totals = expenditureTotals(expenditureList);

    // Header with venture selector
    const header = document.createElement('div');
    header.className = 'pending-filter-bar';
    const ventureOptions = venturesList.map(vent => `<option value="${vent.id}" ${vent.id === v.id ? 'selected' : ''}>${escapeHtml(vent.name)}</option>`).join('');
    header.innerHTML = `
        <div class="pending-filter-group">
            <label>Venture</label>
            <select id="expenditureVentureSelect">${ventureOptions}</select>
        </div>
        <div class="pending-filter-group">
            <label>From</label>
            <input type="date" id="expenditureFrom" value="${expenditureFromDate}">
        </div>
        <div class="pending-filter-group">
            <label>To</label>
            <input type="date" id="expenditureTo" value="${expenditureToDate}">
        </div>
        <div class="pending-filter-group" style="align-self:flex-end;">
            <button id="expenditureApplyRange" class="btn-secondary" style="padding:8px 16px;">Apply Range</button>
        </div>
    `;
    container.appendChild(header);

    header.querySelector('#expenditureVentureSelect').addEventListener('change', (e) => {
        selectedExpenditureVenture = venturesList.find(vent => vent.id === e.target.value) || null;
        renderExpenditureView();
    });

    header.querySelector('#expenditureApplyRange').addEventListener('click', () => {
        expenditureFromDate = header.querySelector('#expenditureFrom').value;
        expenditureToDate = header.querySelector('#expenditureTo').value;
        renderExpenditureView();
    });

    // Summary cards
    const summary = document.createElement('div');
    summary.className = 'kpi-row';
    summary.style.margin = '16px 24px';
    summary.innerHTML = `
        <div class="kpi-card"><div class="kpi-label">Today's Expenditure</div><div class="kpi-value">&#8377; ${totals.todayTotal.toLocaleString('en-IN', {maximumFractionDigits: 2})}</div></div>
        <div class="kpi-card"><div class="kpi-label">This Month's Expenditure</div><div class="kpi-value">&#8377; ${totals.monthTotal.toLocaleString('en-IN', {maximumFractionDigits: 2})}</div></div>
        <div class="kpi-card"><div class="kpi-label">Range Total</div><div class="kpi-value">&#8377; ${totals.rangeTotal.toLocaleString('en-IN', {maximumFractionDigits: 2})}</div></div>
    `;
    container.appendChild(summary);

    // Tabs
    const tabBar = document.createElement('div');
    tabBar.className = 'inventory-tab-bar';
    const role = currentUserRole || 'supervisor';
    let tabsHtml = '';
    if (role === 'supervisor' || role === 'manager' || role === 'admin') {
        tabsHtml += `<button class="inventory-tab ${expenditureActiveTab === 'supervisor' ? 'active' : ''}" data-tab="supervisor">Supervisor</button>`;
    }
    if (role === 'manager' || role === 'admin') {
        tabsHtml += `<button class="inventory-tab ${expenditureActiveTab === 'manager' ? 'active' : ''}" data-tab="manager">Manager</button>`;
    }
    if (role === 'admin') {
        tabsHtml += `<button class="inventory-tab ${expenditureActiveTab === 'admin' ? 'active' : ''}" data-tab="admin">Admin</button>`;
    }
    tabBar.innerHTML = tabsHtml;
    container.appendChild(tabBar);

    tabBar.querySelectorAll('.inventory-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            expenditureActiveTab = btn.dataset.tab;
            renderExpenditureView();
        });
    });

    // Entry form (supervisor only)
    if (role === 'supervisor') {
        const formCard = document.createElement('div');
        formCard.className = 'invoice-form-card';
        formCard.style.margin = '16px 24px';
        formCard.innerHTML = `
            <h4 style="margin:0 0 16px;font-family:var(--font-display);">Add Expenditure</h4>
            <div class="invoice-form-row">
                <div class="invoice-form-field" style="flex:2;">
                    <label>Paid To</label>
                    <input type="text" id="expPaidTo" placeholder="Person / vendor name">
                </div>
                <div class="invoice-form-field" style="flex:1;">
                    <label>Amount</label>
                    <input type="number" id="expAmount" placeholder="0.00" min="0" step="0.01">
                </div>
            </div>
            <div class="invoice-form-row">
                <div class="invoice-form-field" style="flex:2;">
                    <label>Reason</label>
                    <input type="text" id="expReason" placeholder="Purpose of payment">
                </div>
                <div class="invoice-form-field" style="flex:1;">
                    <label>Approved By</label>
                    <input type="text" id="expApprovedBy" placeholder="Approver name">
                </div>
            </div>
            <div class="invoice-form-row">
                <div class="invoice-form-field" style="flex:1;">
                    <label>Date</label>
                    <input type="date" id="expDate" value="${new Date().toISOString().slice(0, 10)}">
                </div>
            </div>
            <div class="invoice-form-actions">
                <button id="saveExpenditureBtn" class="btn-primary">Save Expenditure</button>
            </div>
        `;
        container.appendChild(formCard);

        document.getElementById('saveExpenditureBtn').addEventListener('click', async () => {
            const paidTo = document.getElementById('expPaidTo').value.trim();
            const amount = parseFloat(document.getElementById('expAmount').value);
            const reason = document.getElementById('expReason').value.trim();
            const approvedBy = document.getElementById('expApprovedBy').value.trim();
            const date = document.getElementById('expDate').value;

            if (!paidTo || isNaN(amount) || amount <= 0 || !reason || !date) {
                showToast('Please fill all required fields', true);
                return;
            }

            try {
                await apiPost('/api/expenditure', {
                    venture_id: v.id,
                    paid_to: paidTo,
                    amount: amount,
                    reason: reason,
                    approved_by: approvedBy,
                    date: date
                });
                showToast('Expenditure saved');
                document.getElementById('expPaidTo').value = '';
                document.getElementById('expAmount').value = '';
                document.getElementById('expReason').value = '';
                document.getElementById('expApprovedBy').value = '';
                await loadExpenditures(v.id);
                renderExpenditureView();
            } catch (err) {
                showToast('Failed to save expenditure', true);
            }
        });
    }

    // List wrapper
    const listWrapper = document.createElement('div');
    listWrapper.className = 'grid-container';
    listWrapper.style.padding = '0 24px 24px';
    renderExpenditureList(listWrapper);
    container.appendChild(listWrapper);
}

// ========================
// Material Leakage Widget
// ========================

async function renderMaterialLeakageWidget(container, ventureId) {
    if (!container || !ventureId) return;
    container.innerHTML = '<div style="padding:16px;color:#888;">Loading leakage data...</div>';
    try {
        const rows = await apiGet(`/api/materials/leakage-check?venture_id=${encodeURIComponent(ventureId)}`);
        if (!rows.length) {
            container.innerHTML = '<div style="padding:16px;color:#888;">No materials data available.</div>';
            return;
        }
        const flagged = rows.filter(r => r.discrepancy_flag || r.short_delivery_flag);
        let html = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">`;
        html += `<h4 style="margin:0;font-size:0.95rem;">Material Leakage Detection</h4>`;
        if (flagged.length > 0) {
            html += `<span style="background:#f5f5f5;padding:2px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;">${flagged.length} flagged</span>`;
        }
        html += '</div>';

        html += '<table class="tracker-table" style="font-size:0.82rem;">';
        html += '<thead><tr><th>Material</th><th>Ordered</th><th>Received</th><th>Consumed</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead><tbody>';
        rows.forEach(r => {
            const isFlagged = r.discrepancy_flag || r.short_delivery_flag;
            const rowStyle = isFlagged ? ' style="background:#f5f5f5;"' : '';
            let status = 'OK';
            if (r.discrepancy_flag) status = '⚠ Discrepancy';
            else if (r.short_delivery_flag) status = 'Short Delivery';
            html += `<tr${rowStyle}><td>${r.material_name}</td><td>${r.ordered_qty} ${r.unit}</td><td>${r.received_qty} ${r.unit}</td><td>${r.consumed_qty} ${r.unit}</td><td>${r.expected_remaining} ${r.unit}</td><td>${r.actual_balance} ${r.unit}</td><td>${status}</td></tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<div style="padding:16px;color:#c0392b;">Error: ${err.message}</div>`;
    }
}


// ========================
// Inline Autosave Helper
// ========================

const autosaveTimers = new Map();

function attachInlineAutosave(element, cellId, field, valueExtractor) {
    if (!element) return;
    const eventType = element.tagName === 'SELECT' ? 'change' : 'input';
    element.addEventListener(eventType, () => {
        const value = valueExtractor ? valueExtractor(element) : element.value;
        const key = `${cellId}_${field}`;
        if (autosaveTimers.has(key)) clearTimeout(autosaveTimers.get(key));
        const timer = setTimeout(async () => {
            try {
                const existing = cellsCache[cacheKey(cellId)] || {};
                const updated = { ...existing, [field]: value, updated_at: new Date().toISOString() };
                await apiPost('/api/cells/batch', { cells: [{ id: cellId, data: updated }] });
                cellsCache[cacheKey(cellId)] = updated;
                showToast('Saved');
            } catch (err) {
                showToast('Save failed', true);
            }
            autosaveTimers.delete(key);
        }, 800);
        autosaveTimers.set(key, timer);
    });
}

// ========================
// Feature 1: Interior Design Studio
// ========================

let dgSelectedFile = null;
let dgCurrentDesignId = null;
let dgPollTimer = null;
let dgHistory = [];

function initDesignGenerator() {
    const uploadZone = document.getElementById('dgUploadZone');
    const fileInput = document.getElementById('dgImageInput');
    const preview = document.getElementById('dgImagePreview');
    const prompt = document.querySelector('.dg-upload-prompt');
    const generateBtn = document.getElementById('dgGenerateBtn');

    if (!uploadZone || !fileInput) return;

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('drag-over');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleDesignImage(file);
    });
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) handleDesignImage(file);
    });

    function handleDesignImage(file) {
        if (!file.type.startsWith('image/')) {
            showToast('Please upload an image file', true);
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showToast('Image must be under 5 MB', true);
            return;
        }
        dgSelectedFile = file;
        const url = URL.createObjectURL(file);
        preview.src = url;
        preview.style.display = '';
        if (prompt) prompt.style.display = 'none';
        generateBtn.disabled = false;
    }

    generateBtn.addEventListener('click', async () => {
        if (!dgSelectedFile) return;
        generateBtn.disabled = true;
        document.getElementById('dgLoading').style.display = '';
        document.getElementById('dgGallery').style.display = 'none';
        document.getElementById('dgPromptBox').style.display = 'none';

        const formData = new FormData();
        formData.append('image', dgSelectedFile);
        formData.append('room_type', document.getElementById('dgRoomType').value);
        formData.append('style', document.getElementById('dgStyle').value);
        formData.append('budget_tier', document.getElementById('dgBudgetTier').value);
        const areaSqft = document.getElementById('dgAreaSqft');
        formData.append('area_sqft', areaSqft && areaSqft.value ? areaSqft.value : '120');

        try {
            const res = await fetch('/api/interior-design/generate', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            dgCurrentDesignId = data.id;
            startDesignPolling(data.id);
        } catch (err) {
            showToast(err.message, true);
            document.getElementById('dgLoading').style.display = 'none';
            generateBtn.disabled = false;
        }
    });
}

function startDesignPolling(designId) {
    stopDesignPolling();
    let attempts = 0;
    dgPollTimer = setInterval(async () => {
        attempts++;
        try {
            const data = await apiGet(`/api/interior-design/${designId}/status`);
            if (data.status === 'completed' || data.status === 'failed' || attempts > 40) {
                stopDesignPolling();
                renderDesignResult(data);
                renderDesignGeneratorHistory();
            }
        } catch (err) {
            console.error('Design poll error:', err);
        }
    }, 1500);
}

function stopDesignPolling() {
    if (dgPollTimer) {
        clearInterval(dgPollTimer);
        dgPollTimer = null;
    }
}

function renderDesignResult(data) {
    document.getElementById('dgLoading').style.display = 'none';
    document.getElementById('dgGenerateBtn').disabled = false;
    const gallery = document.getElementById('dgGallery');
    const promptBox = document.getElementById('dgPromptBox');
    const promptText = document.getElementById('dgPromptText');

    gallery.innerHTML = '';
    const images = (data.generated_images || []).filter(img => img && img.url);
    if (images.length === 0) {
        const failures = (data.generated_images || []).filter(img => img && !img.url && img.error);
        const details = failures.length
            ? `<ul style="margin:8px 0 0 20px;font-size:13px;">${failures.map(f => `<li>Seed ${f.seed}: ${escapeHtml(f.error)}</li>`).join('')}</ul>`
            : '';
        gallery.innerHTML = `<div style="padding:20px;color:#c0392b;">${escapeHtml(data.error_message || 'No images were generated.')}${details}</div>`;
        gallery.style.display = '';
        return;
    }

    images.forEach((img, idx) => {
        const card = document.createElement('div');
        card.className = 'dg-result-card';
        const cost = data.cost_estimate || {};
        card.innerHTML = `
            <img src="${escapeHtml(img.url)}" alt="Generated design" loading="lazy">
            <div class="dg-result-meta">
                <h4>Generated Design</h4>
                <div class="dg-result-cost">Est. ${cost.currency || 'INR'} ${(cost.total_estimate || 0).toLocaleString()} (${cost.area_sqft || cost.sample_area_sqft || 120} sqft)</div>
                <div class="dg-result-actions">
                    <button class="btn-primary dg-download-btn" data-url="${escapeHtml(img.url)}" data-idx="${idx}">Download</button>
                </div>
            </div>
        `;
        gallery.appendChild(card);
    });

    gallery.querySelectorAll('.dg-download-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            downloadImage(btn.dataset.url, `design_${data.id}_v${parseInt(btn.dataset.idx) + 1}.jpg`);
        });
    });
    gallery.style.display = '';

    if (data.enhanced_prompt) {
        promptText.textContent = data.enhanced_prompt;
        promptBox.style.display = '';
    }
}

async function downloadImage(url, filename) {
    try {
        const res = await fetch(url);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(a.href);
        a.remove();
    } catch (err) {
        showToast('Download failed', true);
    }
}

async function renderDesignGeneratorHistory() {
    const container = document.getElementById('dgHistoryList');
    if (!container) return;
    try {
        const data = await apiGet('/api/interior-design/history');
        dgHistory = data || [];
    } catch (err) {
        dgHistory = [];
    }
    container.innerHTML = '';
    if (!dgHistory.length) {
        container.innerHTML = '<div style="color:#888;padding:12px 0;">No designs yet.</div>';
        return;
    }
    dgHistory.slice(0, 8).forEach(item => {
        const first = (item.generated_images || []).find(img => img && img.url);
        const el = document.createElement('div');
        el.className = 'dg-history-item';
        el.innerHTML = `
            ${first ? `<img src="${escapeHtml(first.url)}" alt="">` : '<div style="height:120px;background:#f0f0f0;border-radius:8px;margin-bottom:8px;"></div>'}
            <div class="dg-history-title">${escapeHtml(item.room_type || '')} &bull; ${escapeHtml(item.style || '')}</div>
            <div class="dg-history-meta">${escapeHtml(item.budget_tier || '')} &bull; ${item.status}</div>
        `;
        el.addEventListener('click', () => {
            dgCurrentDesignId = item.id;
            renderDesignResult(item);
        });
        container.appendChild(el);
    });
}

// ========================
// Feature 2: Construction Stock Purchases
// ========================

let spMaterials = [];
let spCategories = ['All', 'Structural', 'Electrical', 'Plumbing', 'Finishes', 'Hardware', 'Flooring', 'Ceiling'];
let spSelectedCategory = 'All';

async function renderStockPurchases() {
    const catBar = document.getElementById('spCategoryBar');
    const grid = document.getElementById('spMaterialsGrid');
    if (!catBar || !grid) return;

    renderSPCategories();
    try {
        spMaterials = await apiGet('/api/marketplace/materials');
    } catch (err) {
        spMaterials = [];
    }
    renderSPMaterials();
}

function renderSPCategories() {
    const catBar = document.getElementById('spCategoryBar');
    if (!catBar) return;
    const isAdmin = currentUserRole === 'admin';
    catBar.innerHTML = '';
    spCategories.forEach(cat => {
        const chip = document.createElement('button');
        chip.className = 'sp-category-chip' + (cat === spSelectedCategory ? ' active' : '') + (isAdmin ? '' : ' disabled');
        chip.textContent = cat;
        chip.disabled = !isAdmin;
        if (isAdmin) {
            chip.addEventListener('click', () => {
                spSelectedCategory = cat;
                renderSPCategories();
                renderSPMaterials();
            });
        }
        catBar.appendChild(chip);
    });
}

function renderSPMaterials() {
    const grid = document.getElementById('spMaterialsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const filtered = spSelectedCategory === 'All'
        ? spMaterials
        : spMaterials.filter(m => (m.category || '').toLowerCase() === spSelectedCategory.toLowerCase());

    if (!filtered.length) {
        grid.innerHTML = '<div style="grid-column:1/-1;color:#888;padding:20px;">No materials found.</div>';
        return;
    }

    filtered.forEach(m => {
        const card = document.createElement('div');
        card.className = 'sp-material-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="sp-material-category">${escapeHtml(m.category || '')}</div>
            <div class="sp-material-name">${escapeHtml(m.name || '')}</div>
            <div class="sp-material-unit">${escapeHtml(m.unit || '')}</div>
            ${m.description ? `<div class="sp-material-desc">${escapeHtml(m.description)}</div>` : ''}
            <div class="sp-material-hint" style="font-size:0.75rem;color:#888;margin-top:8px;">Click to see suppliers & prices</div>
        `;
        card.addEventListener('click', () => openSPSupplierDrawer(m));
        grid.appendChild(card);
    });
}

async function openSPSupplierDrawer(material) {
    const drawer = document.getElementById('spSupplierDrawer');
    const title = document.getElementById('spDrawerTitle');
    const list = document.getElementById('spSuppliersList');
    if (!drawer || !title || !list) return;

    title.textContent = `${escapeHtml(material.name || '')} — Suppliers`;
    list.innerHTML = '<div style="padding:20px;color:#888;">Loading suppliers...</div>';
    drawer.style.display = '';
    drawer.classList.add('open');

    try {
        const suppliers = await apiGet(`/api/marketplace/materials/${material.id}/suppliers`);
        if (!suppliers.length) {
            list.innerHTML = '<div style="padding:20px;color:#888;">No suppliers found for this material.</div>';
            return;
        }
        list.innerHTML = suppliers.map(s => `
            <div class="sp-supplier-card">
                <div class="sp-supplier-brand">${escapeHtml(s.brand_name || '—')}</div>
                <div class="sp-supplier-company">${escapeHtml(s.company_name || '')}</div>
                <div class="sp-supplier-price">₹${s.price_low || 0} – ₹${s.price_high || 0}</div>
                <div class="sp-supplier-trust">${escapeHtml(s.trust_level || '')}</div>
                <div class="sp-supplier-contact">
                    ${s.phone ? `<div>📞 ${escapeHtml(s.phone)}</div>` : ''}
                    ${s.email ? `<div>✉ ${escapeHtml(s.email)}</div>` : ''}
                </div>
            </div>
        `).join('');
    } catch (err) {
        list.innerHTML = '<div style="padding:20px;color:#c0392b;">Failed to load suppliers.</div>';
    }
}

function closeSPSupplierDrawer() {
    const drawer = document.getElementById('spSupplierDrawer');
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.style.display = 'none';
}

function initStockPurchases() {
    // Filter interactions are wired in renderSPCategories per role.
    const closeBtn = document.getElementById('spCloseDrawer');
    if (closeBtn && !closeBtn._bound) {
        closeBtn.addEventListener('click', closeSPSupplierDrawer);
        closeBtn._bound = true;
    }
}

