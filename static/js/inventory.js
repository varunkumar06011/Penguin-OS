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
let inventoryTab = 'materials';
let inventoryEntryEditingId = null;
let inventoryMaterialEditingId = null;
let selectedInventoryVenture = null;
let inventoryCategories = [];
let inventorySelectedCategory = null;
let inventorySelectedMaterialId = null;
let _inventoryCache = { ventureId: null, ts: 0 };
const _INVENTORY_CACHE_TTL = 30000; // 30 seconds
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
    return selectedInventoryVenture || currentVenture || WAREHOUSE_VENTURE;
}

const WAREHOUSE_VENTURE = { id: 'WAREHOUSE', name: 'Central Warehouse' };

function inventoryVentureList() {
    const list = [...venturesList];
    if (!list.some(v => v.id === 'WAREHOUSE')) {
        list.push(WAREHOUSE_VENTURE);
    }
    return list;
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

async function loadInventoryCategories(ventureId) {
    try {
        const params = ventureId ? '?venture_id=' + encodeURIComponent(ventureId) : '';
        return await apiGet('/api/materials/categories' + params) || [];
    } catch (e) { return []; }
}

async function renderInventoryView() {
    const container = document.getElementById('inventoryPanelContent');
    container.innerHTML = '';

    let venture = inventoryActiveVenture();
    if (!venture) {
        container.innerHTML = '<div style="padding:24px;color:#999;">No venture selected.</div>';
        return;
    }
    // Ensure the selected inventory venture reflects the active fallback
    if (!selectedInventoryVenture) {
        selectedInventoryVenture = venture;
    }

    const now = Date.now();
    const cacheValid = _inventoryCache.ventureId === venture.id && (now - _inventoryCache.ts) < _INVENTORY_CACHE_TTL;
    if (!cacheValid) {
        const [ventureMats, globalMats, stockEntries, balanceSummary, categories] = await Promise.all([
            loadInventoryMaterials(venture.id),
            loadGlobalMaterials(),
            loadInventoryStock(venture.id),
            loadInventorySummary(venture.id),
            loadInventoryCategories(venture.id)
        ]);
        inventoryMaterials = [...globalMats, ...ventureMats.filter(m => !globalMats.some(g => g.id === m.id))];
        inventoryStockEntries = stockEntries;
        inventoryBalance = balanceSummary;
        inventoryCategories = categories;
        _inventoryCache = { ventureId: venture.id, ts: now };
    }

    const isAdmin = currentUserRole === 'admin';

    // If an advanced tab is selected, render it with a back link
    if (inventoryTab !== 'materials' && inventoryTab !== 'daily-register') {
        const backBar = document.createElement('div');
        backBar.style.cssText = 'padding:12px 0;';
        backBar.innerHTML = `<button class="btn-text" id="invBackToSheet" style="font-size:0.85rem;padding:4px 8px;">&larr; Back to Inventory</button>`;
        container.appendChild(backBar);
        backBar.querySelector('#invBackToSheet').addEventListener('click', () => {
            inventoryTab = 'materials';
            inventorySelectedCategory = null;
            inventorySelectedMaterialId = null;
            renderInventoryView();
        });

        // Action bar for Stock In / Out (for certain tabs)
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

        const tabContent = document.createElement('div');
        container.appendChild(tabContent);
        if (inventoryTab === 'summary') renderInventorySummary(tabContent);
        else if (inventoryTab === 'register') renderInventoryRegister(tabContent);
        else if (inventoryTab === 'location') renderInventoryLocation(tabContent);
        else if (inventoryTab === 'vendor') renderInventoryVendor(tabContent);
        else if (inventoryTab === 'wastage') renderInventoryWastage(tabContent);
        else if (inventoryTab === 'transfers') renderInventoryTransfers(tabContent);
        else if (inventoryTab === 'budgets') renderInventoryBudgets(tabContent);
        else if (inventoryTab === 'alerts') renderInventoryAlerts(tabContent);
        return;
    }

    // If daily register tab is selected
    if (inventoryTab === 'daily-register') {
        const backBar = document.createElement('div');
        backBar.style.cssText = 'padding:12px 0;';
        backBar.innerHTML = `<button class="btn-text" id="invBackToSheet" style="font-size:0.85rem;padding:4px 8px;">&larr; Back to Inventory</button>`;
        container.appendChild(backBar);
        backBar.querySelector('#invBackToSheet').addEventListener('click', () => {
            inventoryTab = 'materials';
            renderInventoryView();
        });
        if (typeof renderInventoryRegisterView === 'function') renderInventoryRegisterView();
        else container.innerHTML += '<div style="padding:24px;color:#999;">Daily Register module not loaded.</div>';
        return;
    }

    // ===== Default: Sheet view (Venture → Category → Material → Ledger) =====

    // Header bar with venture dropdown + category dropdown + admin button
    const isPanel = !!selectedInventoryVenture;
    const header = document.createElement('div');
    header.className = 'pending-filter-bar';
    let ventureOptions = '';
    inventoryVentureList().forEach(v => {
        ventureOptions += `<option value="${v.id}" ${selectedInventoryVenture && selectedInventoryVenture.id === v.id ? 'selected' : ''}>${escapeHtml(v.name)}</option>`;
    });

    let categoryOptions = '<option value="">-- Select Category --</option>';
    inventoryCategories.forEach(c => {
        categoryOptions += `<option value="${escapeHtml(c)}" ${inventorySelectedCategory === c ? 'selected' : ''}>${escapeHtml(c)}</option>`;
    });

    header.innerHTML = `
        <div class="pending-filter-group">
            <label>Venture</label>
            ${isPanel
                ? `<select id="inventoryVentureSelect">${ventureOptions}</select>`
                : `<div class="pending-readonly">${escapeHtml(venture.name)}</div>`}
        </div>
        <div class="pending-filter-group">
            <label>Category</label>
            <select id="inventoryCategorySelect">${categoryOptions}</select>
        </div>
        ${isAdmin ? `<div class="pending-filter-group" style="align-self:flex-end;">
            <button id="inventoryAddMaterialBtn" class="btn-primary" style="padding:8px 16px;">+ New Inventory</button>
        </div>` : ''}
    `;
    container.appendChild(header);

    if (isPanel) {
        header.querySelector('#inventoryVentureSelect').addEventListener('change', (e) => {
            selectedInventoryVenture = inventoryVentureList().find(v => v.id === e.target.value) || null;
            inventorySelectedCategory = null;
            inventorySelectedMaterialId = null;
            renderInventoryView();
        });
    }
    header.querySelector('#inventoryCategorySelect').addEventListener('change', (e) => {
        inventorySelectedCategory = e.target.value || null;
        inventorySelectedMaterialId = null;
        const content = container.querySelector('.inv-content-area');
        if (content) {
            content.innerHTML = '';
            if (inventorySelectedMaterialId) {
                renderMaterialLedger(content, inventorySelectedMaterialId);
            } else if (inventorySelectedCategory) {
                renderCategoryMaterials(content, inventorySelectedCategory);
            } else {
                content.innerHTML = '<div style="padding:24px;color:#999;text-align:center;">Select a category above to view materials.</div>';
            }
        }
    });
    if (isAdmin) {
        header.querySelector('#inventoryAddMaterialBtn').addEventListener('click', () => openMaterialModal(null));
    }

    // Content area
    const content = document.createElement('div');
    content.className = 'inv-content-area';
    container.appendChild(content);

    if (inventorySelectedMaterialId) {
        renderMaterialLedger(content, inventorySelectedMaterialId);
    } else if (inventorySelectedCategory) {
        renderCategoryMaterials(content, inventorySelectedCategory);
    } else {
        content.innerHTML = '<div style="padding:24px;color:#999;text-align:center;">Select a category above to view materials.</div>';
    }

    // More reports link at the bottom
    const moreBar = document.createElement('div');
    moreBar.style.cssText = 'padding:16px 0;border-top:1px solid #eee;margin-top:16px;';
    moreBar.innerHTML = `
        <details>
            <summary style="cursor:pointer;color:#888;font-size:0.85rem;font-weight:600;">More reports &amp; tools</summary>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">
                <button class="btn-secondary inv-advanced-btn" data-tab="daily-register" style="padding:6px 14px;font-size:0.8rem;">Daily Register</button>
                <button class="btn-secondary inv-advanced-btn" data-tab="summary" style="padding:6px 14px;font-size:0.8rem;">Stock Summary</button>
                <button class="btn-secondary inv-advanced-btn" data-tab="register" style="padding:6px 14px;font-size:0.8rem;">Stock Register</button>
                <button class="btn-secondary inv-advanced-btn" data-tab="location" style="padding:6px 14px;font-size:0.8rem;">By Location</button>
                <button class="btn-secondary inv-advanced-btn" data-tab="vendor" style="padding:6px 14px;font-size:0.8rem;">By Vendor</button>
                <button class="btn-secondary inv-advanced-btn" data-tab="wastage" style="padding:6px 14px;font-size:0.8rem;">Wastage</button>
                <button class="btn-secondary inv-advanced-btn" data-tab="transfers" style="padding:6px 14px;font-size:0.8rem;">Transfers</button>
                <button class="btn-secondary inv-advanced-btn" data-tab="budgets" style="padding:6px 14px;font-size:0.8rem;">Budgets</button>
                <button class="btn-secondary inv-advanced-btn" data-tab="alerts" style="padding:6px 14px;font-size:0.8rem;">Alerts</button>
            </div>
        </details>
    `;
    container.appendChild(moreBar);

    moreBar.querySelectorAll('.inv-advanced-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            inventoryTab = btn.dataset.tab;
            renderInventoryView();
        });
    });
}

// ========================
// Category Materials view (shown when a category is selected from dropdown)
// ========================
function renderCategoryMaterials(container, category) {
    const isAdmin = currentUserRole === 'admin';
    const matsInCat = inventoryMaterials.filter(m => m.category === category);

    const wrapper = document.createElement('div');
    wrapper.style.padding = '16px 0';

    // Breadcrumb + actions
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;';
    topRow.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
            <button class="btn-text inv-back-btn" style="font-size:0.85rem;padding:4px 8px;">&larr; All Categories</button>
            <h3 style="margin:0;font-size:1.1rem;color:#1a2a6c;">${escapeHtml(category)}</h3>
        </div>
    `;
    if (isAdmin) {
        const addBtn = document.createElement('button');
        addBtn.className = 'btn-primary';
        addBtn.style.cssText = 'padding:8px 16px;font-size:0.85rem;';
        addBtn.textContent = '+ Add Material to this category';
        addBtn.addEventListener('click', () => {
            inventoryMaterialEditingId = null;
            document.getElementById('materialFormTitle').textContent = 'Add New Material';
            document.getElementById('materialName').value = '';
            document.getElementById('materialCategory').value = category;
            document.getElementById('materialUnit').value = '';
            document.getElementById('materialThreshold').value = '0';
            openMaterialModal(null);
            // Pre-fill category after modal opens
            setTimeout(() => { document.getElementById('materialCategory').value = category; }, 50);
        });
        topRow.appendChild(addBtn);
    }
    wrapper.appendChild(topRow);

    topRow.querySelector('.inv-back-btn').addEventListener('click', () => {
        inventorySelectedCategory = null;
        const content = document.querySelector('.inv-content-area');
        if (content) {
            content.innerHTML = '<div style="padding:24px;color:#999;text-align:center;">Select a category above to view materials.</div>';
        }
        const catSelect = document.getElementById('inventoryCategorySelect');
        if (catSelect) catSelect.value = '';
    });

    // Materials table
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    const table = document.createElement('table');
    table.className = 'tracker-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>S.No</th>
                <th>Material</th>
                <th>Sub-Type</th>
                <th>Unit</th>
                <th>Purchased</th>
                <th>Used</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    if (matsInCat.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#999;padding:24px;">No materials in this category yet.'
            + (isAdmin ? ' Click "+ Add Material to this category" to create one.' : '') + '</td></tr>';
    } else {
        matsInCat.forEach((mat, idx) => {
            const balRow = inventoryBalance.find(b => b.material_id === mat.id) || {};
            const bal = parseFloat(balRow.balance) || 0;
            const threshold = parseFloat(mat.min_threshold) || 0;
            let statusHtml = '<span style="color:#27ae60;font-weight:600;">OK</span>';
            if (bal <= 0) statusHtml = '<span style="color:#e74c3c;font-weight:600;">Out of Stock</span>';
            else if (threshold > 0 && bal <= threshold) statusHtml = '<span style="color:#f39c12;font-weight:600;">Low</span>';

            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.innerHTML = `
                <td data-label="S.No">${idx + 1}</td>
                <td data-label="Material" style="font-weight:600;color:#1a2a6c;">${escapeHtml(mat.name)}</td>
                <td data-label="Sub-Type">${mat.sub_type ? escapeHtml(mat.sub_type) : '-'}</td>
                <td data-label="Unit">${escapeHtml(mat.unit || '-')}</td>
                <td data-label="Purchased">${formatNumber(balRow.total_in)}</td>
                <td data-label="Used">${formatNumber(balRow.total_out)}</td>
                <td data-label="Balance" style="font-weight:700;">${formatNumber(bal)}</td>
                <td data-label="Status">${statusHtml}</td>
                <td data-label="Actions"><button class="btn-text inv-view-ledger-btn" data-mid="${mat.id}" style="font-size:0.78rem;">View Ledger</button></td>
            `;
            tr.addEventListener('click', (e) => {
                if (e.target.classList.contains('inv-view-ledger-btn')) return;
                inventorySelectedMaterialId = mat.id;
                const content = document.querySelector('.inv-content-area');
                if (content) { content.innerHTML = ''; renderMaterialLedger(content, mat.id); }
            });
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.inv-view-ledger-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                inventorySelectedMaterialId = btn.dataset.mid;
                const content = document.querySelector('.inv-content-area');
                if (content) { content.innerHTML = ''; renderMaterialLedger(content, btn.dataset.mid); }
            });
        });
    }

    tableWrapper.appendChild(table);
    wrapper.appendChild(tableWrapper);
    container.appendChild(wrapper);
}

function formatPurpose(row) {
    const parts = [];
    const purposeVid = row.purpose_venture_id;
    if (purposeVid) {
        const vList = inventoryVentureList();
        const v = vList.find(x => x.id === purposeVid);
        if (v) parts.push(v.name);
    }
    if (row.flat) parts.push('Flat ' + row.flat);
    if (row.work_item) parts.push(row.work_item);
    if (row.remarks) parts.push(row.remarks);
    return parts.length > 0 ? escapeHtml(parts.join(' / ')) : '-';
}

function renderMaterialLedger(container, materialId) {
    const mat = inventoryMaterials.find(m => m.id === materialId);
    if (!mat) {
        inventorySelectedMaterialId = null;
        renderInventoryView();
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.style.padding = '16px 0';

    // Breadcrumb
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;';
    const category = mat.category || 'Uncategorized';
    const canEdit = currentUserRole === 'admin' || currentUserRole === 'supervisor';
    topRow.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
            <button class="btn-text inv-back-cat-btn" style="font-size:0.85rem;padding:4px 8px;">&larr; ${escapeHtml(category)}</button>
            <h3 style="margin:0;font-size:1.1rem;color:#1a2a6c;">${escapeHtml(mat.name)}</h3>
            ${mat.sub_type ? `<span style="font-size:0.75rem;padding:2px 8px;border-radius:10px;background:#e8ecf1;color:#1a2a6c;">${escapeHtml(mat.sub_type)}</span>` : ''}
            <span style="font-size:0.8rem;color:#888;">${escapeHtml(mat.unit || '')}</span>
        </div>
        ${canEdit ? `<button id="invNextEntryBtn" class="btn-primary" style="padding:8px 16px;font-size:0.85rem;">+ Next Entry</button>` : ''}
    `;
    if (canEdit) {
        topRow.querySelector('#invNextEntryBtn').addEventListener('click', () => openNextEntryModal(mat));
    }
    wrapper.appendChild(topRow);

    topRow.querySelector('.inv-back-cat-btn').addEventListener('click', () => {
        inventorySelectedMaterialId = null;
        const content = document.querySelector('.inv-content-area');
        if (content) {
            content.innerHTML = '';
            if (inventorySelectedCategory) {
                renderCategoryMaterials(content, inventorySelectedCategory);
            } else {
                content.innerHTML = '<div style="padding:24px;color:#999;text-align:center;">Select a category above to view materials.</div>';
            }
        }
    });

    // Build ledger from stock entries for this material
    const entries = inventoryStockEntries
        .filter(e => e.material_id === materialId)
        .sort((a, b) => (a.entry_date || '').localeCompare(b.entry_date || ''));

    // Compute running ledger: S.NO, Date, Opening, Purchase, Total, Usage, Balance
    let runningBalance = 0;
    const ledgerRows = entries.map((e, idx) => {
        const opening = runningBalance;
        const purchase = e.entry_type === 'IN' ? (parseFloat(e.qty) || 0) : 0;
        const adjust = e.entry_type === 'ADJUST' ? (parseFloat(e.qty) || 0) : 0;
        const usage = e.entry_type === 'OUT' ? (parseFloat(e.qty) || 0) : 0;
        const total = opening + purchase + adjust;
        runningBalance = total - usage;
        return {
            id: e.id,
            sno: idx + 1,
            date: e.entry_date,
            material_id: e.material_id,
            opening,
            purchase,
            total,
            usage,
            balance: runningBalance,
            entry_type: e.entry_type,
            remarks: e.remarks || '',
            work_item: e.work_item || '',
            purpose_venture_id: e.purpose_venture_id || e.venture_id || '',
            flat: e.flat || '',
        };
    });

    // Summary card
    const balRow = inventoryBalance.find(b => b.material_id === materialId) || {};
    const currentBalance = parseFloat(balRow.balance) || 0;
    const threshold = parseFloat(mat.min_threshold) || 0;
    let statusLabel = 'OK';
    let statusColor = '#27ae60';
    if (currentBalance <= 0) { statusLabel = 'Out of Stock'; statusColor = '#e74c3c'; }
    else if (threshold > 0 && currentBalance <= threshold) { statusLabel = 'Low'; statusColor = '#f39c12'; }

    const summaryCard = document.createElement('div');
    summaryCard.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;';
    summaryCard.innerHTML = `
        <div style="background:var(--card-bg,#fff);border:1px solid #e8ecf0;border-radius:8px;padding:12px 20px;flex:1;min-width:140px;">
            <div style="font-size:0.75rem;color:#888;">Current Balance</div>
            <div style="font-size:1.4rem;font-weight:700;color:${statusColor};">${formatNumber(currentBalance)} ${escapeHtml(mat.unit || '')}</div>
        </div>
        <div style="background:var(--card-bg,#fff);border:1px solid #e8ecf0;border-radius:8px;padding:12px 20px;flex:1;min-width:140px;">
            <div style="font-size:0.75rem;color:#888;">Total Purchased</div>
            <div style="font-size:1.4rem;font-weight:700;color:#27ae60;">${formatNumber(balRow.total_in)}</div>
        </div>
        <div style="background:var(--card-bg,#fff);border:1px solid #e8ecf0;border-radius:8px;padding:12px 20px;flex:1;min-width:140px;">
            <div style="font-size:0.75rem;color:#888;">Total Used</div>
            <div style="font-size:1.4rem;font-weight:700;color:#e74c3c;">${formatNumber(balRow.total_out)}</div>
        </div>
        <div style="background:var(--card-bg,#fff);border:1px solid #e8ecf0;border-radius:8px;padding:12px 20px;flex:1;min-width:140px;">
            <div style="font-size:0.75rem;color:#888;">Status</div>
            <div style="font-size:1.4rem;font-weight:700;color:${statusColor};">${statusLabel}</div>
        </div>
    `;
    wrapper.appendChild(summaryCard);

    // Ledger table: S.NO, Date, Opening, Purchase, Total, Usage, Balance
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    const table = document.createElement('table');
    table.className = 'tracker-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>S.NO</th>
                <th>Date</th>
                <th>Opening</th>
                <th>Purchase</th>
                <th>Total</th>
                <th>Usage</th>
                <th>Balance</th>
                <th>Purpose</th>
                <th>Action</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    if (ledgerRows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#999;padding:24px;">No ledger entries for this material yet.</td></tr>';
    } else {
        ledgerRows.forEach(row => {
            const badgeClass = row.entry_type === 'IN' ? 'inv-in' : row.entry_type === 'OUT' ? 'inv-out' : 'inv-adj';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td data-label="S.NO">${row.sno}</td>
                <td data-label="Date">${formatDate(row.date)}</td>
                <td data-label="Opening">${formatNumber(row.opening)}</td>
                <td data-label="Purchase">${row.purchase > 0 ? formatNumber(row.purchase) : '-'}</td>
                <td data-label="Total">${formatNumber(row.total)}</td>
                <td data-label="Usage">
                    ${row.usage > 0 ? formatNumber(row.usage) : '-'}
                    ${canEdit && row.usage > 0 ? `<button class="btn-text edit-usage-btn" data-id="${row.id || ''}" style="margin-left:6px;font-size:0.75rem;" title="Edit usage">&#9998;</button>` : ''}
                </td>
                <td data-label="Balance" style="font-weight:700;">${formatNumber(row.balance)}</td>
                <td data-label="Purpose" style="font-size:0.8rem;">${formatPurpose(row)}</td>
                <td data-label="Action">${canEdit ? `<button class="btn-text add-usage-btn" data-date="${row.date}" data-material="${row.material_id || inventorySelectedMaterialId}" style="font-size:0.75rem;color:#2980b9;" title="Add new usage purpose">+ Usage</button>` : ''}</td>
            `;
            tbody.appendChild(tr);
        });
        tbody.querySelectorAll('.edit-usage-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const entryId = btn.dataset.id;
                const entry = inventoryStockEntries.find(x => x.id === entryId);
                if (entry) openEditUsageModal(entry);
            });
        });
        tbody.querySelectorAll('.add-usage-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openAddUsageModal(btn.dataset.material, btn.dataset.date);
            });
        });
    }

    tableWrapper.appendChild(table);
    wrapper.appendChild(tableWrapper);
    container.appendChild(wrapper);
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
    const isAdmin = currentUserRole === 'admin';

    // Material creatable
    materialCreatable = initCreatableSelect({
        inputId: 'stockEntryMaterialInput',
        hiddenId: 'stockEntryMaterial',
        dropdownId: 'stockEntryMaterialDropdown',
        getItems: () => inventoryMaterials,
        getLabel: (m) => m.name,
        getSubLabel: (m) => `(${m.unit})`,
        canCreate: isAdmin,
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

async function openMaterialModal(materialId) {
    inventoryMaterialEditingId = materialId || null;
    document.getElementById('materialTitle').textContent = 'Manage Materials';
    document.getElementById('materialFormTitle').textContent = materialId ? 'Edit Material' : 'Add New Material';
    document.getElementById('materialName').value = '';
    document.getElementById('materialCategory').value = '';
    document.getElementById('materialUnit').value = '';
    document.getElementById('materialThreshold').value = '0';
    document.getElementById('materialSubType').value = '';

    // Load inventory categories with types for sub-type dropdown
    let invCats = [];
    try {
        invCats = await apiGet('/api/inventory-categories') || [];
    } catch (e) { invCats = []; }
    const subTypeSelect = document.getElementById('materialSubType');
    subTypeSelect.innerHTML = '<option value="">-- None --</option>';
    invCats.forEach(cat => {
        const types = cat.types || [];
        if (types.length > 0) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = cat.name;
            types.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.name;
                opt.textContent = t.name;
                optgroup.appendChild(opt);
            });
            subTypeSelect.appendChild(optgroup);
        }
    });

    const datalist = document.getElementById('materialCategoryList');
    datalist.innerHTML = '';
    const cats = new Set([
        ...invCats.map(c => c.name),
        ...(inventoryCategories || []),
        ...inventoryMaterials.map(m => m.category).filter(Boolean)
    ]);
    Array.from(cats).sort().forEach(c => {
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
                    <span class="material-list-meta">${escapeHtml(mat.category || 'Uncategorized')}${mat.sub_type ? ' &gt; ' + escapeHtml(mat.sub_type) : ''} | ${escapeHtml(mat.unit)} | threshold: ${mat.min_threshold || 0} | balance: ${formatNumber(bal)} (${stockLabel})</span>
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
                document.getElementById('materialSubType').value = mat.sub_type || '';
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
            }, null, 'Delete', true);
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

let nextEntryVendorCreatable = null;
let editingUsageEntry = null;

function openNextEntryModal(mat) {
    if (!mat) return;
    const venture = inventoryActiveVenture();
    if (!venture) { showToast('No venture selected', true); return; }

    const canEdit = currentUserRole === 'admin' || currentUserRole === 'supervisor';
    if (!canEdit) { showToast('Only admin or supervisor can create entries', true); return; }

    // Determine previous closing balance for this material
    const entries = inventoryStockEntries
        .filter(e => e.material_id === mat.id)
        .sort((a, b) => (a.entry_date || '').localeCompare(b.entry_date || ''));
    let opening = 0;
    entries.forEach(e => {
        const qty = parseFloat(e.qty) || 0;
        if (e.entry_type === 'IN') opening += qty;
        else if (e.entry_type === 'OUT') opening -= qty;
        else if (e.entry_type === 'ADJUST') opening += qty;
    });

    document.getElementById('nextEntryTitle').textContent = 'Next Entry — ' + escapeHtml(mat.name);
    document.getElementById('nextEntryMaterialId').value = mat.id;
    document.getElementById('nextEntryMaterialDisplay').textContent = escapeHtml(mat.name) + ' (' + escapeHtml(mat.unit || 'pcs') + ')';
    document.getElementById('nextEntryDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('nextEntryOpening').value = opening;
    document.getElementById('nextEntryPurchase').value = '';
    document.getElementById('nextEntryTotal').value = opening;
    document.getElementById('nextEntryUsage').value = '';
    document.getElementById('nextEntryClosing').value = opening;
    document.getElementById('nextEntryRemarks').value = '';
    document.getElementById('nextEntryRate').value = '';
    document.getElementById('nextEntryInvoiceNo').value = '';
    document.getElementById('nextEntryIsGst').value = 'false';

    // Reset purpose list and add one default row
    const purposeList = document.getElementById('nextEntryPurposeList');
    purposeList.innerHTML = '';
    document.getElementById('nextEntryPurposeEmpty').style.display = '';
    addNextEntryPurposeRow();

    nextEntryVendorCreatable = initCreatableSelect({
        inputId: 'nextEntryVendorInput',
        hiddenId: 'nextEntryVendor',
        dropdownId: 'nextEntryVendorDropdown',
        getItems: () => allVendors,
        getLabel: (v) => v.name,
        canCreate: currentUserRole === 'admin',
        createLabel: 'Vendor created',
        onCreate: async (name) => {
            const newVendor = { id: generateId(), name: name, contact: '', phone: '', gst: '' };
            await apiPost('/api/vendor', newVendor);
            allVendors.push(newVendor);
            return newVendor;
        }
    });

    recalcNextEntryTotals();
    document.getElementById('nextEntryModal').classList.add('show');
}

function closeNextEntryModal() {
    document.getElementById('nextEntryModal').classList.remove('show');
    nextEntryVendorCreatable = null;
}

function recalcNextEntryTotals() {
    const opening = parseFloat(document.getElementById('nextEntryOpening').value) || 0;
    const purchase = parseFloat(document.getElementById('nextEntryPurchase').value) || 0;
    const total = opening + purchase;

    let usage = 0;
    document.querySelectorAll('.next-entry-purpose-qty').forEach(input => {
        usage += parseFloat(input.value) || 0;
    });

    const closing = total - usage;
    document.getElementById('nextEntryTotal').value = total;
    document.getElementById('nextEntryUsage').value = usage;
    document.getElementById('nextEntryClosing').value = closing;
}

function addNextEntryPurposeRow(defaults) {
    const list = document.getElementById('nextEntryPurposeList');
    const emptyMsg = document.getElementById('nextEntryPurposeEmpty');
    if (emptyMsg) emptyMsg.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'invoice-form-row next-entry-purpose-row';
    const idx = list.children.length;
    const activeVenture = inventoryActiveVenture();

    const vOptions = inventoryVentureList().map(v => {
        const sel = defaults && defaults.venture_id === v.id ? 'selected' : (!defaults && activeVenture && activeVenture.id === v.id ? 'selected' : '');
        return `<option value="${v.id}" ${sel}>${escapeHtml(v.name)}</option>`;
    }).join('');

    row.innerHTML = `
        <div class="invoice-form-field">
            <label>Venture</label>
            <select class="next-entry-purpose-venture">${vOptions}</select>
        </div>
        <div class="invoice-form-field" style="max-width:90px;">
            <label>Flat No</label>
            <input type="text" class="next-entry-purpose-flat" placeholder="e.g. 101" value="${escapeHtml(defaults && defaults.flat || '')}">
        </div>
        <div class="invoice-form-field" style="flex:1.5;">
            <label>Purpose / Work</label>
            <input type="text" class="next-entry-purpose-work" placeholder="e.g. Plastering" value="${escapeHtml(defaults && defaults.work_item || '')}">
        </div>
        <div class="invoice-form-field" style="max-width:100px;">
            <label>Qty Used</label>
            <input type="number" class="next-entry-purpose-qty" min="0" step="0.01" value="${defaults && defaults.qty ? defaults.qty : ''}">
        </div>
        <div class="invoice-form-field" style="flex:1;">
            <label>Remarks</label>
            <input type="text" class="next-entry-purpose-remarks" placeholder="Optional" value="${escapeHtml(defaults && defaults.remarks || '')}">
        </div>
        <div class="invoice-form-field" style="max-width:40px;justify-content:flex-end;">
            <label>&nbsp;</label>
            <button type="button" class="btn-icon remove-purpose-row" title="Remove" style="background:none;border:none;color:#c0392b;font-size:1.2rem;cursor:pointer;">&times;</button>
        </div>
    `;

    list.appendChild(row);

    row.querySelector('.next-entry-purpose-qty').addEventListener('input', recalcNextEntryTotals);
    row.querySelector('.remove-purpose-row').addEventListener('click', () => {
        row.remove();
        if (list.children.length === 0 && emptyMsg) emptyMsg.style.display = '';
        recalcNextEntryTotals();
    });

    recalcNextEntryTotals();
}

function openEditUsageModal(entry) {
    if (!entry) return;
    const canEdit = currentUserRole === 'admin' || currentUserRole === 'supervisor';
    if (!canEdit) { showToast('Only admin or supervisor can edit usage', true); return; }
    editingUsageEntry = entry;

    const newQty = prompt('Edit usage quantity:', entry.qty || '');
    if (newQty === null) { editingUsageEntry = null; return; }
    const qty = parseFloat(newQty);
    if (isNaN(qty) || qty < 0) { showToast('Invalid quantity', true); editingUsageEntry = null; return; }

    const updated = { ...entry, qty: qty };
    apiPost('/api/stock', updated)
        .then(() => {
            showToast('Usage updated');
            renderInventoryView();
        })
        .catch(err => {
            console.error('Failed to update usage:', err);
            showToast('Failed to update usage', true);
        })
        .finally(() => { editingUsageEntry = null; });
}

function openAddUsageModal(materialId, date) {
    const canEdit = currentUserRole === 'admin' || currentUserRole === 'supervisor';
    if (!canEdit) { showToast('Only admin or supervisor can add usage', true); return; }
    const mat = inventoryMaterials.find(m => m.id === materialId);
    if (!mat) { showToast('Material not found', true); return; }

    document.getElementById('addUsageMaterialId').value = materialId;
    document.getElementById('addUsageDate').value = date;
    document.getElementById('addUsageMaterialName').textContent = mat.name + ' (' + (mat.unit || 'pcs') + ')';
    document.getElementById('addUsageDateDisplay').textContent = formatDate(date);
    document.getElementById('addUsageFlat').value = '';
    document.getElementById('addUsageWorkItem').value = '';
    document.getElementById('addUsageQty').value = '';
    document.getElementById('addUsageRemarks').value = '';

    // Populate venture dropdown
    const vSel = document.getElementById('addUsageVenture');
    const vList = inventoryVentureList();
    const active = inventoryActiveVenture();
    vSel.innerHTML = vList.map(v => {
        const sel = active && active.id === v.id ? 'selected' : '';
        return `<option value="${v.id}" ${sel}>${escapeHtml(v.name)}</option>`;
    }).join('');

    document.getElementById('addUsageModal').classList.add('show');
}

function closeAddUsageModal() {
    const m = document.getElementById('addUsageModal');
    if (m) m.classList.remove('show');
}

(function() {
    const closeBtn = document.getElementById('closeAddUsage');
    const cancelBtn = document.getElementById('cancelAddUsage');
    const modal = document.getElementById('addUsageModal');
    const saveBtn = document.getElementById('saveAddUsage');
    if (closeBtn) closeBtn.addEventListener('click', closeAddUsageModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeAddUsageModal);
    if (modal) modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAddUsageModal();
    });
    if (saveBtn) saveBtn.addEventListener('click', async () => {
        const materialId = document.getElementById('addUsageMaterialId').value;
        const date = document.getElementById('addUsageDate').value;
        const qty = parseFloat(document.getElementById('addUsageQty').value) || 0;
        const ventureId = document.getElementById('addUsageVenture').value;
        const flat = document.getElementById('addUsageFlat').value.trim() || null;
        const workItem = document.getElementById('addUsageWorkItem').value.trim() || null;
        const remarks = document.getElementById('addUsageRemarks').value.trim() || null;

        if (!materialId || !date) { showToast('Missing material or date', true); return; }
        if (qty <= 0) { showToast('Quantity must be greater than 0', true); return; }
        if (!ventureId) { showToast('Please select a venture', true); return; }

        const entry = {
            id: generateId(),
            venture_id: ventureId,
            material_id: materialId,
            entry_type: 'OUT',
            qty: qty,
            entry_date: date,
            remarks: remarks,
            work_item: workItem,
            purpose_venture_id: ventureId,
            flat: flat,
            created_by: currentUser
        };

        try {
            await apiPost('/api/stock', entry);
            closeAddUsageModal();
            showToast('Usage added');
            renderInventoryView();
        } catch (err) {
            console.error('Failed to add usage:', err);
            showToast('Failed to add usage', true);
        }
    });
})();

document.getElementById('closeNextEntry').addEventListener('click', closeNextEntryModal);
document.getElementById('cancelNextEntry').addEventListener('click', closeNextEntryModal);
document.getElementById('nextEntryModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('nextEntryModal')) closeNextEntryModal();
});
document.getElementById('nextEntryPurchase').addEventListener('input', recalcNextEntryTotals);
document.getElementById('addNextEntryPurpose').addEventListener('click', () => addNextEntryPurposeRow());

document.getElementById('saveNextEntry').addEventListener('click', async () => {
    const materialId = document.getElementById('nextEntryMaterialId').value;
    const date = document.getElementById('nextEntryDate').value;
    const purchase = parseFloat(document.getElementById('nextEntryPurchase').value) || 0;
    const usage = parseFloat(document.getElementById('nextEntryUsage').value) || 0;
    const notes = document.getElementById('nextEntryRemarks').value.trim() || null;

    if (!materialId) { showToast('Material missing', true); return; }
    if (!date) { showToast('Please select a date', true); return; }

    const venture = inventoryActiveVenture();
    if (!venture) { showToast('No venture selected', true); return; }
    const mat = inventoryMaterials.find(m => m.id === materialId);

    const entries = [];
    const rate = parseFloat(document.getElementById('nextEntryRate').value) || 0;
    const vendorId = document.getElementById('nextEntryVendor').value || null;
    const invoiceNo = document.getElementById('nextEntryInvoiceNo').value.trim() || null;
    const isGst = document.getElementById('nextEntryIsGst').value === 'true';

    // Validate purchase rate if purchase entered
    if (purchase > 0 && rate <= 0) { showToast('Rate is required when purchase > 0', true); return; }

    // Add purchase IN entry
    if (purchase > 0) {
        entries.push({
            id: generateId(),
            venture_id: venture.id,
            material_id: materialId,
            entry_type: 'IN',
            qty: purchase,
            entry_date: date,
            vendor_id: vendorId,
            rate: rate,
            amount: purchase * rate,
            remarks: notes,
            created_by: currentUser
        });
    }

    // Add OUT entry for each purpose row
    const purposeRows = document.querySelectorAll('.next-entry-purpose-row');
    purposeRows.forEach(row => {
        const qty = parseFloat(row.querySelector('.next-entry-purpose-qty').value) || 0;
        if (qty <= 0) return;
        entries.push({
            id: generateId(),
            venture_id: venture.id,
            material_id: materialId,
            entry_type: 'OUT',
            qty: qty,
            entry_date: date,
            remarks: row.querySelector('.next-entry-purpose-remarks').value.trim() || notes,
            work_item: row.querySelector('.next-entry-purpose-work').value.trim() || null,
            purpose_venture_id: row.querySelector('.next-entry-purpose-venture').value || null,
            flat: row.querySelector('.next-entry-purpose-flat').value.trim() || null,
            created_by: currentUser
        });
    });

    if (entries.length === 0) { showToast('Enter purchase or at least one usage purpose', true); return; }

    try {
        await apiPost('/api/stock/next-entry', {
            venture_id: venture.id,
            material_id: materialId,
            material_name: mat ? mat.name : '',
            unit: mat ? (mat.unit || 'pcs') : 'pcs',
            entry_date: date,
            purchase: purchase,
            usage: usage,
            rate: rate || null,
            vendor_id: vendorId,
            invoice_no: invoiceNo,
            is_gst: isGst,
            remarks: notes,
            entries: entries
        });
        closeNextEntryModal();
        showToast('Entry saved');
        renderInventoryView();
    } catch (err) {
        console.error('Failed to save next entry:', err);
        showToast('Failed to save entry', true);
    }
});

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
    if (currentUserRole !== 'admin') { showToast('Only admins can create or modify materials', true); return; }
    const name = document.getElementById('materialName').value.trim();
    const unit = document.getElementById('materialUnit').value.trim();
    if (!name) { showToast('Please enter a material name', true); return; }
    if (!unit) { showToast('Please enter a unit', true); return; }

    const invVenture = inventoryActiveVenture();
    if (!invVenture) { showToast('No venture selected', true); return; }
    const material = {
        id: inventoryMaterialEditingId || generateId(),
        venture_id: null,
        name: name,
        category: document.getElementById('materialCategory').value.trim() || null,
        sub_type: document.getElementById('materialSubType').value || null,
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
