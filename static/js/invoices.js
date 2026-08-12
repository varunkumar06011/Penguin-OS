// ========================
// Invoices Module
// ========================
let invoicesEditingId = null; // null = adding new, string = editing existing
let invoiceAttachmentsBuffer = []; // Array of { name, type, dataUrl } for current form session

function loadAllInvoices() {
    return allInvoices;
}

async function saveAllInvoices(invoices) {
    allInvoices = invoices;
    for (const inv of invoices) {
        await apiPost('/api/invoice', inv);
    }
}

function loadInvoiceCategories() {
    return allCategories;
}

async function saveInvoiceCategory(cat) {
    if (!cat) return;
    const cats = loadInvoiceCategories();
    if (!cats.includes(cat)) {
        cats.push(cat);
        allCategories = cats;
        await apiPost('/api/settings/invoice_categories', cats);
    }
}

async function openInvoicesPanel() {
    hideAllMainPanels();
    document.getElementById('invoicesPanel').style.display = '';
    await Promise.all([ensureInvoicesLoaded(), ensureCategoriesLoaded()]);
    populateInvoiceFilterVentures();
    populateInvoiceFilterCategories();
    restorePanelState('invoices');
    renderInvoiceCards();
    navigateTo('#/invoices');
}

function closeInvoicesPanel() {
    renderVentureDashboard();
    navigateTo('#/ventures');
}

function openInventoryPanel() {
    hideAllMainPanels();
    document.getElementById('inventoryPanel').style.display = '';
    restorePanelState('inventory');
    if (venturesList.length > 0 && !selectedInventoryVenture) {
        selectedInventoryVenture = venturesList[0];
    }
    renderInventoryView();
    navigateTo('#/inventory');
}

function closeInventoryPanel() {
    selectedInventoryVenture = null;
    renderVentureDashboard();
    navigateTo('#/ventures');
}

function populateInvoiceFilterVentures() {
    const sel = document.getElementById('invoiceFilterVenture');
    const current = sel.value;
    sel.innerHTML = '<option value="all">All Ventures</option>';
    venturesList.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        sel.appendChild(opt);
    });
    if (current) sel.value = current;
}

function populateInvoiceFilterCategories() {
    const sel = document.getElementById('invoiceFilterCategory');
    const current = sel.value;
    sel.innerHTML = '<option value="all">All Categories</option>';
    const cats = loadInvoiceCategories();
    cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
    });
    if (current) sel.value = current;
}

function renderInvoiceCards() {
    const grid = document.getElementById('invoiceCardsGrid');
    const summaryBar = document.getElementById('invoiceSummaryBar');
    grid.innerHTML = '';

    let invoices = loadAllInvoices();

    const filterVenture = document.getElementById('invoiceFilterVenture').value;
    const filterCat = document.getElementById('invoiceFilterCategory').value;
    const filterFrom = document.getElementById('invoiceFilterFrom').value;
    const filterTo = document.getElementById('invoiceFilterTo').value;

    if (filterVenture !== 'all') invoices = invoices.filter(inv => inv.ventureId === filterVenture);
    if (filterCat !== 'all') invoices = invoices.filter(inv => inv.category === filterCat);
    if (filterFrom) invoices = invoices.filter(inv => inv.purchaseDate >= filterFrom);
    if (filterTo) invoices = invoices.filter(inv => inv.purchaseDate <= filterTo);

    invoices = invoices.slice().sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''));

    const totalAmount = invoices.reduce((sum, inv) => sum + (parseFloat(inv.amount) || 0), 0);
    summaryBar.innerHTML = `
        <span class="inv-summary-count">${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}</span>
        <span class="inv-summary-sep">&#183;</span>
        <span class="inv-summary-total">Total: &#8377;${totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
    `;

    if (invoices.length === 0) {
        grid.innerHTML = '<div class="invoice-empty-state">No invoices found. Click "+ Add Invoice" to get started.</div>';
        return;
    }

    invoices.forEach(inv => {
        const venture = venturesList.find(v => v.id === inv.ventureId);
        const ventureName = venture ? venture.name : (inv.ventureName || 'Unknown');
        const dateDisplay = inv.purchaseDate ? new Date(inv.purchaseDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '&#8212;';
        const amountDisplay = inv.amount ? '&#8377;' + parseFloat(inv.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '&#8212;';
        const attachCount = (inv.attachments || []).length;

        const card = document.createElement('div');
        card.className = 'invoice-card';
        card.dataset.invoiceId = inv.id;
        card.innerHTML = `
            <div class="invoice-card-header">
                <span class="invoice-card-category">${escapeHtml(inv.category || '&#8212;')}</span>
                <span class="invoice-card-venture">${escapeHtml(ventureName)}</span>
            </div>
            <div class="invoice-card-amount">${amountDisplay}</div>
            <div class="invoice-card-meta">
                <span>&#128197; ${dateDisplay}</span>
                ${inv.paymentMode ? `<span>&#128179; ${escapeHtml(inv.paymentMode)}</span>` : ''}
                ${inv.vendor ? `<span>&#127976; ${escapeHtml(inv.vendor)}</span>` : ''}
            </div>
            <div class="invoice-card-reason">${escapeHtml(inv.reason || '')}</div>
            ${attachCount > 0 ? `<div class="invoice-card-attach">&#128206; ${attachCount} attachment${attachCount > 1 ? 's' : ''}</div>` : ''}
        `;
        card.addEventListener('click', () => openInvoiceView(inv.id));
        grid.appendChild(card);
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function openInvoiceForm(invoiceId = null) {
    invoicesEditingId = invoiceId;
    invoiceAttachmentsBuffer = [];
    document.getElementById('invoiceFormTitle').textContent = invoiceId ? 'Edit Invoice' : 'Add Invoice';

    const sel = document.getElementById('invoiceVentureSelect');
    sel.innerHTML = '<option value="">-- Select Venture --</option>';
    venturesList.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        sel.appendChild(opt);
    });

    const dl = document.getElementById('invoiceCategoryList');
    dl.innerHTML = '';
    loadInvoiceCategories().forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        dl.appendChild(opt);
    });

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('invoiceDateInput').value = today;
    document.getElementById('invoiceAmountInput').value = '';
    document.getElementById('invoiceReasonInput').value = '';
    document.getElementById('invoiceVendorInput').value = '';
    document.getElementById('invoicePaymentMode').value = '';
    document.getElementById('invoiceCategoryInput').value = '';
    document.getElementById('invoiceFilePreview').innerHTML = '';
    document.getElementById('invoiceFileDropLabel').textContent = 'Click to choose or drag & drop (JPG, PNG, PDF -- max 5MB per file, up to 5 files)';

    if (invoiceId) {
        const invoices = loadAllInvoices();
        const inv = invoices.find(i => i.id === invoiceId);
        if (inv) {
            sel.value = inv.ventureId || '';
            document.getElementById('invoiceCategoryInput').value = inv.category || '';
            document.getElementById('invoiceDateInput').value = inv.purchaseDate || today;
            document.getElementById('invoiceAmountInput').value = inv.amount || '';
            document.getElementById('invoiceReasonInput').value = inv.reason || '';
            document.getElementById('invoiceVendorInput').value = inv.vendor || '';
            document.getElementById('invoicePaymentMode').value = inv.paymentMode || '';
            invoiceAttachmentsBuffer = (inv.attachments || []).map(a => ({ ...a }));
            renderAttachmentPreview();
        }
    }

    document.getElementById('invoiceFormModal').classList.add('show');
}

function closeInvoiceForm() {
    document.getElementById('invoiceFormModal').classList.remove('show');
    invoicesEditingId = null;
    invoiceAttachmentsBuffer = [];
}

function handleInvoiceFiles(files) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const maxSize = 5 * 1024 * 1024;

    files.forEach(file => {
        if (invoiceAttachmentsBuffer.length >= 5) {
            showToast('Maximum 5 attachments per invoice', true);
            return;
        }
        if (!allowed.includes(file.type)) {
            showToast(`${file.name}: Only JPG, PNG, WebP, PDF allowed`, true);
            return;
        }
        if (file.size > maxSize) {
            showToast(`${file.name}: File too large (max 5MB)`, true);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            invoiceAttachmentsBuffer.push({
                name: file.name,
                type: file.type,
                dataUrl: e.target.result,
                size: file.size
            });
            renderAttachmentPreview();
        };
        reader.readAsDataURL(file);
    });
}

function renderAttachmentPreview() {
    const preview = document.getElementById('invoiceFilePreview');
    preview.innerHTML = '';
    invoiceAttachmentsBuffer.forEach((att, idx) => {
        const item = document.createElement('div');
        item.className = 'attach-preview-item';
        const thumb = document.createElement('div');
        thumb.className = 'attach-thumb';
        if (att.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = att.dataUrl;
            img.alt = att.name;
            img.className = 'attach-thumb-img';
            thumb.appendChild(img);
        } else {
            thumb.innerHTML = '<span class="attach-pdf-icon">PDF</span>';
        }
        const label = document.createElement('span');
        label.className = 'attach-name';
        label.textContent = att.name.length > 20 ? att.name.substring(0, 18) + '&#8230;' : att.name;
        const removeBtn = document.createElement('button');
        removeBtn.className = 'attach-remove-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = 'Remove';
        removeBtn.addEventListener('click', () => {
            invoiceAttachmentsBuffer.splice(idx, 1);
            renderAttachmentPreview();
        });
        item.appendChild(thumb);
        item.appendChild(label);
        item.appendChild(removeBtn);
        preview.appendChild(item);
    });
    const dropLabel = document.getElementById('invoiceFileDropLabel');
    if (invoiceAttachmentsBuffer.length > 0) {
        dropLabel.textContent = `${invoiceAttachmentsBuffer.length} file(s) selected. Click to add more.`;
    } else {
        dropLabel.textContent = 'Click to choose or drag & drop (JPG, PNG, PDF -- max 5MB per file, up to 5 files)';
    }
}

function openInvoiceView(invoiceId) {
    const invoices = loadAllInvoices();
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) return;

    const venture = venturesList.find(v => v.id === inv.ventureId);
    const ventureName = venture ? venture.name : (inv.ventureName || 'Unknown');
    const dateDisplay = inv.purchaseDate ? new Date(inv.purchaseDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '&#8212;';
    const amountDisplay = inv.amount ? '&#8377;' + parseFloat(inv.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '&#8212;';

    document.getElementById('invoiceViewTitle').textContent = `${inv.category} &#8212; ${dateDisplay}`;

    const body = document.getElementById('invoiceViewBody');
    body.innerHTML = `
        <div class="inv-view-grid">
            <div class="inv-view-field"><span class="inv-view-label">Venture</span><span class="inv-view-value">${escapeHtml(ventureName)}</span></div>
            <div class="inv-view-field"><span class="inv-view-label">Category</span><span class="inv-view-value">${escapeHtml(inv.category)}</span></div>
            <div class="inv-view-field"><span class="inv-view-label">Purchase Date</span><span class="inv-view-value">${dateDisplay}</span></div>
            <div class="inv-view-field"><span class="inv-view-label">Amount Paid</span><span class="inv-view-value inv-view-amount">${amountDisplay}</span></div>
            ${inv.paymentMode ? `<div class="inv-view-field"><span class="inv-view-label">Payment Mode</span><span class="inv-view-value">${escapeHtml(inv.paymentMode)}</span></div>` : ''}
            ${inv.vendor ? `<div class="inv-view-field"><span class="inv-view-label">Vendor</span><span class="inv-view-value">${escapeHtml(inv.vendor)}</span></div>` : ''}
        </div>
        <div class="inv-view-reason"><span class="inv-view-label">Reason / Description</span><p>${escapeHtml(inv.reason)}</p></div>
        ${(inv.attachments && inv.attachments.length > 0) ? `
            <div class="inv-view-attachments">
                <span class="inv-view-label">Attachments (${inv.attachments.length})</span>
                <div class="inv-view-attach-grid" id="invViewAttachGrid"></div>
            </div>
        ` : '<div class="inv-view-no-attach">No attachments</div>'}
        <div class="inv-view-meta">Added by ${escapeHtml(inv.createdBy || 'Unknown')} &#183; ${inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('en-IN') : ''}</div>
    `;

    if (inv.attachments && inv.attachments.length > 0) {
        const attachGrid = body.querySelector('#invViewAttachGrid');
        inv.attachments.forEach((att, idx) => {
            const item = document.createElement('div');
            item.className = 'inv-attach-thumb-item';
            item.title = att.name;
            if (att.type && att.type.startsWith('image/')) {
                item.innerHTML = `<img src="${att.dataUrl}" alt="${escapeHtml(att.name)}" class="inv-attach-img">`;
            } else {
                item.innerHTML = `<div class="inv-attach-pdf-thumb"><span>PDF</span><span class="inv-attach-pdf-name">${escapeHtml(att.name)}</span></div>`;
            }
            item.addEventListener('click', () => openLightbox(att));
            attachGrid.appendChild(item);
        });
    }

    document.getElementById('editInvoiceBtn').onclick = () => {
        closeInvoiceView();
        openInvoiceForm(invoiceId);
    };
    document.getElementById('deleteInvoiceBtn').onclick = () => {
        showConfirm('Delete Invoice', `Delete this invoice (${inv.category} &#8212; ${dateDisplay})? This cannot be undone.`, async () => {
            await deleteInvoice(invoiceId);
            closeInvoiceView();
        }, null, 'Delete', true);
    };

    document.getElementById('invoiceViewModal').classList.add('show');
}

function closeInvoiceView() {
    document.getElementById('invoiceViewModal').classList.remove('show');
}

async function deleteInvoice(invoiceId) {
    try {
        await apiDelete('/api/invoice/' + encodeURIComponent(invoiceId));
        allInvoices = loadAllInvoices().filter(i => i.id !== invoiceId);
        renderInvoiceCards();
        showToast('Invoice deleted');
    } catch (err) {
        console.error('Failed to delete invoice:', err);
        showToast('Delete failed — please retry', true);
    }
}

function openLightbox(att) {
    document.getElementById('lightboxFileName').textContent = att.name;
    const content = document.getElementById('lightboxContent');
    content.innerHTML = '';

    if (att.type && att.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = att.dataUrl;
        img.alt = att.name;
        img.className = 'lightbox-img';
        content.appendChild(img);
    } else if (att.type === 'application/pdf') {
        const embed = document.createElement('embed');
        embed.src = att.dataUrl;
        embed.type = 'application/pdf';
        embed.className = 'lightbox-pdf';
        content.appendChild(embed);
    }

    document.getElementById('lightboxDownload').onclick = () => {
        const a = document.createElement('a');
        a.href = att.dataUrl;
        a.download = att.name;
        a.click();
    };

    document.getElementById('attachmentLightbox').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    document.getElementById('attachmentLightbox').style.display = 'none';
    document.getElementById('lightboxContent').innerHTML = '';
    document.body.style.overflow = '';
}

// Invoice event wiring
var _oib = document.getElementById('openInvoicesBtn'); if (_oib) _oib.addEventListener('click', openInvoicesPanel);
document.getElementById('backFromInvoices').addEventListener('click', closeInvoicesPanel);

// Inventory event wiring
var _oib2 = document.getElementById('openInventoryBtn'); if (_oib2) _oib2.addEventListener('click', () => {
    if (typeof openInventoryRegisterPanel === 'function') openInventoryRegisterPanel();
    else openInventoryPanel();
});
document.getElementById('backFromInventory').addEventListener('click', () => {
    if (typeof closeInventoryRegisterPanel === 'function') closeInventoryRegisterPanel();
    else closeInventoryPanel();
});

// Reports panel event wiring
var _orb = document.getElementById('openReportsBtn'); if (_orb) _orb.addEventListener('click', () => openReportsPanel());
document.getElementById('backFromReports').addEventListener('click', () => closeReportsPanel());

// Admin-only panel event wiring
var _irb = document.getElementById('openInstantReportsBtn'); if (_irb) _irb.addEventListener('click', () => openInstantReportsPanel());
document.getElementById('backFromInstantReports').addEventListener('click', () => closeInstantReportsPanel());
var _iab = document.getElementById('openInventoryAuditBtn'); if (_iab) _iab.addEventListener('click', () => openInventoryAuditPanel());
document.getElementById('backFromInventoryAudit').addEventListener('click', () => closeInventoryAuditPanel());
var _eb = document.getElementById('openExpenditureBtn'); if (_eb) _eb.addEventListener('click', () => openExpenditurePanel());
document.getElementById('backFromExpenditure').addEventListener('click', () => closeExpenditurePanel());
var _cpb = document.getElementById('openContractorPaymentsBtn'); if (_cpb) _cpb.addEventListener('click', () => openContractorPaymentsPanel());
var _cpbBack = document.getElementById('backFromContractorPayments'); if (_cpbBack) _cpbBack.addEventListener('click', () => closeContractorPaymentsPanel());
var _cpbAdd = document.getElementById('addContractBtn'); if (_cpbAdd) _cpbAdd.addEventListener('click', () => openContractForm());
var _bipBack = document.getElementById('backFromDayBook'); if (_bipBack) _bipBack.addEventListener('click', () => { if (typeof closeDayBookPanel === 'function') closeDayBookPanel(); });
var _vdbBack = document.getElementById('backFromVendorDir'); if (_vdbBack) _vdbBack.addEventListener('click', () => { if (typeof closeVendorDirPanel === 'function') closeVendorDirPanel(); });

document.getElementById('addInvoiceBtn').addEventListener('click', () => openInvoiceForm(null));
document.getElementById('closeInvoiceForm').addEventListener('click', closeInvoiceForm);
document.getElementById('cancelInvoiceForm').addEventListener('click', closeInvoiceForm);
document.getElementById('invoiceFormModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('invoiceFormModal')) closeInvoiceForm();
});

document.getElementById('closeInvoiceView').addEventListener('click', closeInvoiceView);
document.getElementById('closeInvoiceViewBtn').addEventListener('click', closeInvoiceView);
document.getElementById('invoiceViewModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('invoiceViewModal')) closeInvoiceView();
});

['invoiceFilterVenture', 'invoiceFilterCategory', 'invoiceFilterFrom', 'invoiceFilterTo'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderInvoiceCards);
});

document.getElementById('invoiceAddCategoryBtn').addEventListener('click', async () => {
    const input = document.getElementById('invoiceAddCategoryInput');
    const val = input.value.trim();
    if (!val) return;
    await saveInvoiceCategory(val);
    populateInvoiceFilterCategories();
    const dl = document.getElementById('invoiceCategoryList');
    if (dl) {
        dl.innerHTML = '';
        loadInvoiceCategories().forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            dl.appendChild(opt);
        });
    }
    input.value = '';
    showToast('Category "' + val + '" added');
});

document.getElementById('invoiceClearFilters').addEventListener('click', () => {
    document.getElementById('invoiceFilterVenture').value = 'all';
    document.getElementById('invoiceFilterCategory').value = 'all';
    document.getElementById('invoiceFilterFrom').value = '';
    document.getElementById('invoiceFilterTo').value = '';
    renderInvoiceCards();
});

const invoiceFileDrop = document.getElementById('invoiceFileDrop');
const invoiceFileInput = document.getElementById('invoiceFileInput');

invoiceFileDrop.addEventListener('click', () => invoiceFileInput.click());

invoiceFileDrop.addEventListener('dragover', (e) => {
    e.preventDefault();
    invoiceFileDrop.classList.add('drag-over');
});

invoiceFileDrop.addEventListener('dragleave', () => {
    invoiceFileDrop.classList.remove('drag-over');
});

invoiceFileDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    invoiceFileDrop.classList.remove('drag-over');
    handleInvoiceFiles(Array.from(e.dataTransfer.files));
});

invoiceFileInput.addEventListener('change', () => {
    handleInvoiceFiles(Array.from(invoiceFileInput.files));
    invoiceFileInput.value = '';
});

document.getElementById('saveInvoiceBtn').addEventListener('click', async () => {
    const ventureId = document.getElementById('invoiceVentureSelect').value;
    const category = document.getElementById('invoiceCategoryInput').value.trim();
    const purchaseDate = document.getElementById('invoiceDateInput').value;
    const amount = document.getElementById('invoiceAmountInput').value;
    const reason = document.getElementById('invoiceReasonInput').value.trim();

    if (!ventureId) { showToast('Please select a venture', true); return; }
    if (!category) { showToast('Please enter a category', true); return; }
    if (!purchaseDate) { showToast('Please select a purchase date', true); return; }
    if (!amount || parseFloat(amount) < 0) { showToast('Please enter a valid amount', true); return; }
    if (!reason) { showToast('Please enter a reason/description', true); return; }

    const venture = venturesList.find(v => v.id === ventureId);
    const invoices = loadAllInvoices();

    const invoiceData = {
        id: invoicesEditingId || generateId(),
        ventureId,
        ventureName: venture ? venture.name : '',
        category,
        purchaseDate,
        amount: parseFloat(amount),
        reason,
        vendor: document.getElementById('invoiceVendorInput').value.trim(),
        paymentMode: document.getElementById('invoicePaymentMode').value,
        attachments: invoiceAttachmentsBuffer.map(a => ({ name: a.name, type: a.type, dataUrl: a.dataUrl })),
        createdAt: invoicesEditingId ? (invoices.find(i => i.id === invoicesEditingId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: currentUser
    };

    if (invoicesEditingId) {
        const idx = invoices.findIndex(i => i.id === invoicesEditingId);
        if (idx >= 0) invoices[idx] = invoiceData;
        else invoices.push(invoiceData);
    } else {
        invoices.push(invoiceData);
    }

    await saveAllInvoices(invoices);
    await saveInvoiceCategory(category);
    populateInvoiceFilterCategories();
    closeInvoiceForm();
    renderInvoiceCards();
    showToast(invoicesEditingId ? 'Invoice updated' : 'Invoice saved');

    if (!document.getElementById('invoiceViewModal').classList.contains('show')) return;
    openInvoiceView(invoiceData.id);
});

document.getElementById('closeLightbox').addEventListener('click', closeLightbox);
document.getElementById('attachmentLightbox').addEventListener('click', (e) => {
    if (e.target === document.getElementById('attachmentLightbox')) closeLightbox();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('attachmentLightbox').style.display === 'flex') {
        closeLightbox();
    }
});

// ========================
// Purchase Orders Module
// ========================

if (typeof escapeHtml !== 'function') {
    function escapeHtml(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
}

let poEditingId = null;
let poDocBuffer = {};
let poPaymentAttBuffer = null;
let poPaymentTargetId = null;
let vendorEditingId = null;
let _vendorFromPOForm = false;

const PO_STATUS_LABELS = {
    draft: 'Draft',
    sent: 'Sent to Vendor',
    quoted: 'Vendor Quoted',
    approved: 'Approved',
    partial_delivered: 'Partially Delivered',
    delivered: 'Delivered',
    closed: 'Closed'
};

const PO_STATUS_COLORS = {
    draft: '#888',
    sent: '#3498db',
    quoted: '#9b59b6',
    approved: '#2980b9',
    partial_delivered: '#e67e22',
    delivered: '#27ae60',
    closed: '#1a2a6c'
};

function loadPOs() { return allPOs; }
async function savePOs(pos) {
    allPOs = pos;
    for (const po of pos) {
        await apiPost('/api/po', po);
    }
}
function loadVendors() { return allVendors; }
async function saveVendors(vendors) {
    allVendors = vendors;
    for (const v of vendors) {
        await apiPost('/api/vendor', v);
    }
}

function poAutoNumber() {
    const pos = loadPOs();
    const year = new Date().getFullYear().toString().slice(-2);
    const num = (pos.length + 1).toString().padStart(3, '0');
    return `PO-${year}-${num}`;
}

function getPOBalance(po) {
    const billed = parseFloat(po.billAmount) || 0;
    const quoted = parseFloat(po.quotedAmount) || 0;
    const base = billed || quoted;
    const paid = (po.payments || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    return { base, paid, outstanding: Math.max(0, base - paid) };
}

function isPOFlaggedUnpaid(po) {
    const { outstanding } = getPOBalance(po);
    return outstanding > 0 && (po.status === 'delivered' || po.status === 'closed' || po.status === 'partial_delivered');
}

async function openPOPanel() {
    hideAllMainPanels();
    document.getElementById('poPanel').style.display = '';
    await Promise.all([ensurePOsLoaded(), ensureVendorsLoaded()]);
    populatePOFilters();
    restorePanelState('po');
    renderPOCards();
    navigateTo('#/pos');
}

function closePOPanel() {
    renderVentureDashboard();
    navigateTo('#/ventures');
}

var _pb = document.getElementById('openPOBtn'); if (_pb) _pb.addEventListener('click', openPOPanel);
document.getElementById('backFromPO').addEventListener('click', closePOPanel);

function populatePOFilters() {
    const ventureSel = document.getElementById('poFilterVenture');
    ventureSel.innerHTML = '<option value="all">All Ventures</option>';
    venturesList.forEach(v => {
        const o = document.createElement('option');
        o.value = v.id; o.textContent = v.name;
        ventureSel.appendChild(o);
    });

    const vendorSel = document.getElementById('poFilterVendor');
    vendorSel.innerHTML = '<option value="all">All Vendors</option>';
    loadVendors().forEach(v => {
        const o = document.createElement('option');
        o.value = v.id; o.textContent = v.name;
        vendorSel.appendChild(o);
    });
}

['poFilterStatus','poFilterVenture','poFilterVendor','poFilterType','poFilterFrom','poFilterTo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', renderPOCards);
});

document.getElementById('poClearFilters').addEventListener('click', () => {
    ['poFilterStatus','poFilterVenture','poFilterVendor','poFilterType'].forEach(id => {
        document.getElementById(id).value = 'all';
    });
    document.getElementById('poFilterFrom').value = '';
    document.getElementById('poFilterTo').value = '';
    renderPOCards();
});

function renderPOCards() {
    const grid = document.getElementById('poCardsGrid');
    const banner = document.getElementById('poOutstandingBanner');
    grid.innerHTML = '';

    let pos = loadPOs().slice().sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || ''));

    const totalOutstanding = pos.reduce((s, po) => s + getPOBalance(po).outstanding, 0);
    const flaggedCount = pos.filter(isPOFlaggedUnpaid).length;

    if (totalOutstanding > 0) {
        banner.innerHTML = `
            <span class="po-banner-alert">&#9888; Total outstanding across all POs:</span>
            <span class="po-banner-amt">&#8377;${totalOutstanding.toLocaleString('en-IN', {maximumFractionDigits:0})}</span>
            ${flaggedCount > 0 ? `<span class="po-banner-flag">${flaggedCount} delivered but unpaid</span>` : ''}
        `;
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }

    const fStatus = document.getElementById('poFilterStatus').value;
    const fVenture = document.getElementById('poFilterVenture').value;
    const fVendor = document.getElementById('poFilterVendor').value;
    const fType = document.getElementById('poFilterType').value;
    const fFrom = document.getElementById('poFilterFrom').value;
    const fTo = document.getElementById('poFilterTo').value;

    if (fStatus !== 'all') pos = pos.filter(p => p.status === fStatus);
    if (fVenture !== 'all') pos = pos.filter(p => p.ventureId === fVenture);
    if (fVendor !== 'all') pos = pos.filter(p => p.vendorId === fVendor);
    if (fType !== 'all') pos = pos.filter(p => p.orderType === fType);
    if (fFrom) pos = pos.filter(p => (p.orderDate || '') >= fFrom);
    if (fTo) pos = pos.filter(p => (p.orderDate || '') <= fTo);

    if (pos.length === 0) {
        grid.innerHTML = '<div class="invoice-empty-state">No purchase orders found. Click "+ New PO" to create one.</div>';
        return;
    }

    pos.forEach(po => {
        const vendor = loadVendors().find(v => v.id === po.vendorId);
        const venture = venturesList.find(v => v.id === po.ventureId);
        const { base, paid, outstanding } = getPOBalance(po);
        const flagged = isPOFlaggedUnpaid(po);
        const dateDisplay = po.orderDate ? new Date(po.orderDate + 'T00:00:00').toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}) : '&#8212;';
        const statusColor = PO_STATUS_COLORS[po.status] || '#888';

        const card = document.createElement('div');
        card.className = 'po-card' + (flagged ? ' po-card-flagged' : '');
        card.dataset.poId = po.id;
        card.innerHTML = `
            <div class="po-card-top">
                <span class="po-card-number">${escapeHtml(po.poNumber || '&#8212;')}</span>
                <span class="po-card-status" style="background:${statusColor};">${PO_STATUS_LABELS[po.status] || po.status}</span>
            </div>
            <div class="po-card-vendor">${escapeHtml(vendor ? vendor.name : '&#8212;')}</div>
            <div class="po-card-desc">${escapeHtml((po.description || '').substring(0, 80))}${(po.description||'').length > 80 ? '&#8230;' : ''}</div>
            <div class="po-card-meta">
                <span>&#128197; ${dateDisplay}</span>
                ${po.orderType ? `<span>&#127991; ${escapeHtml(po.orderType)}</span>` : ''}
                ${venture ? `<span>&#127959; ${escapeHtml(venture.name)}</span>` : ''}
            </div>
            <div class="po-card-financials">
                <div class="po-fin-row">
                    <span class="po-fin-label">Billed</span>
                    <span class="po-fin-value">${base ? '&#8377;' + base.toLocaleString('en-IN', {maximumFractionDigits:0}) : '&#8212;'}</span>
                </div>
                <div class="po-fin-row">
                    <span class="po-fin-label">Paid</span>
                    <span class="po-fin-value po-fin-paid">${paid ? '&#8377;' + paid.toLocaleString('en-IN', {maximumFractionDigits:0}) : '&#8212;'}</span>
                </div>
                <div class="po-fin-row">
                    <span class="po-fin-label">Outstanding</span>
                    <span class="po-fin-value ${outstanding > 0 ? 'po-fin-outstanding' : 'po-fin-clear'}">${outstanding > 0 ? '&#8377;' + outstanding.toLocaleString('en-IN', {maximumFractionDigits:0}) : '&#10003; Clear'}</span>
                </div>
            </div>
            ${flagged ? '<div class="po-card-unpaid-flag">&#9888; Delivered &#8212; payment pending</div>' : ''}
        `;
        card.addEventListener('click', () => openPOView(po.id));
        grid.appendChild(card);
    });
}

const PO_DOC_SLOTS = [
    { key: 'orderSheet', label: 'Our Order Sheet / Requirement List', icon: '&#128203;' },
    { key: 'vendorProforma', label: 'Vendor Proforma / Quotation', icon: '&#128233;' },
    { key: 'finalBill', label: 'Vendor Final Bill / Tax Invoice', icon: '&#129534;' }
];

function renderPODocSlots(existingDocs) {
    const container = document.getElementById('poDocSlots');
    container.innerHTML = '';
    poDocBuffer = {};

    PO_DOC_SLOTS.forEach(slot => {
        const existing = existingDocs[slot.key];
        if (existing) poDocBuffer[slot.key] = existing;

        const div = document.createElement('div');
        div.className = 'po-doc-slot';
        div.innerHTML = `
            <div class="po-doc-slot-label">${slot.icon} ${slot.label}</div>
            <div class="po-doc-slot-body" id="poDocSlot_${slot.key}">
                ${existing
                    ? `<div class="po-doc-existing">
                           <span class="po-doc-filename">${escapeHtml(existing.name)}</span>
                           <button class="btn-text po-doc-view-btn" data-key="${slot.key}">View</button>
                           <button class="btn-text po-doc-remove-btn" data-key="${slot.key}" style="color:#c0392b;">Remove</button>
                       </div>`
                    : `<div class="invoice-file-drop po-doc-drop" data-key="${slot.key}">
                           <span>Click to upload</span>
                           <input type="file" class="po-doc-file-input" data-key="${slot.key}" accept="image/jpeg,image/png,image/webp,application/pdf" style="display:none;">
                       </div>`
                }
            </div>
        `;
        container.appendChild(div);
    });

    container.querySelectorAll('.po-doc-drop').forEach(drop => {
        const input = drop.querySelector('.po-doc-file-input');
        drop.addEventListener('click', () => input.click());
        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { showToast('File too large (max 5MB)', true); return; }
            const key = drop.dataset.key;
            const reader = new FileReader();
            reader.onload = e => {
                poDocBuffer[key] = { name: file.name, type: file.type, dataUrl: e.target.result };
                const slotBody = document.getElementById('poDocSlot_' + key);
                slotBody.innerHTML = `<div class="po-doc-existing">
                    <span class="po-doc-filename">${escapeHtml(file.name)}</span>
                    <button class="btn-text po-doc-remove-btn" data-key="${key}" style="color:#c0392b;">Remove</button>
                </div>`;
                wireDocSlotActions(slotBody, key);
            };
            reader.readAsDataURL(file);
            input.value = '';
        });
    });

    container.querySelectorAll('.po-doc-view-btn, .po-doc-remove-btn').forEach(btn => {
        const slotBody = document.getElementById('poDocSlot_' + btn.dataset.key);
        wireDocSlotActions(slotBody, btn.dataset.key);
    });
}

function wireDocSlotActions(slotBody, key) {
    const viewBtn = slotBody.querySelector('.po-doc-view-btn');
    const removeBtn = slotBody.querySelector('.po-doc-remove-btn');
    if (viewBtn) {
        viewBtn.addEventListener('click', () => {
            if (poDocBuffer[key]) openLightboxFromData(poDocBuffer[key]);
        });
    }
    if (removeBtn) {
        removeBtn.removeEventListener('click', removeBtn._handler);
        removeBtn._handler = () => {
            delete poDocBuffer[key];
            slotBody.innerHTML = `<div class="invoice-file-drop po-doc-drop" data-key="${key}">
                <span>Click to upload</span>
                <input type="file" class="po-doc-file-input" data-key="${key}" accept="image/jpeg,image/png,image/webp,application/pdf" style="display:none;">
            </div>`;
            const drop = slotBody.querySelector('.po-doc-drop');
            const input = slotBody.querySelector('.po-doc-file-input');
            drop.addEventListener('click', () => input.click());
            input.addEventListener('change', () => {
                const file = input.files[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) { showToast('File too large (max 5MB)', true); return; }
                const reader = new FileReader();
                reader.onload = e => {
                    poDocBuffer[key] = { name: file.name, type: file.type, dataUrl: e.target.result };
                    slotBody.innerHTML = `<div class="po-doc-existing">
                        <span class="po-doc-filename">${escapeHtml(file.name)}</span>
                        <button class="btn-text po-doc-view-btn" data-key="${key}">View</button>
                        <button class="btn-text po-doc-remove-btn" data-key="${key}" style="color:#c0392b;">Remove</button>
                    </div>`;
                    wireDocSlotActions(slotBody, key);
                };
                reader.readAsDataURL(file);
                input.value = '';
            });
        };
        removeBtn.addEventListener('click', removeBtn._handler);
    }
}

function openLightboxFromData(att) {
    if (typeof openLightbox === 'function') {
        openLightbox(att);
        return;
    }
    const win = window.open();
    if (att.type && att.type.startsWith('image/')) {
        win.document.write(`<img src="${att.dataUrl}" style="max-width:100%;">`);
    } else {
        win.document.write(`<embed src="${att.dataUrl}" type="application/pdf" width="100%" height="100%" style="height:100vh;">`);
    }
}

function openPOForm(poId) {
    poEditingId = poId;
    poDocBuffer = {};
    document.getElementById('poFormTitle').textContent = poId ? 'Edit Purchase Order' : 'New Purchase Order';

    const ventureSel = document.getElementById('poVentureSelect');
    ventureSel.innerHTML = '<option value="">General / Company-level</option>';
    venturesList.forEach(v => {
        const o = document.createElement('option');
        o.value = v.id; o.textContent = v.name;
        ventureSel.appendChild(o);
    });

    populatePOVendorSelect();

    document.getElementById('poDateInput').value = new Date().toISOString().split('T')[0];
    document.getElementById('poNumberInput').value = poId ? '' : poAutoNumber();
    document.getElementById('poTypeInput').value = '';
    document.getElementById('poVendorSelect').value = '';
    document.getElementById('poVentureSelect').value = '';
    document.getElementById('poLocationInput').value = '';
    document.getElementById('poDescInput').value = '';
    document.getElementById('poQuotedAmtInput').value = '';
    document.getElementById('poBillAmtInput').value = '';
    document.getElementById('poStatusInput').value = 'draft';
    document.getElementById('poDeliveryDateInput').value = '';
    document.getElementById('poNotesInput').value = '';

    let existingDocs = {};

    if (poId) {
        const po = loadPOs().find(p => p.id === poId);
        if (po) {
            document.getElementById('poNumberInput').value = po.poNumber || '';
            document.getElementById('poDateInput').value = po.orderDate || '';
            document.getElementById('poTypeInput').value = po.orderType || '';
            document.getElementById('poVendorSelect').value = po.vendorId || '';
            document.getElementById('poVentureSelect').value = po.ventureId || '';
            document.getElementById('poLocationInput').value = po.location || '';
            document.getElementById('poDescInput').value = po.description || '';
            document.getElementById('poQuotedAmtInput').value = po.quotedAmount || '';
            document.getElementById('poBillAmtInput').value = po.billAmount || '';
            document.getElementById('poStatusInput').value = po.status || 'draft';
            document.getElementById('poDeliveryDateInput').value = po.deliveryDate || '';
            document.getElementById('poNotesInput').value = po.notes || '';
            existingDocs = po.documents || {};
        }
    }

    renderPODocSlots(existingDocs);
    document.getElementById('poFormModal').classList.add('show');
}

function populatePOVendorSelect(selectedId) {
    const sel = document.getElementById('poVendorSelect');
    const current = selectedId || sel.value;
    sel.innerHTML = '<option value="">-- Select Vendor --</option>';
    loadVendors().forEach(v => {
        const o = document.createElement('option');
        o.value = v.id; o.textContent = v.name;
        sel.appendChild(o);
    });
    if (current) sel.value = current;
}

function closePOForm() {
    document.getElementById('poFormModal').classList.remove('show');
    poEditingId = null;
    poDocBuffer = {};
}

document.getElementById('addPOBtn').addEventListener('click', () => openPOForm(null));
document.getElementById('closePOForm').addEventListener('click', closePOForm);
document.getElementById('cancelPOForm').addEventListener('click', closePOForm);
document.getElementById('poFormModal').addEventListener('click', e => {
    if (e.target === document.getElementById('poFormModal')) closePOForm();
});

document.getElementById('poAddVendorInlineBtn').addEventListener('click', () => {
    openVendorForm(null, true);
});

document.getElementById('savePOBtn').addEventListener('click', async () => {
    const vendorId = document.getElementById('poVendorSelect').value;
    const desc = document.getElementById('poDescInput').value.trim();
    const orderDate = document.getElementById('poDateInput').value;
    const status = document.getElementById('poStatusInput').value;

    if (!vendorId) { showToast('Please select a vendor', true); return; }
    if (!desc) { showToast('Please enter items / description', true); return; }
    if (!orderDate) { showToast('Please select an order date', true); return; }

    const pos = loadPOs();
    const existing = poEditingId ? pos.find(p => p.id === poEditingId) : null;

    const poData = {
        id: poEditingId || generateId(),
        poNumber: document.getElementById('poNumberInput').value.trim() || poAutoNumber(),
        orderDate,
        orderType: document.getElementById('poTypeInput').value,
        vendorId,
        ventureId: document.getElementById('poVentureSelect').value || null,
        location: document.getElementById('poLocationInput').value.trim(),
        description: desc,
        quotedAmount: parseFloat(document.getElementById('poQuotedAmtInput').value) || null,
        billAmount: parseFloat(document.getElementById('poBillAmtInput').value) || null,
        status,
        deliveryDate: document.getElementById('poDeliveryDateInput').value || null,
        notes: document.getElementById('poNotesInput').value.trim(),
        documents: { ...poDocBuffer },
        payments: existing ? (existing.payments || []) : [],
        createdAt: existing ? existing.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: currentUser
    };

    if (poEditingId) {
        const idx = pos.findIndex(p => p.id === poEditingId);
        if (idx >= 0) pos[idx] = poData; else pos.push(poData);
    } else {
        pos.push(poData);
    }

    await savePOs(pos);
    showToast(poEditingId ? 'PO updated' : 'PO created');
    closePOForm();
    renderPOCards();
});

function openPOView(poId) {
    const po = loadPOs().find(p => p.id === poId);
    if (!po) return;

    const vendor = loadVendors().find(v => v.id === po.vendorId);
    const venture = venturesList.find(v => v.id === po.ventureId);
    const { base, paid, outstanding } = getPOBalance(po);
    const dateDisplay = po.orderDate ? new Date(po.orderDate + 'T00:00:00').toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}) : '&#8212;';
    const statusColor = PO_STATUS_COLORS[po.status] || '#888';

    document.getElementById('poViewTitle').textContent = `${po.poNumber || 'PO'} &#8212; ${escapeHtml(vendor ? vendor.name : '&#8212;')}`;

    const body = document.getElementById('poViewBody');
    const docsHtml = PO_DOC_SLOTS.map(slot => {
        const doc = po.documents?.[slot.key];
        return `<div class="po-view-doc-row">
            <span class="po-view-doc-label">${slot.icon} ${slot.label}</span>
            ${doc
                ? `<button class="btn-text po-view-doc-btn" data-key="${slot.key}">View (${escapeHtml(doc.name)})</button>`
                : `<span class="po-view-doc-none">Not uploaded</span>`
            }
        </div>`;
    }).join('');

    const paymentsHtml = (po.payments && po.payments.length > 0)
        ? po.payments.map((p, i) => {
            const pd = p.date ? new Date(p.date + 'T00:00:00').toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}) : '&#8212;';
            return `<div class="po-pay-row">
                <span class="po-pay-date">${pd}</span>
                <span class="po-pay-mode">${escapeHtml(p.mode || '')}</span>
                <span class="po-pay-note">${escapeHtml(p.note || '')}</span>
                <span class="po-pay-amt">&#8377;${parseFloat(p.amount).toLocaleString('en-IN', {maximumFractionDigits:0})}</span>
                ${p.proof ? `<button class="btn-text po-pay-proof-btn" data-idx="${i}">Receipt</button>` : ''}
            </div>`;
        }).join('')
        : '<div class="po-view-doc-none">No payments recorded yet.</div>';

    body.innerHTML = `
        <div class="po-view-status-bar">
            <span class="po-view-status-badge" style="background:${statusColor};">${PO_STATUS_LABELS[po.status] || po.status}</span>
            ${isPOFlaggedUnpaid(po) ? '<span class="po-view-unpaid-flag">&#9888; Delivered &#8212; payment pending</span>' : ''}
        </div>

        <div class="inv-view-grid" style="margin-bottom:12px;">
            <div class="inv-view-field"><span class="inv-view-label">PO Number</span><span class="inv-view-value">${escapeHtml(po.poNumber || '&#8212;')}</span></div>
            <div class="inv-view-field"><span class="inv-view-label">Order Date</span><span class="inv-view-value">${dateDisplay}</span></div>
            <div class="inv-view-field"><span class="inv-view-label">Vendor</span><span class="inv-view-value">${escapeHtml(vendor ? vendor.name : '&#8212;')}</span></div>
            <div class="inv-view-field"><span class="inv-view-label">Type</span><span class="inv-view-value">${escapeHtml(po.orderType || '&#8212;')}</span></div>
            ${venture ? `<div class="inv-view-field"><span class="inv-view-label">Venture</span><span class="inv-view-value">${escapeHtml(venture.name)}</span></div>` : ''}
            ${po.location ? `<div class="inv-view-field"><span class="inv-view-label">Location</span><span class="inv-view-value">${escapeHtml(po.location)}</span></div>` : ''}
            ${po.deliveryDate ? `<div class="inv-view-field"><span class="inv-view-label">Expected Delivery</span><span class="inv-view-value">${po.deliveryDate}</span></div>` : ''}
        </div>

        <div class="inv-view-reason"><span class="inv-view-label">Description</span><p>${escapeHtml(po.description)}</p></div>

        <div class="po-view-financials">
            <div class="po-fin-card"><div class="att-rc-label">Quoted / PO Value</div><div class="att-rc-value po-fin-masked" data-value="${po.quotedAmount ? '&#8377;' + parseFloat(po.quotedAmount).toLocaleString('en-IN', {maximumFractionDigits:0}) : '&#8212;'}">****</div></div>
            <div class="po-fin-card"><div class="att-rc-label">Final Billed</div><div class="att-rc-value po-fin-masked" data-value="${base ? '&#8377;' + base.toLocaleString('en-IN', {maximumFractionDigits:0}) : '&#8212;'}">****</div></div>
            <div class="po-fin-card"><div class="att-rc-label">Total Paid</div><div class="att-rc-value att-rc-green po-fin-masked" data-value="&#8377;${paid.toLocaleString('en-IN', {maximumFractionDigits:0})}">****</div></div>
            <div class="po-fin-card ${outstanding > 0 ? 'po-fin-card-danger' : ''}"><div class="att-rc-label">Outstanding</div><div class="att-rc-value ${outstanding > 0 ? 'po-outstanding-val' : 'att-rc-green'} po-fin-masked" data-value="${outstanding > 0 ? '&#8377;' + outstanding.toLocaleString('en-IN', {maximumFractionDigits:0}) : '&#10003; Fully paid'}">****</div></div>
            <button class="po-eye-toggle" title="Show/hide amounts">&#128065;</button>
        </div>

        <div class="po-view-section-label">Documents</div>
        <div class="po-view-docs">${docsHtml}</div>

        <div class="po-view-section-label">Payment History</div>
        <div class="po-view-payments">${paymentsHtml}</div>

        ${po.notes ? `<div class="inv-view-reason" style="margin-top:8px;"><span class="inv-view-label">Notes</span><p>${escapeHtml(po.notes)}</p></div>` : ''}
        <div class="inv-view-meta">Created by ${escapeHtml(po.createdBy || '&#8212;')} &#183; ${po.createdAt ? new Date(po.createdAt).toLocaleDateString('en-IN') : ''}</div>
    `;

    body.querySelectorAll('.po-view-doc-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const doc = po.documents?.[btn.dataset.key];
            if (doc) openLightboxFromData(doc);
        });
    });

    body.querySelectorAll('.po-pay-proof-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pay = po.payments[parseInt(btn.dataset.idx)];
            if (pay && pay.proof) openLightboxFromData(pay.proof);
        });
    });

    const eyeBtn = body.querySelector('.po-eye-toggle');
    if (eyeBtn) {
        eyeBtn.addEventListener('click', () => {
            const masked = body.querySelectorAll('.po-fin-masked');
            const isHidden = masked.length > 0 && masked[0].textContent === '****';
            if (isHidden) {
                const pin = prompt('Enter PIN to view amounts:');
                if (pin === '1313') {
                    masked.forEach(el => { el.textContent = el.dataset.value; el.classList.remove('po-fin-masked'); });
                    eyeBtn.innerHTML = '&#128064;';
                } else {
                    showToast('Incorrect PIN', true);
                }
            } else {
                const values = body.querySelectorAll('.po-view-financials .att-rc-value');
                values.forEach(el => {
                    if (!el.dataset.value) el.dataset.value = el.textContent;
                    el.textContent = '****';
                    el.classList.add('po-fin-masked');
                });
                eyeBtn.innerHTML = '&#128065;';
            }
        });
    }

    document.getElementById('editPOBtn').onclick = () => { closePOView(); openPOForm(poId); };
    document.getElementById('addPaymentBtn').onclick = () => openPaymentModal(poId);
    document.getElementById('deletePOBtn').onclick = () => {
        showConfirm('Delete PO', 'Delete PO ' + (po.poNumber || '') + '? This cannot be undone.', async () => {
            try {
                await apiDelete('/api/po/' + encodeURIComponent(poId));
                allPOs = loadPOs().filter(p => p.id !== poId);
                closePOView();
                renderPOCards();
                showToast('PO deleted');
            } catch (err) {
                console.error('Failed to delete PO:', err);
                showToast('Delete failed — please retry', true);
            }
        }, null, 'Delete', true);
    };

    document.getElementById('poViewModal').classList.add('show');
}

function closePOView() {
    document.getElementById('poViewModal').classList.remove('show');
}

document.getElementById('closePOView').addEventListener('click', closePOView);
document.getElementById('poViewModal').addEventListener('click', e => {
    if (e.target === document.getElementById('poViewModal')) closePOView();
});

function openPaymentModal(poId) {
    poPaymentTargetId = poId;
    poPaymentAttBuffer = null;

    const po = loadPOs().find(p => p.id === poId);
    const { outstanding } = getPOBalance(po);

    document.getElementById('payDateInput').value = new Date().toISOString().split('T')[0];
    document.getElementById('payAmountInput').value = outstanding > 0 ? outstanding : '';
    document.getElementById('payModeInput').value = '';
    document.getElementById('payRefInput').value = '';
    document.getElementById('payNoteInput').value = '';
    document.getElementById('payFileLabel').textContent = 'Click to attach proof';
    document.getElementById('payFilePreview').innerHTML = '';

    document.getElementById('paymentModal').classList.add('show');
}

function closePaymentModal() {
    document.getElementById('paymentModal').classList.remove('show');
    poPaymentTargetId = null;
    poPaymentAttBuffer = null;
}

document.getElementById('closePaymentModal').addEventListener('click', closePaymentModal);
document.getElementById('cancelPayment').addEventListener('click', closePaymentModal);
document.getElementById('paymentModal').addEventListener('click', e => {
    if (e.target === document.getElementById('paymentModal')) closePaymentModal();
});

const payFileDrop = document.getElementById('payFileDrop');
const payFileInput = document.getElementById('payFileInput');
payFileDrop.addEventListener('click', () => payFileInput.click());
payFileInput.addEventListener('change', () => {
    const file = payFileInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('File too large (max 5MB)', true); return; }
    const reader = new FileReader();
    reader.onload = e => {
        poPaymentAttBuffer = { name: file.name, type: file.type, dataUrl: e.target.result };
        document.getElementById('payFileLabel').textContent = file.name;
        document.getElementById('payFilePreview').innerHTML = file.type.startsWith('image/')
            ? `<img src="${e.target.result}" style="max-height:60px;border-radius:4px;margin-top:4px;">`
            : `<span style="font-size:0.78rem;color:#555;">PDF attached: ${escapeHtml(file.name)}</span>`;
    };
    reader.readAsDataURL(file);
    payFileInput.value = '';
});

document.getElementById('savePaymentBtn').addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('payAmountInput').value);
    const date = document.getElementById('payDateInput').value;
    if (!date) { showToast('Please select a payment date', true); return; }
    if (!amount || amount <= 0) { showToast('Please enter a valid amount', true); return; }

    const pos = loadPOs();
    const po = pos.find(p => p.id === poPaymentTargetId);
    if (!po) return;

    if (!po.payments) po.payments = [];
    po.payments.push({
        id: generateId(),
        date,
        amount,
        mode: document.getElementById('payModeInput').value,
        ref: document.getElementById('payRefInput').value.trim(),
        note: document.getElementById('payNoteInput').value.trim(),
        proof: poPaymentAttBuffer || null,
        recordedBy: currentUser,
        recordedAt: new Date().toISOString()
    });

    po.updatedAt = new Date().toISOString();

    const { outstanding } = getPOBalance(po);
    if (outstanding <= 0 && po.status !== 'closed') {
        po.status = 'closed';
        showToast('Payment saved &#8212; PO marked as Closed (fully paid)');
    } else {
        showToast(`Payment of &#8377;${amount.toLocaleString('en-IN')} recorded. Outstanding: &#8377;${outstanding.toLocaleString('en-IN', {maximumFractionDigits:0})}`);
    }

    await savePOs(pos);
    closePaymentModal();
    renderPOCards();
    openPOView(poPaymentTargetId);
});

async function openVendorDirectory() {
    await ensureVendorsLoaded();
    renderVendorDirList();
    document.getElementById('vendorDirModal').classList.add('show');
}

function closeVendorDirectory() {
    document.getElementById('vendorDirModal').classList.remove('show');
}

function renderVendorDirList() {
    const list = document.getElementById('vendorDirList');
    list.innerHTML = '';
    const vendors = loadVendors();

    if (vendors.length === 0) {
        list.innerHTML = '<div class="att-empty" style="padding:24px 0;">No vendors yet. Click "+ Add Vendor" to get started.</div>';
        return;
    }

    vendors.forEach(v => {
        const div = document.createElement('div');
        div.className = 'att-roster-row';
        div.innerHTML = `
            <div class="att-roster-info">
                <div class="att-roster-name">${escapeHtml(v.name)}</div>
                <div class="att-roster-meta">
                    ${v.type ? escapeHtml(v.type) + ' &#183; ' : ''}
                    ${v.phone ? '&#128222; ' + escapeHtml(v.phone) : ''}
                    ${v.gstin ? ' &#183; GSTIN: ' + escapeHtml(v.gstin) : ''}
                </div>
            </div>
            <div class="att-roster-actions">
                <button class="btn-text edit-vendor-btn" data-id="${v.id}">Edit</button>
                <button class="btn-text del-vendor-btn" data-id="${v.id}" style="color:#c0392b;">Delete</button>
            </div>
        `;
        div.querySelector('.edit-vendor-btn').addEventListener('click', () => openVendorForm(v.id));
        div.querySelector('.del-vendor-btn').addEventListener('click', () => {
            showConfirm('Delete Vendor', 'Delete ' + v.name + '? POs referencing this vendor will still exist.', async () => {
                try {
                    await apiDelete('/api/vendor/' + encodeURIComponent(v.id));
                    allVendors = loadVendors().filter(x => x.id !== v.id);
                    renderVendorDirList();
                    populatePOFilters();
                    showToast('Vendor deleted');
                } catch (err) {
                    console.error('Failed to delete vendor:', err);
                    showToast('Delete failed — please retry', true);
                }
            }, null, 'Delete', true);
        });
        list.appendChild(div);
    });
}

document.getElementById('openVendorDirectoryBtn').addEventListener('click', openVendorDirectory);
const openVendorsBtn = document.getElementById('openVendorsBtn');
if (openVendorsBtn) openVendorsBtn.addEventListener('click', openVendorDirectory);
document.getElementById('closeVendorDir').addEventListener('click', closeVendorDirectory);
document.getElementById('vendorDirModal').addEventListener('click', e => {
    if (e.target === document.getElementById('vendorDirModal')) closeVendorDirectory();
});
document.getElementById('addVendorBtn').addEventListener('click', () => openVendorForm(null));

var _vdAddVendorBtn = document.getElementById('vdAddVendorBtn');
if (_vdAddVendorBtn) _vdAddVendorBtn.addEventListener('click', () => openVendorForm(null));

async function openVendorForm(vendorId, fromPOForm) {
    vendorEditingId = vendorId;
    _vendorFromPOForm = fromPOForm || false;
    document.getElementById('vendorFormTitle').textContent = vendorId ? 'Edit Vendor' : 'Add Vendor';

    ['vendorNameInput','vendorContactInput','vendorPhoneInput','vendorEmailInput',
     'vendorGSTInput','vendorAddressInput','vendorBankNameInput','vendorAccNoInput',
     'vendorIFSCInput','vendorAccHolderInput','vendorNotesInput'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('vendorTypeInput').value = '';

    // Populate venture dropdown
    var ventureSel = document.getElementById('vendorVentureInput');
    if (ventureSel) {
        ventureSel.innerHTML = '<option value="">-- All Ventures --</option>';
        if (typeof venturesList !== 'undefined') {
            venturesList.forEach(function(v) {
                var o = document.createElement('option');
                o.value = v.id; o.textContent = v.name;
                ventureSel.appendChild(o);
            });
        }
        ventureSel.value = '';
    }

    if (vendorId) {
        // Ensure allVendors is loaded from /api/vendors before lookup
        if (typeof ensureVendorsLoaded === 'function') {
            await ensureVendorsLoaded();
        }
        const v = loadVendors().find(x => x.id === vendorId);
        if (v) {
            document.getElementById('vendorNameInput').value = v.name || '';
            document.getElementById('vendorContactInput').value = v.contact || '';
            document.getElementById('vendorPhoneInput').value = v.phone || '';
            document.getElementById('vendorEmailInput').value = v.email || '';
            document.getElementById('vendorGSTInput').value = v.gstin || '';
            document.getElementById('vendorTypeInput').value = v.type || '';
            document.getElementById('vendorAddressInput').value = v.address || '';
            document.getElementById('vendorBankNameInput').value = v.bankName || '';
            document.getElementById('vendorAccNoInput').value = v.accountNo || '';
            document.getElementById('vendorIFSCInput').value = v.ifsc || '';
            document.getElementById('vendorAccHolderInput').value = v.accountHolder || '';
            document.getElementById('vendorNotesInput').value = v.notes || '';
            if (ventureSel) ventureSel.value = v.venture_id || v.ventureId || '';
        }
    }

    document.getElementById('vendorFormModal').classList.add('show');
}

function closeVendorForm() {
    document.getElementById('vendorFormModal').classList.remove('show');
    vendorEditingId = null;
}

document.getElementById('closeVendorForm').addEventListener('click', closeVendorForm);
document.getElementById('cancelVendorForm').addEventListener('click', closeVendorForm);
document.getElementById('vendorFormModal').addEventListener('click', e => {
    if (e.target === document.getElementById('vendorFormModal')) closeVendorForm();
});

document.getElementById('saveVendorBtn').addEventListener('click', async () => {
    const name = document.getElementById('vendorNameInput').value.trim();
    const phone = document.getElementById('vendorPhoneInput').value.trim();
    if (!name) { showToast('Please enter a vendor name', true); return; }
    if (!phone) { showToast('Please enter a phone number', true); return; }

    const vendors = loadVendors();
    const vendorData = {
        id: vendorEditingId || generateId(),
        name,
        contact: document.getElementById('vendorContactInput').value.trim(),
        phone,
        email: document.getElementById('vendorEmailInput').value.trim(),
        gstin: document.getElementById('vendorGSTInput').value.trim(),
        type: document.getElementById('vendorTypeInput').value,
        venture_id: document.getElementById('vendorVentureInput').value || '',
        address: document.getElementById('vendorAddressInput').value.trim(),
        bankName: document.getElementById('vendorBankNameInput').value.trim(),
        accountNo: document.getElementById('vendorAccNoInput').value.trim(),
        ifsc: document.getElementById('vendorIFSCInput').value.trim(),
        accountHolder: document.getElementById('vendorAccHolderInput').value.trim(),
        notes: document.getElementById('vendorNotesInput').value.trim(),
        createdAt: vendorEditingId ? (vendors.find(v => v.id === vendorEditingId)?.createdAt || new Date().toISOString()) : new Date().toISOString()
    };

    if (vendorEditingId) {
        const idx = vendors.findIndex(v => v.id === vendorEditingId);
        if (idx >= 0) vendors[idx] = vendorData; else vendors.push(vendorData);
    } else {
        vendors.push(vendorData);
    }

    try {
        await apiPost('/api/vendor', vendorData);
        showToast(vendorEditingId ? 'Vendor updated' : 'Vendor added');
        closeVendorForm();

        // Refresh cached vendor list from server
        _vendorsLoaded = false;
        await ensureVendorsLoaded();

        renderVendorDirList();
        populatePOFilters();

        // Always refresh vendor directory panel
        if (typeof renderVendorDirectoryView === 'function') {
            renderVendorDirectoryView();
        }

        if (_vendorFromPOForm) {
            populatePOVendorSelect(vendorData.id);
        }
    } catch (err) {
        var errMsg = err.message || '';
        var match = errMsg.match(/\{.*\}/);
        if (match) {
            try { var j = JSON.parse(match[0]); if (j.error) errMsg = j.error; } catch (_) {}
        }
        showToast(errMsg || 'Failed to save vendor', true);
    }
});
