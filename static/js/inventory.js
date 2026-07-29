// ========================
// Inventory Stub
// ========================
async function renderInventoryView() {
    const container = document.getElementById('inventoryPanelContent');
    if (!container) return;
    container.innerHTML = '<div style="padding:24px;color:#999;">Inventory module is not available in this build.</div>';
}

// ========================
// Inventory Module
// ========================
let inventoryMaterials = [];
let inventoryStockEntries = [];
let inventoryBalance = [];
let inventoryTab = 'summary';
let inventoryEntryEditingId = null;
let inventoryMaterialEditingId = null;
let selectedInventoryVenture = null;
let inventoryRegTypeFilter = 'all';
let inventoryRegMaterialFilter = 'all';
let inventoryLocMaterialFilter = 'all';
let inventoryLocBlockFilter = 'all';
let inventoryLocFloorFilter = 'all';
let inventoryVendorFilter = 'all';
let inventoryVendorMaterialFilter = 'all';
let expenditureList = [];
let selectedExpenditureVenture = null;
let expenditureFromDate = '';
let expenditureToDate = '';
let expenditureActiveTab = 'supervisor'; // supervisor | manager | admin

function expenditureActiveVenture() {
    return selectedExpenditureVenture || currentVenture || (venturesList.length ? venturesList[0] : null);
}

function inventoryActiveVenture() {
    return selectedInventoryVenture || currentVenture;
}

async function loadInventoryMaterials(ventureId) {
    if (!ventureId) return [];
    try {
        return await apiGet('/api/materials?venture_id=' + encodeURIComponent(ventureId)) || [];
    } catch (e) { return []; }
}

async function loadGlobalMaterials() {
    try {
        return await apiGet('/api/materials?global=true') || [];
    } catch (e) { return []; }
}

async function loadInventoryStock(ventureId) {
    if (!ventureId) return [];
    try {
        return await apiGet('/api/stock?venture_id=' + encodeURIComponent(ventureId)) || [];
    } catch (e) { return []; }
}

async function loadInventorySummary(ventureId) {
    if (!ventureId) return [];
    try {
        return await apiGet('/api/stock/summary?venture_id=' + encodeURIComponent(ventureId)) || [];
    } catch (e) { return []; }
}

async function renderInventoryView() {
    const container = document.getElementById('inventoryPanelContent');
    container.innerHTML = '';

    const venture = inventoryActiveVenture();
    if (!venture) {
        container.innerHTML = '<div style="padding:24px;color:#999;">No venture selected.</div>';
        return;
    }

    inventoryMaterials = await loadInventoryMaterials(venture.id);
    const globalMats = await loadGlobalMaterials();
    inventoryMaterials = [...globalMats, ...inventoryMaterials.filter(m => !globalMats.some(g => g.id === m.id))];
    inventoryStockEntries = await loadInventoryStock(venture.id);
    inventoryBalance = await loadInventorySummary(venture.id);

    // Header bar
    const isPanel = !!selectedInventoryVenture;
    const header = document.createElement('div');
    header.className = 'pending-filter-bar';
    let ventureOptions = '';
    venturesList.forEach(v => {
        ventureOptions += `<option value="${v.id}" ${selectedInventoryVenture && selectedInventoryVenture.id === v.id ? 'selected' : ''}>${escapeHtml(v.name)}</option>`;
    });
    header.innerHTML = `
        <div class="pending-filter-group">
            <label>Venture</label>
            ${isPanel
                ? `<select id="inventoryVentureSelect">${ventureOptions}</select>`
                : `<div class="pending-readonly">${escapeHtml(venture.name)}</div>`}
        </div>
        <div class="pending-filter-group" style="align-self:flex-end;">
            <button id="inventoryAddMaterialBtn" class="btn-secondary" style="padding:8px 16px;">+ Manage Materials</button>
        </div>
    `;
    container.appendChild(header);

    if (isPanel) {
        header.querySelector('#inventoryVentureSelect').addEventListener('change', (e) => {
            selectedInventoryVenture = venturesList.find(v => v.id === e.target.value) || null;
            renderInventoryView();
        });
    }

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.className = 'inventory-tab-bar';
    tabBar.innerHTML = `
        <button class="inventory-tab ${inventoryTab === 'summary' ? 'active' : ''}" data-tab="summary">Stock Summary</button>
        <button class="inventory-tab ${inventoryTab === 'register' ? 'active' : ''}" data-tab="register">Stock Register</button>
        <button class="inventory-tab ${inventoryTab === 'location' ? 'active' : ''}" data-tab="location">By Location</button>
        <button class="inventory-tab ${inventoryTab === 'vendor' ? 'active' : ''}" data-tab="vendor">By Vendor</button>
        <button class="inventory-tab ${inventoryTab === 'wastage' ? 'active' : ''}" data-tab="wastage">Wastage</button>
        <button class="inventory-tab ${inventoryTab === 'transfers' ? 'active' : ''}" data-tab="transfers">Transfers</button>
        <button class="inventory-tab ${inventoryTab === 'budgets' ? 'active' : ''}" data-tab="budgets">Budgets</button>
        <button class="inventory-tab ${inventoryTab === 'alerts' ? 'active' : ''}" data-tab="alerts">Alerts</button>
    `;
    container.appendChild(tabBar);

    tabBar.querySelectorAll('.inventory-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            inventoryTab = btn.dataset.tab;
            renderInventoryView();
        });
    });

    // Action bar for Stock In / Out (hide for transfers/budgets/alerts tabs)
    if (!['transfers', 'budgets', 'alerts', 'wastage'].includes(inventoryTab)) {
        const actionBar = document.createElement('div');
        actionBar.className = 'inventory-actions';
        actionBar.innerHTML = `
            <button id="inventoryStockInBtn" class="btn-primary" style="flex:1;max-width:220px;">+ Stock In</button>
            <button id="inventoryStockOutBtn" class="btn-secondary" style="flex:1;max-width:220px;">+ Stock Out</button>
        `;
        container.appendChild(actionBar);

        actionBar.querySelector('#inventoryStockInBtn').addEventListener('click', () => openStockEntryModal(null, 'IN'));
        actionBar.querySelector('#inventoryStockOutBtn').addEventListener('click', () => openStockEntryModal(null, 'OUT'));
    }
    header.querySelector('#inventoryAddMaterialBtn').addEventListener('click', () => openMaterialModal(null));

    // Render selected tab
    const tabContent = document.createElement('div');
    tabContent.id = 'inventoryTabContent';
    container.appendChild(tabContent);

    if (inventoryTab === 'summary') renderInventorySummary(tabContent);
    else if (inventoryTab === 'register') renderInventoryRegister(tabContent);
    else if (inventoryTab === 'location') renderInventoryLocation(tabContent);
    else if (inventoryTab === 'vendor') renderInventoryVendor(tabContent);
    else if (inventoryTab === 'wastage') renderInventoryWastage(tabContent);
    else if (inventoryTab === 'transfers') renderInventoryTransfers(tabContent);
    else if (inventoryTab === 'budgets') renderInventoryBudgets(tabContent);
    else if (inventoryTab === 'alerts') renderInventoryAlerts(tabContent);
}

function renderInventorySummary(container) {
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';

    const table = document.createElement('table');
    table.className = 'tracker-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Material</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Purchased</th>
                <th>Used</th>
                <th>Adjust</th>
                <th>Balance</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    if (inventoryBalance.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;padding:24px;">No materials yet. Click "Manage Materials" to add materials.</td></tr>';
    } else {
        inventoryBalance.forEach(row => {
            const mat = inventoryMaterials.find(m => m.id === row.material_id) || {};
            const bal = parseFloat(row.balance) || 0;
            const threshold = parseFloat(mat.min_threshold) || 0;
            let statusHtml = '<span style="color:#27ae60;font-weight:600;">OK</span>';
            if (bal <= 0) statusHtml = '<span style="color:#e74c3c;font-weight:600;">Out of Stock</span>';
            else if (threshold > 0 && bal <= threshold) statusHtml = '<span style="color:#f39c12;font-weight:600;">Low</span>';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td data-label="Material">${escapeHtml(mat.name || 'Unknown')}</td>
                <td data-label="Category">${escapeHtml(mat.category || '-')}</td>
                <td data-label="Unit">${escapeHtml(mat.unit || '-')}</td>
                <td data-label="Purchased">${formatNumber(row.total_in)}</td>
                <td data-label="Used">${formatNumber(row.total_out)}</td>
                <td data-label="Adjust">${formatNumber(row.total_adjust)}</td>
                <td data-label="Balance" style="font-weight:700;">${formatNumber(row.balance)}</td>
                <td data-label="Status">${statusHtml}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);
}

function renderInventoryRegister(container) {
    const filterBar = document.createElement('div');
    filterBar.className = 'pending-filter-bar';
    filterBar.style.marginBottom = '8px';
    let materialOptions = '<option value="all">All Materials</option>';
    inventoryMaterials.forEach(m => {
        materialOptions += `<option value="${m.id}" ${inventoryRegMaterialFilter === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`;
    });
    filterBar.innerHTML = `
        <div class="pending-filter-group">
            <label>Type</label>
            <select id="inventoryRegType">
                <option value="all" ${inventoryRegTypeFilter === 'all' ? 'selected' : ''}>All</option>
                <option value="IN" ${inventoryRegTypeFilter === 'IN' ? 'selected' : ''}>In</option>
                <option value="OUT" ${inventoryRegTypeFilter === 'OUT' ? 'selected' : ''}>Out</option>
                <option value="ADJUST" ${inventoryRegTypeFilter === 'ADJUST' ? 'selected' : ''}>Adjust</option>
            </select>
        </div>
        <div class="pending-filter-group">
            <label>Material</label>
            <select id="inventoryRegMaterial">${materialOptions}</select>
        </div>
    `;
    container.appendChild(filterBar);

    filterBar.querySelector('#inventoryRegType').addEventListener('change', (e) => {
        inventoryRegTypeFilter = e.target.value;
        renderInventoryView();
    });
    filterBar.querySelector('#inventoryRegMaterial').addEventListener('change', (e) => {
        inventoryRegMaterialFilter = e.target.value;
        renderInventoryView();
    });

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';

    const table = document.createElement('table');
    table.className = 'tracker-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Material</th>
                <th>Qty</th>
                <th>Vendor / Location</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>Remarks</th>
                <th></th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    let rows = [...inventoryStockEntries].sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''));
    if (inventoryRegTypeFilter !== 'all') rows = rows.filter(r => r.entry_type === inventoryRegTypeFilter);
    if (inventoryRegMaterialFilter !== 'all') rows = rows.filter(r => r.material_id === inventoryRegMaterialFilter);

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#999;padding:24px;">No stock entries found.</td></tr>';
    } else {
        rows.forEach(row => {
            const mat = inventoryMaterials.find(m => m.id === row.material_id) || {};
            const badgeClass = row.entry_type === 'IN' ? 'inv-in' : row.entry_type === 'OUT' ? 'inv-out' : 'inv-adj';
            const vendor = loadVendors().find(v => v.id === row.vendor_id);
            const location = row.entry_type === 'OUT'
                ? `${row.block || '-'} / ${row.floor || '-'} / ${row.flat || '-'}`
                : (vendor ? vendor.name : '-');
            const amount = row.rate && row.qty ? (row.qty * row.rate).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(row.entry_date)}</td>
                <td><span class="inv-badge ${badgeClass}">${row.entry_type}</span></td>
                <td>${escapeHtml(mat.name || '-')}</td>
                <td>${formatNumber(row.qty)}</td>
                <td>${escapeHtml(location)}</td>
                <td>${row.rate ? '&#8377;' + formatNumber(row.rate) : '-'}</td>
                <td>${row.rate ? '&#8377;' + amount : '-'}</td>
                <td>${escapeHtml(row.remarks || '-')}</td>
                <td><button class="btn-text edit-entry-btn" data-eid="${row.id}">Edit</button></td>
            `;
            tbody.appendChild(tr);
        });
    }

    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);

    container.querySelectorAll('.edit-entry-btn').forEach(btn => {
        btn.addEventListener('click', () => openStockEntryModal(btn.dataset.eid));
    });
}

function renderInventoryLocation(container) {
    const filterBar = document.createElement('div');
    filterBar.className = 'pending-filter-bar';
    filterBar.style.marginBottom = '8px';
    let materialOptions = '<option value="all">All Materials</option>';
    inventoryMaterials.forEach(m => {
        materialOptions += `<option value="${m.id}" ${inventoryLocMaterialFilter === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`;
    });
    const invVenture = inventoryActiveVenture();
    filterBar.innerHTML = `
        <div class="pending-filter-group">
            <label>Material</label>
            <select id="inventoryLocMaterial">${materialOptions}</select>
        </div>
        <div class="pending-filter-group">
            <label>Block</label>
            <select id="inventoryLocBlock"><option value="all" ${inventoryLocBlockFilter === 'all' ? 'selected' : ''}>All</option></select>
        </div>
        <div class="pending-filter-group">
            <label>Floor</label>
            <select id="inventoryLocFloor"><option value="all" ${inventoryLocFloorFilter === 'all' ? 'selected' : ''}>All</option></select>
        </div>
    `;
    container.appendChild(filterBar);

    const blockSel = filterBar.querySelector('#inventoryLocBlock');
    const floorSel = filterBar.querySelector('#inventoryLocFloor');
    if (invVenture && invVenture.blocks) {
        invVenture.blocks.forEach(b => {
            const selected = inventoryLocBlockFilter === b.id ? 'selected' : '';
            blockSel.innerHTML += `<option value="${b.id}" ${selected}>${escapeHtml(b.name || b.id)}</option>`;
        });
    }
    const blockForFloors = (invVenture && invVenture.blocks && invVenture.blocks[0]) ? invVenture.blocks[0] : null;
    const floors = blockForFloors ? (blockForFloors.floors || 5) : 5;
    const floorLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
    for (let f = 1; f <= floors; f++) {
        const label = floors === 1 ? 'Ground Floor' : `${floorLabels[f - 1] || f + 'th'} Floor`;
        const selected = inventoryLocFloorFilter === label ? 'selected' : '';
        floorSel.innerHTML += `<option value="${label}" ${selected}>${label}</option>`;
    }

    filterBar.querySelector('#inventoryLocMaterial').addEventListener('change', (e) => {
        inventoryLocMaterialFilter = e.target.value;
        renderInventoryView();
    });
    blockSel.addEventListener('change', (e) => {
        inventoryLocBlockFilter = e.target.value;
        renderInventoryView();
    });
    floorSel.addEventListener('change', (e) => {
        inventoryLocFloorFilter = e.target.value;
        renderInventoryView();
    });

    let rows = inventoryStockEntries.filter(r => r.entry_type === 'OUT').sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''));
    if (inventoryLocMaterialFilter !== 'all') rows = rows.filter(r => r.material_id === inventoryLocMaterialFilter);
    if (inventoryLocBlockFilter !== 'all') rows = rows.filter(r => r.block === inventoryLocBlockFilter);
    if (inventoryLocFloorFilter !== 'all') rows = rows.filter(r => r.floor === inventoryLocFloorFilter);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    const table = document.createElement('table');
    table.className = 'tracker-table';
    table.innerHTML = `
        <thead>
            <tr><th>Date</th><th>Material</th><th>Block</th><th>Floor</th><th>Flat</th><th>Work Item</th><th>Qty</th><th>Remarks</th></tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;padding:24px;">No stock-out entries for this location.</td></tr>';
    } else {
        rows.forEach(row => {
            const mat = inventoryMaterials.find(m => m.id === row.material_id) || {};
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(row.entry_date)}</td>
                <td>${escapeHtml(mat.name || '-')}</td>
                <td>${escapeHtml(row.block || '-')}</td>
                <td>${escapeHtml(row.floor || '-')}</td>
                <td>${escapeHtml(row.flat || '-')}</td>
                <td>${escapeHtml(row.work_item || '-')}</td>
                <td>${formatNumber(row.qty)}</td>
                <td>${escapeHtml(row.remarks || '-')}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);
}

function renderInventoryVendor(container) {
    const filterBar = document.createElement('div');
    filterBar.className = 'pending-filter-bar';
    filterBar.style.marginBottom = '8px';
    let materialOptions = '<option value="all">All Materials</option>';
    inventoryMaterials.forEach(m => {
        materialOptions += `<option value="${m.id}" ${inventoryVendorMaterialFilter === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`;
    });
    let vendorOptions = '<option value="all">All Vendors</option>';
    loadVendors().forEach(v => {
        vendorOptions += `<option value="${v.id}" ${inventoryVendorFilter === v.id ? 'selected' : ''}>${escapeHtml(v.name)}</option>`;
    });
    filterBar.innerHTML = `
        <div class="pending-filter-group">
            <label>Vendor</label>
            <select id="inventoryVendor">${vendorOptions}</select>
        </div>
        <div class="pending-filter-group">
            <label>Material</label>
            <select id="inventoryVendorMaterial">${materialOptions}</select>
        </div>
    `;
    container.appendChild(filterBar);

    filterBar.querySelector('#inventoryVendor').addEventListener('change', (e) => {
        inventoryVendorFilter = e.target.value;
        renderInventoryView();
    });
    filterBar.querySelector('#inventoryVendorMaterial').addEventListener('change', (e) => {
        inventoryVendorMaterialFilter = e.target.value;
        renderInventoryView();
    });

    let rows = inventoryStockEntries.filter(r => r.entry_type === 'IN').sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''));
    if (inventoryVendorFilter !== 'all') rows = rows.filter(r => r.vendor_id === inventoryVendorFilter);
    if (inventoryVendorMaterialFilter !== 'all') rows = rows.filter(r => r.material_id === inventoryVendorMaterialFilter);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    const table = document.createElement('table');
    table.className = 'tracker-table';
    table.innerHTML = `
        <thead>
            <tr><th>Date</th><th>Vendor</th><th>Material</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Invoice</th><th>PO</th><th>Remarks</th></tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#999;padding:24px;">No stock-in entries for this vendor.</td></tr>';
    } else {
        rows.forEach(row => {
            const mat = inventoryMaterials.find(m => m.id === row.material_id) || {};
            const vendor = loadVendors().find(v => v.id === row.vendor_id);
            const amount = row.rate && row.qty ? (row.qty * row.rate).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(row.entry_date)}</td>
                <td>${escapeHtml(vendor ? vendor.name : '-')}</td>
                <td>${escapeHtml(mat.name || '-')}</td>
                <td>${formatNumber(row.qty)}</td>
                <td>${row.rate ? '&#8377;' + formatNumber(row.rate) : '-'}</td>
                <td>${row.rate ? '&#8377;' + amount : '-'}</td>
                <td>${escapeHtml(row.invoice_id || '-')}</td>
                <td>${escapeHtml(row.po_id || '-')}</td>
                <td>${escapeHtml(row.remarks || '-')}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);
}

function formatNumber(n) {
    if (n === null || n === undefined || n === '') return '-';
    const num = parseFloat(n);
    if (isNaN(num)) return '-';
    return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ========================
// Wastage Tab
// ========================
function renderInventoryWastage(container) {
    const invVenture = inventoryActiveVenture();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<div class="grid-container"><table class="tracker-table"><thead><tr><th>Date</th><th>Material</th><th>Block</th><th>Floor</th><th>Flat</th><th>Work Item</th><th>Wasted Qty</th><th>Cost/Unit</th><th>Total Cost</th><th>Reason</th></tr></thead><tbody id="wastageBody"></tbody></table></div>';
    container.appendChild(wrapper);
    const tbody = wrapper.querySelector('#wastageBody');
    (async () => {
        try {
            const rows = await apiGet('/api/stock/wastage-report?venture_id=' + encodeURIComponent(invVenture.id)) || [];
            if (rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#999;padding:24px;">No wastage recorded.</td></tr>';
                return;
            }
            rows.sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''));
            let totalCost = 0;
            rows.forEach(r => {
                const mat = inventoryMaterials.find(m => m.id === r.material_id) || {};
                const cost = parseFloat(r.cost_per_unit || 0);
                const qty = parseFloat(r.qty || 0);
                const lineCost = cost * qty;
                totalCost += lineCost;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${formatDate(r.entry_date)}</td>
                    <td>${escapeHtml(mat.name || r.material_id)}</td>
                    <td>${escapeHtml(r.block || '-')}</td>
                    <td>${escapeHtml(r.floor || '-')}</td>
                    <td>${escapeHtml(r.flat || '-')}</td>
                    <td>${escapeHtml(r.work_item || '-')}</td>
                    <td style="color:#e74c3c;font-weight:600;">${formatNumber(qty)}</td>
                    <td>${cost ? '&#8377;' + formatNumber(cost) : '-'}</td>
                    <td>${lineCost ? '&#8377;' + formatNumber(lineCost) : '-'}</td>
                    <td style="font-size:0.8rem;">${escapeHtml(r.remarks || '-')}</td>
                `;
                tbody.appendChild(tr);
            });
            const tfoot = document.createElement('tfoot');
            tfoot.innerHTML = `<tr style="font-weight:700;background:#f8f8f8;"><td colspan="8" style="text-align:right;">Total Wastage Cost:</td><td colspan="2" style="color:#e74c3c;">&#8377;${formatNumber(totalCost)}</td></tr>`;
            tbody.parentElement.appendChild(tfoot);
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#999;padding:24px;">Failed to load wastage data.</td></tr>';
        }
    })();
}

// ========================
// Transfers Tab
// ========================
function renderInventoryTransfers(container) {
    const invVenture = inventoryActiveVenture();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
        <div style="padding:16px 0;">
            <h4 style="margin:0 0 12px 0;color:#1a2a6c;font-size:0.95rem;">Transfer Stock from Warehouse</h4>
            <div class="invoice-form-row">
                <div class="invoice-form-field" style="flex:1;">
                    <label>Material</label>
                    <select id="transferMaterial"><option value="">-- Select Material --</option></select>
                </div>
                <div class="invoice-form-field" style="flex:1;">
                    <label>To Venture</label>
                    <select id="transferToVenture"><option value="">-- Select Venture --</option></select>
                </div>
                <div class="invoice-form-field" style="max-width:120px;">
                    <label>Qty</label>
                    <input type="number" id="transferQty" min="0" step="0.01" placeholder="0">
                </div>
            </div>
            <div class="invoice-form-actions" style="margin-top:12px;">
                <button id="executeTransferBtn" class="btn-primary">Transfer</button>
            </div>
            <div id="transferMsg" style="margin-top:8px;font-size:0.85rem;min-height:18px;"></div>
        </div>
        <div class="grid-container">
            <table class="tracker-table">
                <thead><tr><th>Date</th><th>Material</th><th>From</th><th>To</th><th>Qty</th><th>Cost/Unit</th></tr></thead>
                <tbody id="transferHistoryBody"></tbody>
            </table>
        </div>
    `;
    container.appendChild(wrapper);

    const matSel = wrapper.querySelector('#transferMaterial');
    inventoryMaterials.forEach(m => {
        matSel.innerHTML += `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.unit)})</option>`;
    });
    const ventSel = wrapper.querySelector('#transferToVenture');
    venturesList.forEach(v => {
        if (v.id !== 'WAREHOUSE') {
            ventSel.innerHTML += `<option value="${v.id}" ${invVenture && invVenture.id === v.id ? 'selected' : ''}>${escapeHtml(v.name)}</option>`;
        }
    });

    wrapper.querySelector('#executeTransferBtn').addEventListener('click', async () => {
        const materialId = matSel.value;
        const toVenture = ventSel.value;
        const qty = parseFloat(wrapper.querySelector('#transferQty').value);
        const msgEl = wrapper.querySelector('#transferMsg');
        if (!materialId || !toVenture || isNaN(qty) || qty <= 0) {
            msgEl.style.color = '#c0392b';
            msgEl.textContent = 'Please fill all fields with valid values.';
            return;
        }
        try {
            await apiPost('/api/transfer-stock', { to_venture_id: toVenture, material_id: materialId, qty: qty });
            msgEl.style.color = '#27ae60';
            msgEl.textContent = 'Stock transferred successfully.';
            wrapper.querySelector('#transferQty').value = '';
            renderInventoryView();
        } catch (err) {
            msgEl.style.color = '#c0392b';
            msgEl.textContent = err.message || 'Transfer failed.';
        }
    });

    // Load transfer history (OUT entries from WAREHOUSE with consuming_venture_id)
    const tbody = wrapper.querySelector('#transferHistoryBody');
    (async () => {
        try {
            const transfers = await apiGet('/api/stock?venture_id=WAREHOUSE&entry_type=OUT') || [];
        if (transfers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:24px;">No transfers yet.</td></tr>';
        } else {
            transfers.sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''));
            transfers.forEach(row => {
                const mat = inventoryMaterials.find(m => m.id === row.material_id) || {};
                const toVent = venturesList.find(v => v.id === row.consuming_venture_id) || {};
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${formatDate(row.entry_date)}</td>
                    <td>${escapeHtml(mat.name || '-')}</td>
                    <td>Warehouse</td>
                    <td>${escapeHtml(toVent.name || row.consuming_venture_id || '-')}</td>
                    <td>${formatNumber(row.qty)}</td>
                    <td>${row.cost_per_unit ? '&#8377;' + formatNumber(row.cost_per_unit) : '-'}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:24px;">Failed to load transfers.</td></tr>';
        }
    })();
}

// ========================
// Budgets Tab
// ========================
function renderInventoryBudgets(container) {
    const invVenture = inventoryActiveVenture();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
        <div style="padding:16px 0;">
            <h4 style="margin:0 0 12px 0;color:#1a2a6c;font-size:0.95rem;">Set Material Budget</h4>
            <div class="invoice-form-row">
                <div class="invoice-form-field" style="flex:1;">
                    <label>Material</label>
                    <select id="budgetMaterial"><option value="">-- Select Material --</option></select>
                </div>
                <div class="invoice-form-field" style="max-width:140px;">
                    <label>Budget Qty</label>
                    <input type="number" id="budgetQty" min="0" step="0.01" placeholder="0">
                </div>
                <div class="invoice-form-field" style="max-width:140px;">
                    <label>Budget Value (&#8377;)</label>
                    <input type="number" id="budgetValue" min="0" step="0.01" placeholder="0">
                </div>
                <div class="invoice-form-field" style="max-width:100px;">
                    <label>Alert %</label>
                    <input type="number" id="budgetThreshold" min="0" max="100" step="1" value="80">
                </div>
            </div>
            <div class="invoice-form-actions" style="margin-top:12px;">
                <button id="saveBudgetBtn" class="btn-primary">Save Budget</button>
            </div>
            <div id="budgetMsg" style="margin-top:8px;font-size:0.85rem;min-height:18px;"></div>
        </div>
        <div class="grid-container">
            <table class="tracker-table">
                <thead><tr><th>Material</th><th>Budget Qty</th><th>Budget Value</th><th>Alert %</th><th>Consumed</th><th>Status</th></tr></thead>
                <tbody id="budgetListBody"></tbody>
            </table>
        </div>
    `;
    container.appendChild(wrapper);

    const matSel = wrapper.querySelector('#budgetMaterial');
    inventoryMaterials.forEach(m => {
        matSel.innerHTML += `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.unit)})</option>`;
    });

    wrapper.querySelector('#saveBudgetBtn').addEventListener('click', async () => {
        const materialId = matSel.value;
        const qty = parseFloat(wrapper.querySelector('#budgetQty').value);
        const value = parseFloat(wrapper.querySelector('#budgetValue').value);
        const threshold = parseFloat(wrapper.querySelector('#budgetThreshold').value);
        const msgEl = wrapper.querySelector('#budgetMsg');
        if (!materialId || isNaN(qty) || qty <= 0) {
            msgEl.style.color = '#c0392b';
            msgEl.textContent = 'Please select a material and enter a valid budget qty.';
            return;
        }
        try {
            await apiPost('/api/material-budgets', {
                venture_id: invVenture.id,
                material_id: materialId,
                budget_qty: qty,
                budget_value: value || 0,
                alert_threshold_pct: threshold || 80
            });
            msgEl.style.color = '#27ae60';
            msgEl.textContent = 'Budget saved successfully.';
            renderInventoryView();
        } catch (err) {
            msgEl.style.color = '#c0392b';
            msgEl.textContent = err.message || 'Failed to save budget.';
        }
    });

    // Load existing budgets
    const tbody = wrapper.querySelector('#budgetListBody');
    (async () => {
        try {
            const budgets = await apiGet('/api/material-budgets?venture_id=' + encodeURIComponent(invVenture.id)) || [];
        if (budgets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:24px;">No budgets set yet.</td></tr>';
        } else {
            budgets.forEach(b => {
                const mat = inventoryMaterials.find(m => m.id === b.material_id) || {};
                const balRow = inventoryBalance.find(bal => bal.material_id === b.material_id) || {};
                const consumed = parseFloat(balRow.total_used || 0);
                const pct = b.budget_qty > 0 ? Math.round((consumed / b.budget_qty) * 100) : 0;
                let statusHtml = '<span style="color:#27ae60;">OK</span>';
                if (pct >= (b.alert_threshold_pct || 80)) statusHtml = '<span style="color:#e74c3c;font-weight:600;">Over Budget Alert</span>';
                else if (pct >= 50) statusHtml = '<span style="color:#f39c12;">Approaching</span>';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(mat.name || b.material_id)}</td>
                    <td>${formatNumber(b.budget_qty)}</td>
                    <td>${b.budget_value ? '&#8377;' + formatNumber(b.budget_value) : '-'}</td>
                    <td>${b.alert_threshold_pct || 80}%</td>
                    <td>${formatNumber(consumed)} (${pct}%)</td>
                    <td>${statusHtml}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:24px;">Failed to load budgets.</td></tr>';
        }
    })();
}

// ========================
// Alerts Tab
// ========================
function renderInventoryAlerts(container) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<div class="grid-container"><table class="tracker-table"><thead><tr><th>Venture</th><th>Material</th><th>Type</th><th>Message</th><th>Created</th><th></th></tr></thead><tbody id="alertsBody"></tbody></table></div>';
    container.appendChild(wrapper);
    const tbody = wrapper.querySelector('#alertsBody');
    try {
        apiGet('/api/inventory/alerts').then(alerts => {
            if (!alerts || alerts.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:24px;">No active alerts.</td></tr>';
                return;
            }
            alerts.forEach(a => {
                const mat = inventoryMaterials.find(m => m.id === a.material_id) || {};
                const vent = venturesList.find(v => v.id === a.venture_id) || {};
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(vent.name || a.venture_id || '-')}</td>
                    <td>${escapeHtml(mat.name || a.material_id || '-')}</td>
                    <td><span class="inv-badge ${a.alert_type === 'low_stock' ? 'inv-out' : 'inv-adj'}">${escapeHtml(a.alert_type)}</span></td>
                    <td>${escapeHtml(a.message || '')}</td>
                    <td>${formatDate(a.created_at)}</td>
                    <td><button class="btn-text resolve-alert-btn" data-aid="${a.id}" style="font-size:0.78rem;">Resolve</button></td>
                `;
                tbody.appendChild(tr);
            });
            tbody.querySelectorAll('.resolve-alert-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await apiPost('/api/inventory/resolve-alert/' + btn.dataset.aid, {});
                        showToast('Alert resolved');
                        renderInventoryView();
                    } catch (err) {
                        showToast('Failed to resolve alert', true);
                    }
                });
            });
        }).catch(() => {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:24px;">Failed to load alerts.</td></tr>';
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:24px;">Failed to load alerts.</td></tr>';
    }
}

// ========================
// Creatable Select (Combobox)
// ========================
function initCreatableSelect(config) {
    const input = document.getElementById(config.inputId);
    const hidden = document.getElementById(config.hiddenId);
    const dropdown = document.getElementById(config.dropdownId);
    if (!input || !hidden || !dropdown) return;

    let items = config.getItems() || [];
    let highlightedIdx = -1;
    let currentSelection = null;

    function refreshItems() {
        items = config.getItems() || [];
    }

    function findExactMatch(query) {
        const q = query.trim().toLowerCase();
        return items.find(i => (config.getLabel(i) || '').trim().toLowerCase() === q);
    }

    function renderDropdown(query) {
        const q = (query || '').trim().toLowerCase();
        let filtered = items;
        if (q) {
            filtered = items.filter(i => (config.getLabel(i) || '').toLowerCase().includes(q));
        }
        let html = '';
        if (filtered.length > 0) {
            filtered.forEach((item, idx) => {
                const label = escapeHtml(config.getLabel(item));
                const sub = config.getSubLabel ? escapeHtml(config.getSubLabel(item) || '') : '';
                html += `<div class="creatable-option" data-idx="${idx}" data-id="${escapeHtml(item.id)}">${label}${sub ? ` <span class="create-label">${sub}</span>` : ''}</div>`;
            });
        }
        const exactExists = q && findExactMatch(query);
        if (q && !exactExists && config.canCreate) {
            html += `<div class="creatable-option create-option" data-create="1">+ Create "${escapeHtml(query.trim())}"</div>`;
        }
        if (!html) {
            html = '<div class="creatable-empty">No options</div>';
        }
        dropdown.innerHTML = html;
        highlightedIdx = -1;

        dropdown.querySelectorAll('.creatable-option').forEach(opt => {
            opt.addEventListener('mousedown', (e) => {
                e.preventDefault();
                if (opt.dataset.create === '1') {
                    handleCreate(query.trim());
                } else {
                    const item = filtered[parseInt(opt.dataset.idx)];
                    if (item) selectItem(item);
                }
            });
        });
    }

    function selectItem(item) {
        currentSelection = item;
        input.value = config.getLabel(item);
        hidden.value = item.id;
        dropdown.classList.remove('show');
        if (config.onSelect) config.onSelect(item);
    }

    function clearSelection() {
        currentSelection = null;
        hidden.value = '';
    }

    async function handleCreate(name) {
        const trimmed = name.trim();
        if (!trimmed) return;
        const existing = findExactMatch(trimmed);
        if (existing) {
            selectItem(existing);
            return;
        }
        input.disabled = true;
        input.value = 'Creating...';
        try {
            const newItem = await config.onCreate(trimmed);
            if (newItem) {
                refreshItems();
                selectItem(newItem);
                showToast(config.createLabel || 'Created successfully');
            }
        } catch (err) {
            let msg = err.message || 'Failed to create';
            try { const m = msg.match(/\{.*\}/); if (m) msg = JSON.parse(m[0]).error || msg; } catch (e2) {}
            showToast(msg, true);
            input.value = '';
            clearSelection();
        }
        input.disabled = false;
    }

    input.addEventListener('focus', () => {
        refreshItems();
        renderDropdown(input.value);
        dropdown.classList.add('show');
    });

    input.addEventListener('input', () => {
        clearSelection();
        renderDropdown(input.value);
        dropdown.classList.add('show');
    });

    input.addEventListener('keydown', (e) => {
        const opts = dropdown.querySelectorAll('.creatable-option');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIdx = Math.min(highlightedIdx + 1, opts.length - 1);
            updateHighlight(opts);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIdx = Math.max(highlightedIdx - 1, 0);
            updateHighlight(opts);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIdx >= 0 && opts[highlightedIdx]) {
                opts[highlightedIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            } else if (input.value.trim() && config.canCreate) {
                const exact = findExactMatch(input.value);
                if (exact) {
                    selectItem(exact);
                } else {
                    handleCreate(input.value.trim());
                }
            }
        } else if (e.key === 'Escape') {
            dropdown.classList.remove('show');
        }
    });

    function updateHighlight(opts) {
        opts.forEach((o, i) => o.classList.toggle('selected', i === highlightedIdx));
        if (highlightedIdx >= 0 && opts[highlightedIdx]) {
            opts[highlightedIdx].scrollIntoView({ block: 'nearest' });
        }
    }

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });

    return {
        setValue: function(item) {
            if (item) selectItem(item);
            else { input.value = ''; clearSelection(); }
        },
        getValue: function() { return hidden.value; },
        refresh: refreshItems
    };
}

// ========================
// Stock Entry Modal
// ========================
let materialCreatable = null;
let vendorCreatable = null;
let poCreatable = null;

function openStockEntryModal(entryId, defaultType) {
    inventoryEntryEditingId = entryId || null;
    document.getElementById('stockEntryTitle').textContent = entryId ? 'Edit Stock Entry' : 'New Stock Entry';
    document.getElementById('stockEntryType').value = defaultType || 'IN';
    document.getElementById('stockEntryDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('stockEntryQty').value = '';
    document.getElementById('stockEntryRemarks').value = '';

    const invVenture = inventoryActiveVenture();
    const isAdmin = currentUserRole === 'admin' || currentUserRole === 'manager';

    // Material creatable
    materialCreatable = initCreatableSelect({
        inputId: 'stockEntryMaterialInput',
        hiddenId: 'stockEntryMaterial',
        dropdownId: 'stockEntryMaterialDropdown',
        getItems: () => inventoryMaterials,
        getLabel: (m) => m.name,
        getSubLabel: (m) => `(${m.unit})`,
        canCreate: true,
        createLabel: 'Material created',
        onCreate: async (name) => {
            const newMat = {
                id: generateId(),
                venture_id: isAdmin ? null : invVenture.id,
                name: name,
                unit: 'pcs',
                min_threshold: 0
            };
            await apiPost('/api/material', newMat);
            inventoryMaterials.push(newMat);
            return newMat;
        }
    });

    // Vendor creatable
    vendorCreatable = initCreatableSelect({
        inputId: 'stockEntryVendorInput',
        hiddenId: 'stockEntryVendor',
        dropdownId: 'stockEntryVendorDropdown',
        getItems: () => allVendors,
        getLabel: (v) => v.name,
        canCreate: isAdmin,
        createLabel: 'Vendor created',
        onCreate: async (name) => {
            const newVendor = {
                id: generateId(),
                name: name,
                contact: '',
                phone: '',
                gst: ''
            };
            await apiPost('/api/vendor', newVendor);
            allVendors.push(newVendor);
            return newVendor;
        }
    });

    // PO creatable
    poCreatable = initCreatableSelect({
        inputId: 'stockEntryPOInput',
        hiddenId: 'stockEntryPO',
        dropdownId: 'stockEntryPODropdown',
        getItems: () => allPOs,
        getLabel: (p) => p.poNumber || p.id,
        getSubLabel: (p) => p.vendor ? `— ${p.vendor}` : '',
        canCreate: isAdmin,
        createLabel: 'Purchase order created',
        onCreate: async (name) => {
            const newPO = {
                id: generateId(),
                poNumber: name,
                venture_id: invVenture ? invVenture.id : '',
                vendor: '',
                date: new Date().toISOString().split('T')[0],
                items: [],
                status: 'open'
            };
            await apiPost('/api/po', newPO);
            allPOs.push(newPO);
            return newPO;
        }
    });

    // Populate invoice dropdown (stays as regular select)
    document.getElementById('stockEntryInvoice').innerHTML = '<option value="">-- Select Invoice --</option>';
    allInvoices.forEach(inv => {
        document.getElementById('stockEntryInvoice').innerHTML += `<option value="${inv.id}">${escapeHtml(inv.invoiceNumber || inv.id)}</option>`;
    });

    // Block & Floor selects (stay as regular selects)
    const blockSel = document.getElementById('stockEntryBlock');
    blockSel.innerHTML = '<option value="">-- Select Block --</option>';
    if (invVenture && invVenture.blocks) {
        invVenture.blocks.forEach(b => {
            blockSel.innerHTML += `<option value="${b.id}">${escapeHtml(b.name || b.id)}</option>`;
        });
    }
    const floorSel = document.getElementById('stockEntryFloor');
    floorSel.innerHTML = '<option value="">-- Select Floor --</option>';
    const blockForFloors = (invVenture && invVenture.blocks && invVenture.blocks[0]) ? invVenture.blocks[0] : null;
    const floors = blockForFloors ? (blockForFloors.floors || 5) : 5;
    const floorLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
    for (let f = 1; f <= floors; f++) {
        const label = floors === 1 ? 'Ground Floor' : `${floorLabels[f - 1] || f + 'th'} Floor`;
        floorSel.innerHTML += `<option value="${label}">${label}</option>`;
    }
    document.getElementById('stockEntryFlat').value = '';
    document.getElementById('stockEntryWorkItem').value = '';
    document.getElementById('stockEntryRate').value = '';

    if (entryId) {
        const entry = inventoryStockEntries.find(e => e.id === entryId);
        if (entry) {
            document.getElementById('stockEntryType').value = entry.entry_type || 'IN';
            document.getElementById('stockEntryDate').value = entry.entry_date || '';
            const mat = inventoryMaterials.find(m => m.id === entry.material_id);
            if (mat && materialCreatable) materialCreatable.setValue(mat);
            document.getElementById('stockEntryQty').value = entry.qty || '';
            document.getElementById('stockEntryRemarks').value = entry.remarks || '';
            const ven = allVendors.find(v => v.id === entry.vendor_id);
            if (ven && vendorCreatable) vendorCreatable.setValue(ven);
            document.getElementById('stockEntryRate').value = entry.rate || '';
            document.getElementById('stockEntryInvoice').value = entry.invoice_id || '';
            const po = allPOs.find(p => p.id === entry.po_id);
            if (po && poCreatable) poCreatable.setValue(po);
            document.getElementById('stockEntryBlock').value = entry.block || '';
            document.getElementById('stockEntryFloor').value = entry.floor || '';
            document.getElementById('stockEntryFlat').value = entry.flat || '';
            document.getElementById('stockEntryWorkItem').value = entry.work_item || '';
        }
    }

    updateStockEntryFields();
    document.getElementById('stockEntryModal').classList.add('show');
}

function updateStockEntryFields() {
    const type = document.getElementById('stockEntryType').value;
    document.getElementById('stockInFields').style.display = (type === 'IN' || type === 'ADJUST') ? '' : 'none';
    document.getElementById('stockOutFields').style.display = (type === 'OUT') ? '' : 'none';
}

function closeStockEntryModal() {
    document.getElementById('stockEntryModal').classList.remove('show');
    inventoryEntryEditingId = null;
}

function openMaterialModal(materialId) {
    inventoryMaterialEditingId = materialId || null;
    document.getElementById('materialTitle').textContent = 'Manage Materials';
    document.getElementById('materialFormTitle').textContent = materialId ? 'Edit Material' : 'Add New Material';
    document.getElementById('materialName').value = '';
    document.getElementById('materialCategory').value = '';
    document.getElementById('materialUnit').value = '';
    document.getElementById('materialThreshold').value = '0';

    const datalist = document.getElementById('materialCategoryList');
    datalist.innerHTML = '';
    const cats = new Set(inventoryMaterials.map(m => m.category).filter(Boolean));
    cats.forEach(c => {
        datalist.innerHTML += `<option value="${escapeHtml(c)}"></option>`;
    });

    const listContainer = document.getElementById('materialList');
    listContainer.innerHTML = '';
    if (inventoryMaterials.length === 0) {
        listContainer.innerHTML = '<div style="padding:12px;color:#999;font-size:0.85rem;">No materials added yet.</div>';
    } else {
        inventoryMaterials.forEach(mat => {
            const balRow = inventoryBalance.find(b => b.material_id === mat.id);
            const bal = balRow ? (parseFloat(balRow.balance) || 0) : 0;
            const threshold = parseFloat(mat.min_threshold) || 0;
            const totalIn = balRow ? (parseFloat(balRow.total_in) || 0) : 0;
            let stockClass = 'ok';
            let stockLabel = 'OK';
            if (bal <= 0) { stockClass = 'out'; stockLabel = 'Out of Stock'; }
            else if (threshold > 0 && bal <= threshold) { stockClass = 'low'; stockLabel = 'Low'; }
            const stockPct = totalIn > 0 ? Math.min(100, Math.round((bal / totalIn) * 100)) : (bal > 0 ? 100 : 0);

            const item = document.createElement('div');
            item.className = 'material-list-item' + (stockClass !== 'ok' ? ' low-stock' : '');
            item.innerHTML = `
                <div class="material-list-info">
                    <span class="material-list-name">${escapeHtml(mat.name)}</span>
                    <span class="material-list-meta">${escapeHtml(mat.category || 'Uncategorized')} | ${escapeHtml(mat.unit)} | threshold: ${mat.min_threshold || 0} | balance: ${formatNumber(bal)} (${stockLabel})</span>
                    <div class="material-stock-bar"><div class="material-stock-fill ${stockClass}" style="width:${stockPct}%"></div></div>
                </div>
                <div class="material-list-actions">
                    <button class="btn-text material-edit-btn" data-mid="${mat.id}" style="font-size:0.78rem;">Edit</button>
                    <button class="btn-text material-del-btn" data-mid="${mat.id}" style="font-size:0.78rem;color:#c0392b;">Delete</button>
                </div>
            `;
            listContainer.appendChild(item);
        });
    }

    listContainer.querySelectorAll('.material-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mat = inventoryMaterials.find(m => m.id === btn.dataset.mid);
            if (mat) {
                inventoryMaterialEditingId = mat.id;
                document.getElementById('materialFormTitle').textContent = 'Edit Material';
                document.getElementById('materialName').value = mat.name || '';
                document.getElementById('materialCategory').value = mat.category || '';
                document.getElementById('materialUnit').value = mat.unit || '';
                document.getElementById('materialThreshold').value = mat.min_threshold || '0';
            }
        });
    });
    listContainer.querySelectorAll('.material-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mat = inventoryMaterials.find(m => m.id === btn.dataset.mid);
            if (!mat) return;
            const hasEntries = inventoryStockEntries.some(e => e.material_id === mat.id);
            if (hasEntries) {
                showToast('Cannot delete material that has stock entries', true);
                return;
            }
            showConfirm('Delete Material', `Delete '${mat.name}'?`, async () => {
                try {
                    await apiDelete('/api/material/' + encodeURIComponent(mat.id));
                    inventoryMaterials = inventoryMaterials.filter(m => m.id !== mat.id);
                    openMaterialModal(null);
                    renderInventoryView();
                    showToast('Material deleted');
                } catch (err) {
                    showToast('Failed to delete material', true);
                }
            });
        });
    });

    if (materialId) {
        const mat = inventoryMaterials.find(m => m.id === materialId);
        if (mat) {
            document.getElementById('materialName').value = mat.name || '';
            document.getElementById('materialCategory').value = mat.category || '';
            document.getElementById('materialUnit').value = mat.unit || '';
            document.getElementById('materialThreshold').value = mat.min_threshold || '0';
        }
    }

    document.getElementById('materialModal').classList.add('show');
}

function closeMaterialModal() {
    document.getElementById('materialModal').classList.remove('show');
    inventoryMaterialEditingId = null;
}

document.getElementById('closeStockEntry').addEventListener('click', closeStockEntryModal);
document.getElementById('cancelStockEntry').addEventListener('click', closeStockEntryModal);
document.getElementById('stockEntryModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('stockEntryModal')) closeStockEntryModal();
});
document.getElementById('stockEntryType').addEventListener('change', updateStockEntryFields);

document.getElementById('saveStockEntry').addEventListener('click', async () => {
    const type = document.getElementById('stockEntryType').value;
    const materialId = document.getElementById('stockEntryMaterial').value;
    const qty = parseFloat(document.getElementById('stockEntryQty').value);
    const date = document.getElementById('stockEntryDate').value;

    if (!materialId) { showToast('Please select a material', true); return; }
    if (!date) { showToast('Please select a date', true); return; }
    if (isNaN(qty) || qty <= 0) { showToast('Please enter a valid quantity', true); return; }

    const rate = parseFloat(document.getElementById('stockEntryRate').value) || 0;
    if (type === 'IN' && rate <= 0) { showToast('Rate is required for Stock In entries', true); return; }
    const invVenture = inventoryActiveVenture();
    if (!invVenture) { showToast('No venture selected', true); return; }
    const entry = {
        id: inventoryEntryEditingId || generateId(),
        venture_id: invVenture.id,
        material_id: materialId,
        entry_type: type,
        qty: qty,
        entry_date: date,
        vendor_id: document.getElementById('stockEntryVendor').value || null,
        invoice_id: document.getElementById('stockEntryInvoice').value || null,
        po_id: document.getElementById('stockEntryPO').value || null,
        rate: rate || null,
        amount: rate ? (qty * rate) : null,
        block: document.getElementById('stockEntryBlock').value || null,
        floor: document.getElementById('stockEntryFloor').value || null,
        flat: document.getElementById('stockEntryFlat').value.trim() || null,
        work_item: document.getElementById('stockEntryWorkItem').value.trim() || null,
        remarks: document.getElementById('stockEntryRemarks').value.trim() || null,
        created_by: currentUser
    };

    try {
        await apiPost('/api/stock', entry);
        closeStockEntryModal();
        showToast('Stock entry saved');
        renderInventoryView();
    } catch (err) {
        console.error('Failed to save stock entry:', err);
        showToast('Failed to save stock entry', true);
    }
});

document.getElementById('closeMaterial').addEventListener('click', closeMaterialModal);
document.getElementById('cancelMaterial').addEventListener('click', closeMaterialModal);
document.getElementById('materialModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('materialModal')) closeMaterialModal();
});

document.getElementById('saveMaterial').addEventListener('click', async () => {
    const name = document.getElementById('materialName').value.trim();
    const unit = document.getElementById('materialUnit').value.trim();
    if (!name) { showToast('Please enter a material name', true); return; }
    if (!unit) { showToast('Please enter a unit', true); return; }

    const invVenture = inventoryActiveVenture();
    if (!invVenture) { showToast('No venture selected', true); return; }
    const isAdmin = currentUserRole === 'admin' || currentUserRole === 'manager';
    const material = {
        id: inventoryMaterialEditingId || generateId(),
        venture_id: isAdmin ? null : invVenture.id,
        name: name,
        category: document.getElementById('materialCategory').value.trim() || null,
        unit: unit,
        min_threshold: parseFloat(document.getElementById('materialThreshold').value) || 0
    };

    try {
        await apiPost('/api/material', material);
        closeMaterialModal();
        showToast('Material saved');
        renderInventoryView();
    } catch (err) {
        console.error('Failed to save material:', err);
        showToast('Failed to save material', true);
    }
});
