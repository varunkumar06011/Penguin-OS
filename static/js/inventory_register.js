// ============================================================
// Inventory Daily Register Module
// Fields: Date, Material, Category, Type, Flat/Unit,
//         Opening Stock, Stock Received (auto), Stock Used,
//         Closing Stock, Remarks
// Carry-forward: prev day closing = next day opening
// Stock Received auto from Day Book entries
// Closing Stock never negative
// ============================================================

var diRows = [];
var diMaterials = [];
var diCategories = [];
var diFilters = { material: 'all', category: 'all', type: 'all', flat: 'all', from: '', to: '' };
var diEditingId = null;

// --- Helpers ---

function diEscape(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function diFmtDate(d) {
    if (!d) return '\u2014';
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return d; }
}

function diParseError(e) {
    var msg = e.message || String(e);
    var m = msg.match(/HTTP \d+: (.+)/);
    if (m) {
        try { var j = JSON.parse(m[1]); if (j.error) return j.error; } catch (_) {}
        return m[1];
    }
    return msg;
}

// --- Data loading ---

async function diLoadMaterials() {
    try { diMaterials = await apiGet('/api/inventory-materials') || []; }
    catch (e) { diMaterials = []; }
}

async function diLoadCategories() {
    try { diCategories = await apiGet('/api/inventory-categories') || []; }
    catch (e) { diCategories = []; }
}

async function diLoadRows() {
    var params = new URLSearchParams();
    if (diFilters.material && diFilters.material !== 'all') params.set('material_name', diFilters.material);
    if (diFilters.category && diFilters.category !== 'all') params.set('category', diFilters.category);
    if (diFilters.type && diFilters.type !== 'all') params.set('category_type', diFilters.type);
    if (diFilters.from) params.set('from', diFilters.from);
    if (diFilters.to) params.set('to', diFilters.to);
    try { diRows = await apiGet('/api/daily-inventory?' + params.toString()) || []; }
    catch (e) { diRows = []; }
}

// --- Main render ---

async function renderInventoryRegisterView() {
    var container = document.getElementById('inventoryPanelContent');
    if (!container) return;
    container.innerHTML = '<div style="padding:24px;color:#999;">Loading...</div>';

    await Promise.all([diLoadMaterials(), diLoadCategories(), diLoadRows()]);
    renderDIFilters(container);
    renderDITable(container);
}

function renderDIFilters(container) {
    var filterBar = document.createElement('div');
    filterBar.className = 'pending-filter-bar';
    filterBar.style.marginBottom = '12px';

    var materialOpts = '<option value="all">All Materials</option>';
    diMaterials.forEach(function(m) {
        materialOpts += '<option value="' + diEscape(m.name) + '">' + diEscape(m.name) + '</option>';
    });

    var categoryOpts = '<option value="all">All Categories</option>';
    diCategories.forEach(function(c) {
        categoryOpts += '<option value="' + diEscape(c.name) + '">' + diEscape(c.name) + '</option>';
    });

    // Collect unique flat numbers from rows
    var flatSet = {};
    diRows.forEach(function(r) { if (r.flat_no) flatSet[r.flat_no] = true; });
    var flatOpts = '<option value="all">All Flats</option>';
    Object.keys(flatSet).sort().forEach(function(f) {
        flatOpts += '<option value="' + diEscape(f) + '">' + diEscape(f) + '</option>';
    });

    filterBar.innerHTML =
        '<div class="pending-filter-group"><label>From</label><input type="date" id="diFilterFrom"></div>' +
        '<div class="pending-filter-group"><label>To</label><input type="date" id="diFilterTo"></div>' +
        '<div class="pending-filter-group"><label>Material</label><select id="diFilterMaterial">' + materialOpts + '</select></div>' +
        '<div class="pending-filter-group"><label>Category</label><select id="diFilterCategory">' + categoryOpts + '</select></div>' +
        '<div class="pending-filter-group"><label>Type</label><select id="diFilterType"><option value="all">All Types</option></select></div>' +
        '<div class="pending-filter-group"><label>Flat / Unit</label><select id="diFilterFlat">' + flatOpts + '</select></div>' +
        '<div class="pending-filter-group" style="align-self:flex-end;"><button id="diFilterApply" class="btn-primary" style="padding:8px 16px;">Apply</button></div>' +
        '<div class="pending-filter-group" style="align-self:flex-end;"><button id="diFilterClear" class="btn-secondary" style="padding:8px 16px;">Clear</button></div>' +
        '<div class="pending-filter-group" style="align-self:flex-end;margin-left:auto;"><button id="diAddEntryBtn" class="btn-primary" style="padding:8px 16px;">+ Add Entry</button></div>';

    container.innerHTML = '';
    container.appendChild(filterBar);

    document.getElementById('diFilterMaterial').value = diFilters.material;
    document.getElementById('diFilterCategory').value = diFilters.category;
    document.getElementById('diFilterFlat').value = diFilters.flat;
    document.getElementById('diFilterFrom').value = diFilters.from;
    document.getElementById('diFilterTo').value = diFilters.to;

    // Update type dropdown based on selected category
    function updateTypeFilter() {
        var selCat = document.getElementById('diFilterCategory').value;
        var typeSelect = document.getElementById('diFilterType');
        var opts = '<option value="all">All Types</option>';
        if (selCat && selCat !== 'all') {
            var cat = diCategories.find(function(c) { return c.name === selCat; });
            if (cat && cat.types) {
                cat.types.forEach(function(t) {
                    opts += '<option value="' + diEscape(t.name) + '">' + diEscape(t.name) + '</option>';
                });
            }
        }
        typeSelect.innerHTML = opts;
        typeSelect.value = diFilters.type;
    }
    document.getElementById('diFilterCategory').addEventListener('change', updateTypeFilter);
    updateTypeFilter();

    document.getElementById('diFilterApply').addEventListener('click', function() {
        diFilters.material = document.getElementById('diFilterMaterial').value;
        diFilters.category = document.getElementById('diFilterCategory').value;
        diFilters.type = document.getElementById('diFilterType').value;
        diFilters.flat = document.getElementById('diFilterFlat').value;
        diFilters.from = document.getElementById('diFilterFrom').value;
        diFilters.to = document.getElementById('diFilterTo').value;
        renderInventoryRegisterView();
    });

    document.getElementById('diFilterClear').addEventListener('click', function() {
        diFilters = { material: 'all', category: 'all', type: 'all', flat: 'all', from: '', to: '' };
        renderInventoryRegisterView();
    });

    document.getElementById('diAddEntryBtn').addEventListener('click', function() { openDIEntryForm(null); });
}

function renderDITable(container) {
    // Client-side flat filter
    var filteredRows = diRows;
    if (diFilters.flat && diFilters.flat !== 'all') {
        filteredRows = diRows.filter(function(r) { return r.flat_no === diFilters.flat; });
    }

    // Group rows by material_name + (category_type || '')
    var groups = {};
    filteredRows.forEach(function(r) {
        var key = (r.material_name || '') + '||' + (r.category_type || '');
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
    });

    var groupKeys = Object.keys(groups).sort();

    if (groupKeys.length === 0) {
        var emptyMsg = document.createElement('div');
        emptyMsg.className = 'att-empty';
        emptyMsg.style.cssText = 'padding:32px 0;text-align:center;color:#999;';
        emptyMsg.textContent = 'No daily inventory entries found. Click "+ Add Entry" to create one.';
        container.appendChild(emptyMsg);
        return;
    }

    // Find latest date per group for edit/delete lock
    var latestDatePerGroup = {};
    groupKeys.forEach(function(key) {
        var rows = groups[key];
        var maxDate = '';
        rows.forEach(function(r) {
            if ((r.entry_date || '') > maxDate) maxDate = r.entry_date || '';
        });
        latestDatePerGroup[key] = maxDate;
    });

    groupKeys.forEach(function(key) {
        var rows = groups[key];
        var parts = key.split('||');
        var matName = parts[0];
        var typeName = parts[1];

        var groupTitle = diEscape(matName);
        if (typeName) groupTitle += ' / ' + diEscape(typeName);

        var groupDiv = document.createElement('div');
        groupDiv.style.marginBottom = '24px';

        var title = document.createElement('h4');
        title.style.cssText = 'margin-bottom:8px;font-size:1rem;color:#333;';
        title.innerHTML = groupTitle;
        groupDiv.appendChild(title);

        var html = '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table class="tracker-table"><thead><tr>' +
            '<th>S.NO</th><th>Date</th><th>Opening Stock</th><th>Purchased Qty</th><th>Total</th><th>Stock Used</th><th>Closing Stock</th><th>Flat / Unit</th><th>Remarks</th><th></th>' +
        '</tr></thead><tbody>';

        rows.forEach(function(r, idx) {
            var isLatest = (r.entry_date || '') === latestDatePerGroup[key];
            var rowClass = isLatest ? '' : 'di-locked-row';
            var rid = diEscape(r.id);

            function pencil(field) {
                return isLatest ? ' <span class="di-pencil" data-id="' + rid + '" data-field="' + field + '" title="Edit">&#9998;</span>' : '';
            }

            html += '<tr class="' + rowClass + '" data-rid="' + rid + '">' +
                '<td data-label="S.NO">' + (idx + 1) + '</td>' +
                '<td data-label="Date" class="di-cell" data-field="entry_date">' + diFmtDate(r.entry_date) + pencil('entry_date') + '</td>' +
                '<td data-label="Opening Stock" class="di-cell" data-field="opening">' + (Number(r.opening) || 0) + pencil('opening') + '</td>' +
                '<td data-label="Purchased Qty" class="di-purchase-auto">' + (Number(r.purchase) > 0 ? (Number(r.purchase) + ' <span style="font-size:0.7em;color:#999;">(auto)</span>') : '\u2014') + '</td>' +
                '<td data-label="Total" class="di-total-cell di-cell-auto" data-field="total">' + (Number(r.total) || 0) + '</td>' +
                '<td data-label="Stock Used" class="di-cell" data-field="usage_qty">' + (Number(r.usage_qty) || 0) + pencil('usage_qty') + '</td>' +
                '<td data-label="Closing Stock" class="di-balance-cell di-cell-auto" data-field="balance">' + (Number(r.balance) || 0) + '</td>' +
                '<td data-label="Flat / Unit" class="di-cell" data-field="flat_no">' + diEscape(r.flat_no || '\u2014') + pencil('flat_no') + '</td>' +
                '<td data-label="Remarks" class="di-cell" data-field="remarks">' + diEscape(r.remarks || r.notes || '\u2014') + pencil('remarks') + '</td>' +
                '<td data-label="Actions">';
            if (isLatest) {
                html += '<button class="btn-text di-delete-btn" data-id="' + rid + '" style="color:#c0392b;font-size:0.75rem;">Delete</button>';
            } else {
                html += '<span style="font-size:0.7rem;color:#999;" title="Past rows locked — later entries depend on this balance.">locked</span>';
            }
            html += '</td></tr>';
        });

        html += '</tbody></table></div>';
        groupDiv.insertAdjacentHTML('beforeend', html);
        container.appendChild(groupDiv);
    });

    // Wire delete buttons
    container.querySelectorAll('.di-delete-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { diDeleteEntry(btn.dataset.id); });
    });

    // Wire inline pencil editors
    container.querySelectorAll('.di-pencil').forEach(function(pen) {
        pen.addEventListener('click', function(e) {
            e.stopPropagation();
            diInlineEdit(pen.dataset.id, pen.dataset.field, pen.parentElement);
        });
    });
}

// --- Inline cell editing (pencil) ---

function diInlineEdit(rowId, field, cellEl) {
    var row = diRows.find(function(r) { return r.id === rowId; });
    if (!row || !cellEl) return;

    // Don't allow editing if already in edit mode
    if (cellEl.querySelector('.di-inline-input')) return;

    var currentVal = row[field];
    if (field === 'remarks') currentVal = row.remarks || row.notes || '';
    if (field === 'flat_no') currentVal = row.flat_no || '';
    if (currentVal === '\u2014') currentVal = '';

    // Build input based on field type
    var input;
    if (field === 'entry_date') {
        input = document.createElement('input');
        input.type = 'date';
        input.value = row.entry_date || '';
    } else if (field === 'opening' || field === 'usage_qty') {
        input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = currentVal;
    } else {
        input = document.createElement('input');
        input.type = 'text';
        input.value = currentVal;
    }

    input.className = 'di-inline-input';
    input.style.cssText = 'width:90%;padding:4px 6px;border:1.5px solid var(--accent-primary,#1a1a1a);border-radius:4px;font-size:0.85rem;';

    // Save original content for cancel
    var originalHTML = cellEl.innerHTML;

    // Replace cell content with input
    cellEl.innerHTML = '';
    cellEl.appendChild(input);
    input.focus();
    if (input.type === 'text') input.select();

    var saved = false;

    function save() {
        if (saved) return;
        saved = true;
        var newVal = input.value.trim();

        // Build body for API — include all required fields
        var body = {
            id: rowId,
            entry_date: row.entry_date,
            material_name: row.material_name,
            category: row.category || null,
            category_type: row.category_type || null,
            flat_no: row.flat_no || null,
            opening: row.opening,
            usage_qty: row.usage_qty,
            remarks: row.remarks || row.notes || ''
        };

        // Update the changed field
        if (field === 'entry_date') {
            body.entry_date = newVal;
        } else if (field === 'opening') {
            body.opening = parseFloat(newVal) || 0;
        } else if (field === 'usage_qty') {
            body.usage_qty = parseFloat(newVal) || 0;
        } else if (field === 'flat_no') {
            body.flat_no = newVal || null;
        } else if (field === 'remarks') {
            body.remarks = newVal;
        }

        // Show saving indicator
        cellEl.innerHTML = '<span style="color:#999;font-size:0.8rem;">Saving...</span>';

        apiPost('/api/daily-inventory', body).then(function(result) {
            // Update row data in diRows array
            var r = diRows.find(function(x) { return x.id === rowId; });
            if (r) {
                if (field === 'entry_date') r.entry_date = newVal;
                else if (field === 'opening') r.opening = result.opening !== undefined ? result.opening : body.opening;
                else if (field === 'usage_qty') r.usage_qty = body.usage_qty;
                else if (field === 'flat_no') r.flat_no = body.flat_no;
                else if (field === 'remarks') r.remarks = body.remarks;

                // Update computed fields from API response
                if (result.opening !== undefined) r.opening = result.opening;
                if (result.purchase !== undefined) r.purchase = result.purchase;
                if (result.total !== undefined) r.total = result.total;
                if (result.balance !== undefined) r.balance = result.balance;
            }

            // Update the cell display in-place
            diRenderCell(cellEl, r || body, field);
            // Update auto-computed cells in the same row
            var tr = cellEl.parentElement;
            if (tr) {
                var totalCell = tr.querySelector('.di-cell-auto[data-field="total"]');
                var balanceCell = tr.querySelector('.di-cell-auto[data-field="balance"]');
                if (totalCell && r) totalCell.textContent = (Number(r.total) || 0);
                if (balanceCell && r) balanceCell.textContent = (Number(r.balance) || 0);
            }
            showToast('Saved');
        }).catch(function(e) {
            cellEl.innerHTML = originalHTML;
            showToast(diParseError(e) || 'Failed to save', true);
            // Re-wire pencil
            var pen = cellEl.querySelector('.di-pencil');
            if (pen) pen.addEventListener('click', function(ev) { ev.stopPropagation(); diInlineEdit(rowId, field, cellEl); });
        });
    }

    function cancel() {
        if (saved) return;
        saved = true;
        cellEl.innerHTML = originalHTML;
        // Re-wire pencil
        var pen = cellEl.querySelector('.di-pencil');
        if (pen) pen.addEventListener('click', function(ev) { ev.stopPropagation(); diInlineEdit(rowId, field, cellEl); });
    }

    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', save);
}

function diRenderCell(cellEl, row, field) {
    if (field === 'entry_date') {
        cellEl.innerHTML = diFmtDate(row.entry_date) + ' <span class="di-pencil" title="Edit">&#9998;</span>';
    } else if (field === 'opening') {
        cellEl.innerHTML = (Number(row.opening) || 0) + ' <span class="di-pencil" title="Edit">&#9998;</span>';
    } else if (field === 'usage_qty') {
        cellEl.innerHTML = (Number(row.usage_qty) || 0) + ' <span class="di-pencil" title="Edit">&#9998;</span>';
    } else if (field === 'flat_no') {
        cellEl.innerHTML = diEscape(row.flat_no || '\u2014') + ' <span class="di-pencil" title="Edit">&#9998;</span>';
    } else if (field === 'remarks') {
        cellEl.innerHTML = diEscape(row.remarks || row.notes || '\u2014') + ' <span class="di-pencil" title="Edit">&#9998;</span>';
    }
    // Re-wire pencil
    var pen = cellEl.querySelector('.di-pencil');
    if (pen) pen.addEventListener('click', function(ev) { ev.stopPropagation(); diInlineEdit(row.id, field, cellEl); });
}

// --- Add/Edit Daily Entry form ---

function openDIEntryForm(editId) {
    diEditingId = editId || null;
    var editing = editId ? diRows.find(function(r) { return r.id === editId; }) : null;

    var materialOpts = diMaterials.map(function(m) { return '<option value="' + diEscape(m.name) + '">' + diEscape(m.name) + '</option>'; }).join('');
    var categoryOpts = diCategories.map(function(c) { return '<option value="' + diEscape(c.name) + '">' + diEscape(c.name) + '</option>'; }).join('');

    var today = new Date().toISOString().split('T')[0];

    var modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'diFormModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML =
        '<div style="background:#fff;border-radius:12px;padding:24px;width:90%;max-width:550px;max-height:90vh;overflow-y:auto;">' +
            '<h3 style="margin-bottom:16px;">' + (editing ? 'Edit Daily Entry' : 'Add Daily Entry') + '</h3>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
                '<div><label style="font-size:0.85rem;color:#666;">Date *</label><input type="date" id="diFormDate" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" value="' + (editing ? (editing.entry_date || '') : today) + '"></div>' +
                '<div><label style="font-size:0.85rem;color:#666;">Flat / Unit</label><input type="text" id="diFormFlatNo" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" value="' + diEscape(editing ? (editing.flat_no || '') : '') + '" placeholder="Optional"></div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">' +
                '<div><label style="font-size:0.85rem;color:#666;">Material *</label><input type="text" id="diFormMaterial" list="diMaterialList" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" value="' + diEscape(editing ? (editing.material_name || '') : '') + '" placeholder="Type or select"><datalist id="diMaterialList">' + materialOpts + '</datalist></div>' +
                '<div><label style="font-size:0.85rem;color:#666;">Category</label><input type="text" id="diFormCategory" list="diCategoryList" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" value="' + diEscape(editing ? (editing.category || '') : '') + '" placeholder="Optional"><datalist id="diCategoryList">' + categoryOpts + '</datalist></div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">' +
                '<div><label style="font-size:0.85rem;color:#666;">Type</label><input type="text" id="diFormType" list="diTypeList" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" value="' + diEscape(editing ? (editing.category_type || '') : '') + '" placeholder="Optional - type or select"><datalist id="diTypeList"></datalist></div>' +
                '<div></div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px;">' +
                '<div><label style="font-size:0.85rem;color:#666;">Opening Stock</label><input type="number" id="diFormOpening" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;background:#f4f6f8;" value="' + (editing ? (editing.opening || 0) : '') + '" step="any" placeholder="auto"><small style="color:#999;font-size:0.7rem;">Auto from last closing</small></div>' +
                '<div><label style="font-size:0.85rem;color:#666;">Stock Received (auto)</label><input type="text" id="diFormPurchase" readonly style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;background:#f4f6f8;font-style:italic;color:#666;" value="auto" placeholder="From purchases"></div>' +
                '<div><label style="font-size:0.85rem;color:#666;">Stock Used</label><input type="number" id="diFormUsage" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" value="' + (editing ? (editing.usage_qty || 0) : 0) + '" step="any"></div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">' +
                '<div><label style="font-size:0.85rem;color:#666;">Total (auto)</label><input type="text" id="diFormTotal" readonly style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;background:#f4f6f8;"></div>' +
                '<div><label style="font-size:0.85rem;color:#666;">Closing Stock (auto)</label><input type="text" id="diFormBalance" readonly style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;background:#f4f6f8;font-weight:600;"></div>' +
            '</div>' +
            '<div style="margin-top:12px;"><label style="font-size:0.85rem;color:#666;">Remarks</label><input type="text" id="diFormRemarks" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;" value="' + diEscape(editing ? (editing.remarks || editing.notes || '') : '') + '" placeholder="Optional"></div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;">' +
                '<button id="diFormCancel" class="btn-secondary" style="padding:8px 20px;">Cancel</button>' +
                '<button id="diFormSave" class="btn-primary" style="padding:8px 20px;">Save</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(modal);

    // Category -> Type datalist
    var categoryInput = document.getElementById('diFormCategory');
    var typeInput = document.getElementById('diFormType');
    var typeList = document.getElementById('diTypeList');
    function updateTypeList() {
        var cat = diCategories.find(function(c) { return c.name.toLowerCase() === categoryInput.value.trim().toLowerCase(); });
        typeList.innerHTML = '';
        if (cat && cat.types) {
            cat.types.forEach(function(t) {
                typeList.innerHTML += '<option value="' + diEscape(t.name) + '">';
            });
        }
    }
    categoryInput.addEventListener('input', updateTypeList);
    if (editing && editing.category) updateTypeList();

    // Live total/balance calc
    var openingInput = document.getElementById('diFormOpening');
    var usageInput = document.getElementById('diFormUsage');
    var totalInput = document.getElementById('diFormTotal');
    var balanceInput = document.getElementById('diFormBalance');
    function updateCalc() {
        var opening = parseFloat(openingInput.value) || 0;
        var usage = parseFloat(usageInput.value) || 0;
        var purchaseText = document.getElementById('diFormPurchase').value;
        var purchase = parseFloat(purchaseText) || 0;
        if (purchaseText === 'auto') purchase = 0;
        var total = opening + purchase;
        var balance = total - usage;
        totalInput.value = total.toFixed(2) + (purchaseText === 'auto' ? ' (excl. auto)' : '');
        balanceInput.value = balance.toFixed(2) + (purchaseText === 'auto' ? ' (excl. auto)' : '');
    }
    openingInput.addEventListener('input', updateCalc);
    usageInput.addEventListener('input', updateCalc);
    if (editing) updateCalc();

    // Close handlers
    modal.addEventListener('click', function(e) { if (e.target === modal) closeDIEntryForm(); });
    document.getElementById('diFormCancel').addEventListener('click', closeDIEntryForm);
    document.getElementById('diFormSave').addEventListener('click', diSaveEntry);
}

function closeDIEntryForm() {
    var modal = document.getElementById('diFormModal');
    if (modal) modal.remove();
    diEditingId = null;
}

async function diSaveEntry() {
    var materialName = document.getElementById('diFormMaterial').value.trim();
    var entryDate = document.getElementById('diFormDate').value;

    if (!materialName) { showToast('Material name is required', true); return; }
    if (!entryDate) { showToast('Date is required', true); return; }

    var usageQty = parseFloat(document.getElementById('diFormUsage').value) || 0;
    var openingVal = document.getElementById('diFormOpening').value.trim();
    var opening = (openingVal === '' || openingVal === 'null') ? null : parseFloat(openingVal);

    // Auto-save material master if new
    var materialExists = diMaterials.some(function(m) { return m.name.toLowerCase() === materialName.toLowerCase(); });
    if (!materialExists) {
        try {
            await apiPost('/api/inventory-material', { name: materialName });
            await diLoadMaterials();
        } catch (e) { /* non-fatal */ }
    }

    // Auto-save category if new
    var categoryName = document.getElementById('diFormCategory').value.trim();
    if (categoryName) {
        var catExists = diCategories.some(function(c) { return c.name.toLowerCase() === categoryName.toLowerCase() && !c.parent_id; });
        if (!catExists) {
            try {
                await apiPost('/api/inventory-category', { name: categoryName });
                await diLoadCategories();
            } catch (e) { /* non-fatal */ }
        }
    }

    // Auto-save type if new
    var typeName = document.getElementById('diFormType').value.trim();
    if (categoryName && typeName) {
        var cat = diCategories.find(function(c) { return c.name.toLowerCase() === categoryName.toLowerCase() && !c.parent_id; });
        if (cat) {
            var typeExists = cat.types && cat.types.some(function(t) { return t.name.toLowerCase() === typeName.toLowerCase(); });
            if (!typeExists) {
                try {
                    await apiPost('/api/inventory-category', { name: typeName, parent_id: cat.id });
                    await diLoadCategories();
                } catch (e) { /* non-fatal */ }
            }
        }
    }

    var body = {
        id: diEditingId || undefined,
        entry_date: entryDate,
        material_name: materialName,
        category: categoryName || null,
        category_type: typeName || null,
        flat_no: document.getElementById('diFormFlatNo').value.trim() || null,
        opening: opening,
        usage_qty: usageQty,
        remarks: document.getElementById('diFormRemarks').value.trim() || ''
    };

    var saveBtn = document.getElementById('diFormSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        var result = await apiPost('/api/daily-inventory', body);
        showToast('Daily entry saved' + (result.purchase ? ' (stock received: ' + result.purchase + ')' : ''));
        closeDIEntryForm();
        await renderInventoryRegisterView();
    } catch (e) {
        var msg = diParseError(e);
        showToast(msg || 'Failed to save entry', true);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
    }
}

async function diDeleteEntry(did) {
    showConfirm('Delete Entry', 'Delete this daily inventory entry?', async function() {
        try {
            await apiDelete('/api/daily-inventory/' + encodeURIComponent(did));
            showToast('Entry deleted');
            await renderInventoryRegisterView();
        } catch (e) {
            var msg = diParseError(e);
            if (msg && msg.indexOf('later entries depend') !== -1) {
                showToast('Cannot delete a past row — later entries depend on its balance. Delete the latest entry first.', true);
            } else {
                showToast(msg || 'Failed to delete entry', true);
            }
        }
    }, null, 'Delete', true);
}
