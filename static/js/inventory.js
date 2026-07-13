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
    `;
    container.appendChild(tabBar);

    tabBar.querySelectorAll('.inventory-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            inventoryTab = btn.dataset.tab;
            renderInventoryView();
        });
    });

    // Action bar for Stock In / Out
    const actionBar = document.createElement('div');
    actionBar.className = 'inventory-actions';
    actionBar.innerHTML = `
        <button id="inventoryStockInBtn" class="btn-primary" style="flex:1;max-width:220px;">+ Stock In</button>
        <button id="inventoryStockOutBtn" class="btn-secondary" style="flex:1;max-width:220px;">+ Stock Out</button>
    `;
    container.appendChild(actionBar);

    actionBar.querySelector('#inventoryStockInBtn').addEventListener('click', () => openStockEntryModal(null, 'IN'));
    actionBar.querySelector('#inventoryStockOutBtn').addEventListener('click', () => openStockEntryModal(null, 'OUT'));
    header.querySelector('#inventoryAddMaterialBtn').addEventListener('click', () => openMaterialModal(null));

    // Render selected tab
    const tabContent = document.createElement('div');
    tabContent.id = 'inventoryTabContent';
    container.appendChild(tabContent);

    if (inventoryTab === 'summary') renderInventorySummary(tabContent);
    else if (inventoryTab === 'register') renderInventoryRegister(tabContent);
    else if (inventoryTab === 'location') renderInventoryLocation(tabContent);
    else renderInventoryVendor(tabContent);
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

function openStockEntryModal(entryId, defaultType) {
    inventoryEntryEditingId = entryId || null;
    document.getElementById('stockEntryTitle').textContent = entryId ? 'Edit Stock Entry' : 'New Stock Entry';
    document.getElementById('stockEntryType').value = defaultType || 'IN';
    document.getElementById('stockEntryDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('stockEntryMaterial').innerHTML = '<option value="">-- Select Material --</option>';
    inventoryMaterials.forEach(m => {
        document.getElementById('stockEntryMaterial').innerHTML += `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.unit)})</option>`;
    });
    document.getElementById('stockEntryQty').value = '';
    document.getElementById('stockEntryRemarks').value = '';
    document.getElementById('stockEntryVendor').innerHTML = '<option value="">-- Select Vendor --</option>';
    loadVendors().forEach(v => {
        document.getElementById('stockEntryVendor').innerHTML += `<option value="${v.id}">${escapeHtml(v.name)}</option>`;
    });
    document.getElementById('stockEntryRate').value = '';
    document.getElementById('stockEntryInvoice').innerHTML = '<option value="">-- Select Invoice --</option>';
    allInvoices.forEach(inv => {
        document.getElementById('stockEntryInvoice').innerHTML += `<option value="${inv.id}">${escapeHtml(inv.invoiceNumber || inv.id)}</option>`;
    });
    document.getElementById('stockEntryPO').innerHTML = '<option value="">-- Select PO --</option>';
    allPOs.forEach(po => {
        document.getElementById('stockEntryPO').innerHTML += `<option value="${po.id}">${escapeHtml(po.poNumber || po.id)}</option>`;
    });

    const invVenture = inventoryActiveVenture();
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

    if (entryId) {
        const entry = inventoryStockEntries.find(e => e.id === entryId);
        if (entry) {
            document.getElementById('stockEntryType').value = entry.entry_type || 'IN';
            document.getElementById('stockEntryDate').value = entry.entry_date || '';
            document.getElementById('stockEntryMaterial').value = entry.material_id || '';
            document.getElementById('stockEntryQty').value = entry.qty || '';
            document.getElementById('stockEntryRemarks').value = entry.remarks || '';
            document.getElementById('stockEntryVendor').value = entry.vendor_id || '';
            document.getElementById('stockEntryRate').value = entry.rate || '';
            document.getElementById('stockEntryInvoice').value = entry.invoice_id || '';
            document.getElementById('stockEntryPO').value = entry.po_id || '';
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
    const material = {
        id: inventoryMaterialEditingId || generateId(),
        venture_id: invVenture.id,
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
