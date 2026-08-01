// ============================================================
// Vendor Directory Module
// Shows enriched vendor data synced from Day Book purchases.
// Search by vendor name / category, filter by material, date, outstanding.
// ============================================================

var vdVendors = [];
var vdMaterials = [];
var vdFilters = { search: '', material: 'all', outstandingOnly: false };

// --- Helpers ---

function vdEscape(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function vdFmtMoney(amount) {
    return '\u20B9' + (Number(amount) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// --- Data loading ---

async function vdLoadVendors() {
    try { vdVendors = await apiGet('/api/vendor-directory') || []; }
    catch (e) { vdVendors = []; }
}

async function vdLoadMaterials() {
    try { vdMaterials = await apiGet('/api/inventory-materials') || []; }
    catch (e) { vdMaterials = []; }
}

// --- Main render ---

async function renderVendorDirectoryView() {
    var content = document.getElementById('vendorDirContent');
    if (!content) return;
    content.innerHTML = '<div style="padding:24px;color:#999;">Loading...</div>';

    await Promise.all([vdLoadVendors(), vdLoadMaterials()]);
    renderVDFilters();
    renderVDTable();
}

function renderVDFilters() {
    var bar = document.getElementById('vendorDirFilters');
    if (!bar) return;

    var materialOpts = '<option value="all">All Materials</option>';
    vdMaterials.forEach(function(m) {
        materialOpts += '<option value="' + vdEscape(m.name) + '">' + vdEscape(m.name) + '</option>';
    });

    bar.innerHTML =
        '<div class="pending-filter-group" style="flex:1;min-width:200px;">' +
            '<label>Search</label>' +
            '<input type="text" id="vdSearchInput" placeholder="Search by vendor name or category..." style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:6px;font-size:0.9rem;" value="' + vdEscape(vdFilters.search) + '">' +
        '</div>' +
        '<div class="pending-filter-group">' +
            '<label>Material</label>' +
            '<select id="vdFilterMaterial">' + materialOpts + '</select>' +
        '</div>' +
        '<div class="pending-filter-group" style="align-self:flex-end;">' +
            '<label>&nbsp;</label>' +
            '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.85rem;"><input type="checkbox" id="vdFilterOutstanding" ' + (vdFilters.outstandingOnly ? 'checked' : '') + ' style="width:16px;height:16px;"> Outstanding Only</label>' +
        '</div>' +
        '<div class="pending-filter-group" style="align-self:flex-end;">' +
            '<button id="vdFilterClear" class="btn-secondary" style="padding:8px 16px;">Clear</button>' +
        '</div>';

    document.getElementById('vdFilterMaterial').value = vdFilters.material;

    document.getElementById('vdSearchInput').addEventListener('input', function() {
        vdFilters.search = this.value;
        renderVDTable();
    });

    document.getElementById('vdFilterMaterial').addEventListener('change', function() {
        vdFilters.material = this.value;
        renderVDTable();
    });

    document.getElementById('vdFilterOutstanding').addEventListener('change', function() {
        vdFilters.outstandingOnly = this.checked;
        renderVDTable();
    });

    document.getElementById('vdFilterClear').addEventListener('click', function() {
        vdFilters = { search: '', material: 'all', outstandingOnly: false };
        renderVendorDirectoryView();
    });
}

function renderVDTable() {
    var content = document.getElementById('vendorDirContent');
    if (!content) return;

    var filtered = vdVendors.filter(function(v) {
        // Search filter
        if (vdFilters.search) {
            var q = vdFilters.search.toLowerCase();
            var nameMatch = (v.name || '').toLowerCase().indexOf(q) !== -1;
            var catMatch = (v.categories || []).some(function(c) { return c.toLowerCase().indexOf(q) !== -1; });
            if (!nameMatch && !catMatch) return false;
        }
        // Material filter
        if (vdFilters.material && vdFilters.material !== 'all') {
            if (!(v.materials || []).some(function(m) { return m === vdFilters.material; })) return false;
        }
        // Outstanding only
        if (vdFilters.outstandingOnly && (v.outstanding || 0) <= 0) return false;
        return true;
    });

    if (filtered.length === 0) {
        content.innerHTML = '<div class="att-empty" style="padding:32px 0;text-align:center;color:#999;">No vendors found. Vendors are auto-created when you add purchases in Day Book.</div>';
        return;
    }

    var html = '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table class="tracker-table"><thead><tr>' +
        '<th>Vendor Name</th><th>Materials Supplied</th><th>Categories</th>' +
        '<th>Total Purchased</th><th>Total Paid</th><th>Outstanding</th><th></th>' +
        '</tr></thead><tbody>';

    filtered.forEach(function(v) {
        var matStr = (v.materials || []).join(', ') || '\u2014';
        var catStr = (v.categories || []).join(', ') || '\u2014';
        var outClass = (v.outstanding || 0) > 0 ? 'po-fin-outstanding' : 'po-fin-clear';
        html += '<tr>' +
            '<td data-label="Vendor Name" style="font-weight:600;">' + vdEscape(v.name) + '</td>' +
            '<td data-label="Materials" style="font-size:0.85rem;color:#555;">' + vdEscape(matStr) + '</td>' +
            '<td data-label="Categories" style="font-size:0.85rem;color:#555;">' + vdEscape(catStr) + '</td>' +
            '<td data-label="Total Purchased">' + vdFmtMoney(v.total_purchased) + '</td>' +
            '<td data-label="Total Paid">' + vdFmtMoney(v.total_paid) + '</td>' +
            '<td data-label="Outstanding" class="' + outClass + '" style="font-weight:600;">' + vdFmtMoney(v.outstanding) + '</td>' +
            '<td data-label="Actions"><button class="btn-text vd-detail-btn" data-vid="' + vdEscape(v.id) + '" style="font-size:0.75rem;">View Details</button></td>' +
            '</tr>';
    });

    html += '</tbody></table></div>';
    content.innerHTML = html;

    content.querySelectorAll('.vd-detail-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { openVDDetail(btn.dataset.vid); });
    });
}

// --- Vendor Detail Modal ---

async function openVDDetail(vendorId) {
    var modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'vdDetailModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML =
        '<div style="background:#fff;border-radius:12px;padding:24px;width:95%;max-width:750px;max-height:90vh;overflow-y:auto;">' +
            '<div id="vdDetailBody" style="padding:24px;color:#999;">Loading vendor details...</div>' +
        '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });

    try {
        var data = await apiGet('/api/day-book/vendor/' + encodeURIComponent(vendorId));
        var v = vdVendors.find(function(x) { return x.id === vendorId; }) || {};
        var s = data.summary || {};
        var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
            '<h3 style="margin:0;">' + vdEscape(v.name || (data.purchases[0] || {}).vendor_name || 'Vendor') + '</h3>' +
            '<button class="btn-secondary" style="padding:6px 16px;" onclick="document.getElementById(\'vdDetailModal\').remove();">Close</button>' +
        '</div>';

        // Vendor info
        if (v.phone || v.gstin || v.type) {
            html += '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">';
            if (v.type) html += '<div><span style="color:#666;font-size:0.8rem;">Type</span><div>' + vdEscape(v.type) + '</div></div>';
            if (v.phone) html += '<div><span style="color:#666;font-size:0.8rem;">Phone</span><div>' + vdEscape(v.phone) + '</div></div>';
            if (v.gstin) html += '<div><span style="color:#666;font-size:0.8rem;">GSTIN</span><div>' + vdEscape(v.gstin) + '</div></div>';
            html += '</div>';
        }

        // Summary cards
        html += '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">' +
            '<div style="background:#f4f6f8;padding:12px 16px;border-radius:8px;flex:1;min-width:140px;"><span style="color:#666;font-size:0.8rem;">Total Purchased</span><div style="font-weight:600;font-size:1.1rem;">' + vdFmtMoney(s.total_purchased) + '</div></div>' +
            '<div style="background:#f4f6f8;padding:12px 16px;border-radius:8px;flex:1;min-width:140px;"><span style="color:#666;font-size:0.8rem;">Total Paid</span><div style="font-weight:600;font-size:1.1rem;">' + vdFmtMoney(s.total_paid) + '</div></div>' +
            '<div style="background:#f4f6f8;padding:12px 16px;border-radius:8px;flex:1;min-width:140px;"><span style="color:#666;font-size:0.8rem;">Outstanding</span><div style="font-weight:600;font-size:1.1rem;color:' + (s.outstanding > 0 ? '#c0392b' : '#27ae60') + ';">' + vdFmtMoney(s.outstanding) + '</div></div>' +
        '</div>';

        // Materials & Categories
        if (v.materials && v.materials.length > 0) {
            html += '<div style="margin-bottom:16px;"><span style="color:#666;font-size:0.8rem;">Materials Supplied:</span> ' + v.materials.map(function(m) { return '<span style="background:#e8ecf0;padding:2px 10px;border-radius:12px;font-size:0.8rem;margin:2px;display:inline-block;">' + vdEscape(m) + '</span>'; }).join('') + '</div>';
        }
        if (v.categories && v.categories.length > 0) {
            html += '<div style="margin-bottom:16px;"><span style="color:#666;font-size:0.8rem;">Categories:</span> ' + v.categories.map(function(c) { return '<span style="background:#e8ecf0;padding:2px 10px;border-radius:12px;font-size:0.8rem;margin:2px;display:inline-block;">' + vdEscape(c) + '</span>'; }).join('') + '</div>';
        }

        // Purchase history
        html += '<h4 style="margin-bottom:8px;">Purchase History (' + (data.purchases || []).length + ')</h4>';
        html += '<div style="overflow-x:auto;"><table class="tracker-table" style="margin-bottom:20px;"><thead><tr><th>Invoice Date</th><th>Invoice No</th><th>Material</th><th>Qty</th><th>Amount</th></tr></thead><tbody>';
        (data.purchases || []).forEach(function(p) {
            html += '<tr><td>' + vdEscape(p.invoice_date || '\u2014') + '</td><td>' + vdEscape(p.invoice_no || '\u2014') + '</td><td>' + vdEscape(p.material_name) + '</td><td>' + (Number(p.qty) || 0) + '</td><td>' + vdFmtMoney(p.amount) + '</td></tr>';
        });
        html += '</tbody></table></div>';

        // Payment history
        html += '<h4 style="margin-bottom:8px;">Payment History (' + (data.payments || []).length + ')</h4>';
        if ((data.payments || []).length > 0) {
            html += '<div style="overflow-x:auto;"><table class="tracker-table"><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead><tbody>';
            data.payments.forEach(function(p) {
                var methodLabel = (p.method || '').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
                html += '<tr><td>' + vdEscape(p.payment_date || '\u2014') + '</td><td>' + vdFmtMoney(p.amount) + '</td><td>' + vdEscape(methodLabel) + '</td><td>' + vdEscape(p.reference || '\u2014') + '</td></tr>';
            });
            html += '</tbody></table></div>';
        } else {
            html += '<div style="color:#999;padding:12px;">No payments recorded.</div>';
        }

        // Record payment button (admin/manager)
        if (currentUserRole === 'admin' || currentUserRole === 'manager') {
            html += '<div style="margin-top:16px;"><button id="vdRecordPaymentBtn" class="btn-primary" style="padding:8px 20px;">+ Record Payment</button></div>';
        }

        document.getElementById('vdDetailBody').innerHTML = html;

        var payBtn = document.getElementById('vdRecordPaymentBtn');
        if (payBtn) payBtn.addEventListener('click', function() {
            modal.remove();
            if (typeof openIPPaymentForm === 'function') openIPPaymentForm(vendorId, v.name);
        });

    } catch (e) {
        document.getElementById('vdDetailBody').innerHTML = '<div class="att-empty" style="padding:24px;text-align:center;color:#c0392b;">Failed to load vendor details.</div>';
    }
}
