// ========================
// API Persistence
// ========================

async function apiGet(path) {
    const res = await fetch(path);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
}

async function apiPost(path, data) {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
}

async function apiDelete(path) {
    await fetch(path, { method: 'DELETE' });
}

function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ========================
// App State
// ========================
let currentUser = null;
let currentUserRole = null;
let currentUserPermissions = {};
let currentVenture = null;
let currentBlockObj = null;
let currentBlock = 'A';
let currentFloor = 1;
let workItems = [];
let cellsCache = {};
const pendingSaves = new Map(); // cellKey -> debounce timeout
let bulkMode = false;
let bulkSelectedColor = null; // when set, clicking a cell instantly applies this color (paint mode)
const bulkSelected = new Set(); // set of cacheKeys selected in bulk mode
let selectedCellId = null;
let selectedWorkItem = null;
let selectedFlat = null;
let venturesList = [];
let remarksImagesBuffer = [];

// Global caches for invoices, POs, vendors, categories (loaded once at init)
let allInvoices = [];
let allCategories = [];
let allPOs = [];
let allVendors = [];

const DEFAULT_WORK_ITEMS = [
    "BRICK WORK", "ELECTRICAL PIPES", "MESH", "PLASTERING",
    "CEILING PAINT", "POP FRAME", "CEILING WIRING", "POP SHEETS",
    "WALL CARE", "BATHROOM PLUMBING", "WINDOW FRAME", "BATH SWR LINES",
    "BATH CONCEALING", "TILES", "DOORS FITTING", "PAINT PRIMER",
    "PAINT 1st COAT", "WINDOWS PAINT", "SWITCH BOARD FITTING",
    "PATCH WORK", "2nd COAT PAINTING"
];

const COLOR_LABELS = {
    red: 'Yet to start',
    yellow: 'In progress',
    blue: 'Patch work',
    green: 'Completed'
};

const FLATS_PER_FLOOR = 6;

const WORK_CATEGORIES = {
    'CIVIL WORK': [
        "Brick work", "Lintel", "Lanter", "Mesh", "Mesh & Brickwork NCC",
        "Connections", "Lift", "Cupboards", "Red Oxide Duraplus Primer",
        "Red Oxide Duraplus Primer (2nd coat)", "Bathroom Service Chargable"
    ],
    'ELECTRICAL & PLUMBING WORK': [
        "Electrical pipe", "Pipe & GI box", "Wiring",
        "Bathroom Chipped", "Bathroom Geyser Pipe",
        "Bathroom Geyser & Pipes", "Sanitary Board & Nand",
        "GC & Bath Fitting"
    ],
    'POP CEILING': [
        "Pop bolster work", "Pop ready work", "Casing",
        "Balloon PVC Box Fitting", "Connections / Measurement"
    ],
    'PAINTING': [
        "Colour Primer", "Wall Care Plaster",
        "Wall Care Slastoat", "Wall Primer", "Primer",
        "Colour to Edge"
    ],
    'FLOORING': [
        "Bathroom Wall Tiles", "Tile Laying",
        "Tile Cutting", "Connections", "Window Dhanis",
        "Colour to Edge", "Wedding Dhanis"
    ],
    'CORRIDORS': [
        { id: 'corridor_0', label: 'Plaster' },
        { id: 'corridor_1', label: 'Mesh' },
        { id: 'corridor_2', label: 'Lanter' },
        { id: 'corridor_3', label: 'Wiring' },
        { id: 'corridor_4', label: 'Stains & Cleaning' },
        { id: 'corridor_5', label: 'Flooring' }
    ],
    'ELEVATION WORK': [
        { id: 'elevation_0', label: 'Marka' },
        { id: 'elevation_1', label: 'Elevation' },
        { id: 'elevation_2', label: 'Electrics' },
        { id: 'elevation_3', label: 'Wall Care' },
        { id: 'elevation_4', label: 'Texture' }
    ]
};

// Special categories that render against a single P-004 flat instead of regular flat numbers
const CATEGORY_FLATS = {
    'CORRIDORS': ['P-004'],
    'ELEVATION WORK': ['P-004']
};

const SUPER_STRUCTURE_ITEMS = [
    "Site Preparation", "Excavation", "Marking", "Piles", "Piles Concrete",
    "Pile Caps", "Plinth Beam", "Plinth Wall", "Filling", "40mm Bed",
    "Sunken Tank", "Columns for 1st Slab", "Slab Shuttering for 1st Slab", "Bar Bending for 1st Slab", "Electrical Pipes",
    "1st Slab Casting", "Columns for 2nd Slab", "Shuttering for 2nd Slab", "Bar Bending for 2nd Slab", "Electrical Pipes",
    "2nd Slab Casting", "Columns for 3rd Slab", "Slab Shuttering for 3rd Slab", "Bar Bending for 3rd Slab", "Electrical Pipes",
    "3rd Slab Casting", "Columns for 4th Slab", "Slab Shuttering for 4th Slab", "Bar Bending for 4th Slab", "Electrical Pipes",
    "4th Slab Casting", "Columns for 5th Slab", "Slab Shuttering for 5th Slab", "Bar Bending for 5th Slab", "Electrical Pipes",
    "5th Slab Casting", "Columns for 6th Slab", "Slab Shuttering for 6th Slab", "Bar Bending for 6th Slab", "Electrical Pipes",
    "6th Slab Casting", "Columns for Lift Tank & Stairs", "Shuttering for Above", "Slab Casting", "Water Tank Bar Bending",
    "Water Tank NCC", "Elevation Scaffolding", "Elevation Mess & Packing", "Elevation Brick Work", "Elevation (Plastering)",
    "Electrical SWM & Plumbing Outside Lines", "1M CH Work", "Scaffolding Removal", "Patch Work", "Elevation Texture",
    "Elevation Primer", "Elevation Paint 1st Coat", "Compound Wall Columns & Beam", "Compound Wall Brick & Plastering",
    "Compound Wall Paint", "Final Coat"
];

let currentView = 'flat';
let editMode = false;
let archivedItems = {};
let pendingFilterFloor = 'all';
let pendingFilterFlat = 'all';
let lastPendingRows = [];
let homeQuickReportType = 'reports';
let homeQuickReportVenture = null;
let homeQuickReportBlock = null;
let homeQuickReportFloor = 1;
let homeQuickReportFlat = 'all';

// ========================
// URL Router & State Persistence
// ========================
const APP_STATE_KEY = 'vgrand_app_state';

function getElValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

function setElValue(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.value = value;
}

function buildPanelState() {
    return {
        invoices: {
            venture: getElValue('invoiceFilterVenture'),
            category: getElValue('invoiceFilterCategory'),
            from: getElValue('invoiceFilterFrom'),
            to: getElValue('invoiceFilterTo')
        },
        po: {
            status: getElValue('poFilterStatus'),
            venture: getElValue('poFilterVenture'),
            vendor: getElValue('poFilterVendor'),
            type: getElValue('poFilterType'),
            from: getElValue('poFilterFrom'),
            to: getElValue('poFilterTo')
        },
        payroll: {
            selectedVentureId: selectedPayrollVenture ? selectedPayrollVenture.id : null
        },
        inventory: {
            selectedVentureId: selectedInventoryVenture ? selectedInventoryVenture.id : null,
            tab: inventoryTab,
            regType: inventoryRegTypeFilter,
            regMaterial: inventoryRegMaterialFilter,
            locMaterial: inventoryLocMaterialFilter,
            locBlock: inventoryLocBlockFilter,
            locFloor: inventoryLocFloorFilter,
            vendor: inventoryVendorFilter,
            vendorMaterial: inventoryVendorMaterialFilter
        }
    };
}

function saveAppState() {
    const state = {
        hash: window.location.hash,
        panelState: buildPanelState()
    };
    try {
        localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
    } catch (e) {}
}

function loadAppState() {
    try {
        return JSON.parse(localStorage.getItem(APP_STATE_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function restorePanelState(panel) {
    const state = loadAppState().panelState || {};
    const p = state[panel];
    if (!p) return;
    if (panel === 'invoices') {
        setElValue('invoiceFilterVenture', p.venture);
        setElValue('invoiceFilterCategory', p.category);
        setElValue('invoiceFilterFrom', p.from);
        setElValue('invoiceFilterTo', p.to);
    } else if (panel === 'po') {
        setElValue('poFilterStatus', p.status);
        setElValue('poFilterVenture', p.venture);
        setElValue('poFilterVendor', p.vendor);
        setElValue('poFilterType', p.type);
        setElValue('poFilterFrom', p.from);
        setElValue('poFilterTo', p.to);
    } else if (panel === 'payroll') {
        if (p.selectedVentureId) {
            selectedPayrollVenture = venturesList.find(v => v.id === p.selectedVentureId) || null;
        }
    } else if (panel === 'inventory') {
        if (p.selectedVentureId) {
            selectedInventoryVenture = venturesList.find(v => v.id === p.selectedVentureId) || null;
        }
        if (p.tab) inventoryTab = p.tab;
        inventoryRegTypeFilter = p.regType || 'all';
        inventoryRegMaterialFilter = p.regMaterial || 'all';
        inventoryLocMaterialFilter = p.locMaterial || 'all';
        inventoryLocBlockFilter = p.locBlock || 'all';
        inventoryLocFloorFilter = p.locFloor || 'all';
        inventoryVendorFilter = p.vendor || 'all';
        inventoryVendorMaterialFilter = p.vendorMaterial || 'all';
    }
}

function buildTrackerRoute() {
    if (!currentVenture) return '#/ventures';
    const block = currentBlock || 'A';
    const floor = currentFloor || 1;
    const view = ['flat', 'work', 'super'].includes(currentView) ? currentView : 'flat';
    return `#/venture/${encodeURIComponent(currentVenture.id)}/${block}/${floor}/${view}`;
}

let ignoreNextHashChange = false;

function navigateTo(hash) {
    const target = hash.startsWith('#') ? hash : '#' + hash;
    if (window.location.hash !== target) {
        ignoreNextHashChange = true;
        window.location.hash = target;
    } else {
        saveAppState();
    }
}

function parseHash(hash) {
    const h = (hash || window.location.hash).replace(/^#/, '');
    if (!h) return { route: 'ventures' };
    const parts = h.split('/').filter(Boolean);
    if (parts[0] === 'ventures') return { route: 'ventures' };
    if (parts[0] === 'invoices') return { route: 'invoices' };
    if (parts[0] === 'pos') return { route: 'pos' };
    if (parts[0] === 'payroll') return { route: 'payroll' };
    if (parts[0] === 'inventory') return { route: 'inventory' };
    if (parts[0] === 'venture' && parts[1]) {
        return { route: 'tracker', ventureId: parts[1], block: parts[2], floor: parts[3], view: parts[4] };
    }
    return { route: 'ventures' };
}

async function applyHashRoute() {
    const saved = loadAppState();
    let hash = window.location.hash;
    if (!hash && saved.hash) {
        hash = saved.hash;
        ignoreNextHashChange = true;
        window.location.hash = saved.hash;
    }
    const route = parseHash(hash);

    if (route.route === 'ventures') {
        exitToDashboard();
    } else if (route.route === 'tracker') {
        const venture = venturesList.find(v => v.id === route.ventureId);
        if (venture) {
            await openVenture(venture, {
                block: route.block,
                floor: route.floor ? parseInt(route.floor) : undefined,
                view: route.view
            });
        } else {
            exitToDashboard();
        }
    } else if (route.route === 'invoices') {
        openInvoicesPanel();
    } else if (route.route === 'pos') {
        openPOPanel();
    } else if (route.route === 'payroll') {
        openPayrollPanel();
    } else if (route.route === 'inventory') {
        openInventoryPanel();
    }
    restorePanelState(route.route);
}

window.addEventListener('hashchange', () => {
    if (ignoreNextHashChange) {
        ignoreNextHashChange = false;
        return;
    }
    applyHashRoute();
});
window.addEventListener('beforeunload', saveAppState);

function cacheKey(cellId) {
    return currentVenture ? `${currentVenture.id}_${cellId}` : cellId;
}

function createImageIndicator(count) {
    if (!count) return null;
    const badge = document.createElement('span');
    badge.className = 'remarks-image-indicator';
    badge.textContent = count > 9 ? '9+' : count;
    badge.title = `${count} photo${count > 1 ? 's' : ''}`;
    return badge;
}

function compressImage(file, maxWidth = 1920, maxHeight = 1920, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            resolve({
                name: file.name.replace(/\.[^.]+$/, '.jpg'),
                type: 'image/jpeg',
                dataUrl,
                size: Math.round(dataUrl.length * 0.75)
            });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
        };
        img.src = url;
    });
}

function slugId(text) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
}

function ensureItemIds(items) {
    if (!items || !items.length) return [];
    if (typeof items[0] === 'object' && items[0].id) return items;
    return items.map((label, i) => ({ id: `item_${slugId(label)}_${i}`, label }));
}

function ensureWorkCategories(cats) {
    if (!cats || Object.keys(cats).length === 0) return JSON.parse(JSON.stringify(WORK_CATEGORIES));
    const result = {}
    Object.entries(cats).forEach(([catLabel, items]) => {
        // Use existing items if they already have IDs; otherwise generate IDs
        if (items && items.length > 0 && typeof items[0] === 'object' && items[0].id) {
            result[catLabel] = items;
        } else {
            result[catLabel] = items.map((label, i) => ({ id: `item_${slugId(catLabel)}_${slugId(label)}_${i}`, label }));
        }
    });
    return result;
}

function getFlatWorkItems() {
    if (currentVenture && currentVenture.flat_view_items) {
        return ensureItemIds(currentVenture.flat_view_items);
    }
    return ensureItemIds(workItems);
}

function getSuperStructureItems() {
    if (currentVenture && currentVenture.super_structure_items && currentVenture.super_structure_items.length > 0) {
        return ensureItemIds(currentVenture.super_structure_items);
    }
    return ensureItemIds(SUPER_STRUCTURE_ITEMS);
}

function cellKeyById(block, floor, flat, itemId) {
    return `${block}_floor${floor}_${flat}_${itemId}`;
}

function ssCellKeyById(itemId) {
    return `superstructure_${itemId}`;
}

function workViewCellKeyById(block, floor, category, itemId, flat) {
    const catSlug = slugId(category);
    return `${block}_floor${floor}_${catSlug}_${itemId}_${flat}`;
}

// ========================
// DOM Elements
// ========================
const els = {
    userEmail: document.getElementById('userEmail'),
    signOutBtn: document.getElementById('signOutBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    gridBody: document.getElementById('gridBody'),
    statusPopup: document.getElementById('statusPopup'),
    popupTitle: document.getElementById('popupTitle'),
    popupCurrentStatus: document.getElementById('popupCurrentStatus'),
    clearStatusBtn: document.getElementById('clearStatusBtn'),
    cancelStatusBtn: document.getElementById('cancelStatusBtn'),
    timelineModal: document.getElementById('timelineModal'),
    timelineTitle: document.getElementById('timelineTitle'),
    timelineList: document.getElementById('timelineList'),
    remarksTextarea: document.getElementById('remarksTextarea'),
    saveRemarksBtn: document.getElementById('saveRemarksBtn'),
    closeTimeline: document.getElementById('closeTimeline'),
    remarksFileDrop: document.getElementById('remarksFileDrop'),
    remarksFileInput: document.getElementById('remarksFileInput'),
    remarksFileDropLabel: document.getElementById('remarksFileDropLabel'),
    remarksFilePreview: document.getElementById('remarksFilePreview'),
    settingsModal: document.getElementById('settingsModal'),
    workItemsList: document.getElementById('workItemsList'),
    addWorkItemBtn: document.getElementById('addWorkItemBtn'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    closeSettings: document.getElementById('closeSettings'),
    blocksSettingsList: document.getElementById('blocksSettingsList'),
    addBlockBtn: document.getElementById('addBlockBtn'),
};

// ========================
// Session & Auth
// ========================
function buildPermissions(role) {
    const p = {};
    if (role === 'supervisor') {
        p.viewDashboard = true;
        p.updateCellStatus = true;
        p.viewInventory = true;
        p.viewVendors = true;
        p.editVendors = false;
        p.viewInvoices = false;
        p.viewPOs = false;
        p.viewPayroll = false;
        p.editWorkItems = false;
        p.editVentures = false;
        p.manageUsers = false;
    } else if (role === 'manager' || role === 'admin') {
        p.viewDashboard = true;
        p.updateCellStatus = true;
        p.viewInventory = true;
        p.viewVendors = true;
        p.editVendors = true;
        p.viewInvoices = true;
        p.viewPOs = true;
        p.viewPayroll = true;
        p.editWorkItems = true;
        p.editVentures = true;
        p.manageUsers = role === 'admin';
    } else {
        // Unknown / fallback read-only
        p.viewDashboard = true;
    }
    return p;
}

async function checkSession() {
    try {
        const resp = await fetch('/api/me');
        const data = await resp.json();
        if (data.user) {
            currentUser = data.user;
            currentUserRole = data.role || 'supervisor';
            currentUserPermissions = buildPermissions(currentUserRole);
            if (els.userEmail) els.userEmail.textContent = currentUser;
            return true;
        }
    } catch (e) {}
    window.location.href = '/login';
    return false;
}

els.signOutBtn.addEventListener('click', async () => {
    await fetch('/logout', { method: 'POST' });
    window.location.href = '/login';
});

// ========================
// Persistence Helpers
// ========================

async function loadWorkItems() {
    if (currentVenture && currentVenture.flat_view_items) {
        workItems = [...currentVenture.flat_view_items];
        return;
    }
    workItems = [...DEFAULT_WORK_ITEMS];
}

async function saveWorkItems(items) {
    if (currentVenture) {
        currentVenture.flat_view_items = items;
        await saveVenture(currentVenture);
        showToast('Work items saved successfully');
        return;
    }
    showToast('Work items saved');
}

async function getCellData(cellId) {
    const ck = cacheKey(cellId);
    if (cellsCache[ck] !== undefined) return cellsCache[ck];
    // Preloaded at init; if missing, try API fallback
    try {
        const data = await apiGet('/api/cell/' + encodeURIComponent(ck));
        cellsCache[ck] = data;
        return data;
    } catch (err) {
        console.error('Failed to load cell', ck, err);
        return null;
    }
}

async function getSsCellData(cellId) {
    const ck = cacheKey(cellId);
    if (cellsCache[ck] !== undefined) return cellsCache[ck];
    try {
        const data = await apiGet('/api/cell/' + encodeURIComponent(ck));
        cellsCache[ck] = data;
        return data;
    } catch (err) {
        console.error('Failed to load ss cell', ck, err);
        return null;
    }
}

async function ensureCellsInCache(requiredKeys) {
    const missing = requiredKeys.filter(k => cellsCache[k] === undefined);
    if (missing.length === 0) return;
    try {
        const allCells = await apiGet('/api/cells');
        if (allCells) {
            Object.assign(cellsCache, allCells);
        }
    } catch (e) {
        console.error('Failed to bulk load cells:', e);
    }
}

async function updateCellColor(cellId, color, workItem, flat) {
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const statusLabel = color ? COLOR_LABELS[color] : 'Cleared';

    let autoRemark = '';
    if (color === 'blue') autoRemark = `Patch work started on ${today}`;
    else if (color === 'green') autoRemark = `Completed on ${today}`;
    else if (color === 'yellow') autoRemark = `Work started on ${today}`;

    const timelineEntry = {
        color: color || null,
        status_label: statusLabel,
        date: today,
        changed_by: currentUser
    };

    const ck = cacheKey(cellId);
    const existing = cellsCache[ck] || null;
    if (existing && existing.timeline && existing.timeline.length > 0) {
        const lastEntry = existing.timeline[existing.timeline.length - 1];
        if (lastEntry && lastEntry.color === color) {
            closeStatusPopup();
            return;
        }
    }
    let data;
    if (existing) {
        const timeline = [...(existing.timeline || []), timelineEntry];
        // Strip any previous auto-remarks, keep only user-typed remarks
        const autoRemarkPatterns = [
            /^Patch work started on .+$/m,
            /^Completed on .+$/m,
            /^Work started on .+$/m
        ];
        let remarks = existing.remarks || '';
        autoRemarkPatterns.forEach(p => { remarks = remarks.replace(p, '').trim(); });
        if (autoRemark) remarks = remarks ? remarks + '\n' + autoRemark : autoRemark;
        data = { ...existing, color: color || null, remarks, timeline,
            updated_at: new Date().toISOString(), updated_by: currentUser };
    } else {
        data = { color: color || null, remarks: autoRemark, timeline: [timelineEntry],
            updated_at: new Date().toISOString(), updated_by: currentUser };
    }

    // --- Optimistic instant update: cache + DOM, no full re-render ---
    cellsCache[ck] = data;
    const cellBtn = document.querySelector(`[data-cell-id="${ck}"]`);
    if (cellBtn) {
        cellBtn.className = 'cell-btn ' + (color || 'empty');
    }
    showToast('Status updated');

    // --- Background save with debounce (deduplicate rapid taps on same cell) ---
    if (pendingSaves.has(ck)) clearTimeout(pendingSaves.get(ck));
    const timer = setTimeout(async () => {
        pendingSaves.delete(ck);
        try {
            await apiPost('/api/cell/' + encodeURIComponent(ck), data);
        } catch (err) {
            console.error('Failed to save cell:', err);
            showToast('Save failed — please retry', true);
        }
    }, 300);
    pendingSaves.set(ck, timer);
}

async function saveCellRemarks(cellId, remarks, images) {
    const ck = cacheKey(cellId);
    const existing = cellsCache[ck] || {};
    const data = {
        ...existing,
        remarks: remarks,
        remarkImages: images || [],
        updated_at: new Date().toISOString(),
        updated_by: currentUser
    };
    try {
        await apiPost('/api/cell/' + encodeURIComponent(ck), data);
        cellsCache[ck] = data;
        if (currentView === 'flat') await renderGrid();
        else if (currentView === 'work') await renderWorkView();
        else if (currentView === 'super') await renderSuperStructure();
        showToast('Remarks saved');
    } catch (err) {
        console.error('Failed to save remarks:', err);
        showToast('Failed to save \u2014 please retry', true);
    }
}

// Venture persistence
async function saveVenture(venture) {
    await apiPost('/api/venture/' + encodeURIComponent(venture.id), venture);
}

async function saveVenturesToLS(force = false) {
    // Reserved for first-run seeding / full restore. Edits should use saveVenture().
    const qs = force ? '?force=true' : '';
    await apiPost('/api/ventures' + qs, venturesList);
}

async function loadVenturesFromLS() {
    try {
        const saved = await apiGet('/api/ventures');
        if (Array.isArray(saved) && saved.length > 0) {
            venturesList = saved;
        } else if (Array.isArray(saved)) {
            // Only seed on a confirmed empty list, never on a network error.
            venturesList = createDefaultVentures();
            await saveVenturesToLS();
        } else {
            throw new Error('Unexpected response from /api/ventures');
        }
    } catch (err) {
        console.error('Failed to load ventures:', err);
        showToast('Failed to load projects — retrying', true);
        // Do not seed defaults on a failed fetch; leave current state intact.
        throw err;
    }
}

function refreshCurrentVentureFromList() {
    // Re-derive the currently open project when a background poll updates the shared list.
    if (!currentVenture) return;
    const updated = venturesList.find(v => v.id === currentVenture.id);
    if (!updated) {
        showToast('This project was removed by another session', true);
        exitToDashboard();
        return;
    }
    if (JSON.stringify(updated) === JSON.stringify(currentVenture)) return;

    currentVenture = updated;
    archivedItems = currentVenture.archived || {};
    workItems = currentVenture.flat_view_items ? [...currentVenture.flat_view_items] : [...DEFAULT_WORK_ITEMS];

    if (currentBlockObj) {
        const freshBlock = currentVenture.blocks.find(b => b.id === currentBlockObj.id);
        if (freshBlock) {
            currentBlockObj = freshBlock;
            currentBlock = freshBlock.id;
            const maxFloor = freshBlock.floors || 5;
            if (currentFloor > maxFloor) currentFloor = maxFloor;
            if (currentFloor < 1) currentFloor = 1;
        } else {
            // The block we were on no longer exists; pick the first available block.
            currentBlockObj = currentVenture.blocks[0];
            if (!currentBlockObj) {
                showToast('This project no longer has any blocks', true);
                exitToDashboard();
                return;
            }
            currentBlock = currentBlockObj.id;
            currentFloor = 1;
        }
    }

    const tracker = document.getElementById('trackerView');
    if (tracker && tracker.style.display !== 'none') {
        if (currentView === 'flat') renderGrid();
        else if (currentView === 'work') renderWorkView();
        else if (currentView === 'super') renderSuperStructure();
        else if (currentView === 'pending') renderPendingView();
    }
}

// ========================
// Grid Rendering
// ========================
function getCellId(block, floor, flat, workIndex) {
    return `${block}_floor${floor}_${flat}_${workIndex}`;
}

function getWorkViewCellId(block, floor, category, workIndex, flat) {
    const slug = {
        'CIVIL WORK': 'civil',
        'ELECTRICAL & PLUMBING WORK': 'electrical_plumbing',
        'POP CEILING': 'pop_ceiling',
        'PAINTING': 'painting',
        'FLOORING': 'flooring',
        'CORRIDORS': 'corridors',
        'ELEVATION WORK': 'elevation'
    }[category] || category.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `${block}_floor${floor}_${slug}_${workIndex}_${flat}`;
}

async function renderGrid() {
    els.gridBody.innerHTML = '';
    const flatsPerFloor = currentBlockObj ? (currentBlockObj.flats_per_floor || FLATS_PER_FLOOR) : FLATS_PER_FLOOR;
    const flatNumbers = [];
    for (let i = 1; i <= flatsPerFloor; i++) {
        flatNumbers.push((currentFloor * 100) + i);
    }

    const items = getFlatWorkItems();
    const archived = archivedItems['flat_view'] || [];
    const activeItems = items.filter(it => !archived.includes(it.id));

    // Update flat view header
    const gridHeader = document.getElementById('gridHeader');
    gridHeader.innerHTML = '<th class="work-col">Work Item</th>';
    flatNumbers.forEach(flat => {
        const th = document.createElement('th');
        th.textContent = flat;
        gridHeader.appendChild(th);
    });
    const thRemarks = document.createElement('th');
    thRemarks.className = 'remarks-col';
    thRemarks.textContent = 'Remarks';
    gridHeader.appendChild(thRemarks);

    // Preload all cell data in one bulk request
    const requiredKeys = [];
    activeItems.forEach(item => {
        for (const flat of flatNumbers) {
            const cellId = cellKeyById(currentBlock, currentFloor, flat, item.id);
            requiredKeys.push(cacheKey(cellId));
        }
    });
    await ensureCellsInCache(requiredKeys);

    activeItems.forEach((item, wi) => {
        const row = document.createElement('tr');

        const workTd = document.createElement('td');
        workTd.className = 'work-cell';
        if (editMode) {
            workTd.innerHTML = `<span class="item-label">${item.label}</span>`;
            const controls = document.createElement('div');
            controls.className = 'edit-controls';
            controls.style.marginTop = '4px';
            controls.innerHTML = `<button class="edit-btn" title="Rename">&#9998;</button><button class="edit-btn" title="Delete">&#10006;</button>`;
            if (wi > 0) controls.innerHTML += `<button class="edit-btn" title="Move up">&#9650;</button>`;
            if (wi < activeItems.length - 1) controls.innerHTML += `<button class="edit-btn" title="Move down">&#9660;</button>`;
            workTd.appendChild(controls);

            const renameBtn = controls.querySelector('[title="Rename"]');
            const deleteBtn = controls.querySelector('[title="Delete"]');
            renameBtn.addEventListener('click', () => startInlineEdit(workTd, item.label, (newLabel) => renameFlatItem(item.id, newLabel)));
            deleteBtn.addEventListener('click', () => showConfirm('Delete Item', `Delete '${item.label}'? Existing tracking data will be hidden but not lost.`, () => archiveFlatItem(item.id)));

            const upBtn = controls.querySelector('[title="Move up"]');
            const downBtn = controls.querySelector('[title="Move down"]');
            if (upBtn) upBtn.addEventListener('click', () => reorderFlatItem(item.id, -1));
            if (downBtn) downBtn.addEventListener('click', () => reorderFlatItem(item.id, 1));
        } else {
            workTd.textContent = item.label;
        }
        row.appendChild(workTd);

        for (const flat of flatNumbers) {
            const cellId = cellKeyById(currentBlock, currentFloor, flat, item.id);
            const cellData = cellsCache[cacheKey(cellId)];
            const color = cellData?.color || null;

            const td = document.createElement('td');
            const wrapper = document.createElement('div');
            wrapper.className = 'cell-wrapper';

            const btn = document.createElement('button');
            btn.className = 'cell-btn ' + (color || 'empty');
            btn.title = `${flat} - ${item.label}`;
            btn.dataset.cellId = cacheKey(cellId);
            if (editMode) btn.disabled = true;

            const imgCount = (cellData?.remarkImages || []).length;
            const imgIndicator = createImageIndicator(imgCount);
            if (imgIndicator) btn.appendChild(imgIndicator);

            const history = document.createElement('button');
            history.className = 'history-link';
            history.textContent = 'history';

            wrapper.appendChild(btn);
            wrapper.appendChild(history);
            td.appendChild(wrapper);
            row.appendChild(td);

            if (!editMode) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (bulkMode) {
                        const ck = cacheKey(cellId);
                        if (bulkSelectedColor) {
                            updateCellColor(cellId, bulkSelectedColor, item.label, flat);
                        } else {
                            if (bulkSelected.has(ck)) {
                                bulkSelected.delete(ck);
                                btn.classList.remove('bulk-selected');
                            } else {
                                bulkSelected.add(ck);
                                btn.classList.add('bulk-selected');
                            }
                            document.getElementById('bulkCount').textContent =
                                `${bulkSelected.size} cell${bulkSelected.size !== 1 ? 's' : ''} selected`;
                        }
                    } else {
                        openStatusPopup(cellId, item.label, flat, color);
                    }
                });
            }

            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                openTimelineModal(cellId, item.label, flat);
            });

            history.addEventListener('click', () => {
                openTimelineModal(cellId, item.label, flat);
            });
        }

        const remarksTd = document.createElement('td');
        remarksTd.className = 'remarks-cell';
        const remarksParts = [];
        let totalImages = 0;
        for (const flat of flatNumbers) {
            const cellId = cellKeyById(currentBlock, currentFloor, flat, item.id);
            const cellData = cellsCache[cacheKey(cellId)];
            if (cellData?.remarks) {
                remarksParts.push(`${flat}: ${cellData.remarks}`);
            }
            totalImages += (cellData?.remarkImages || []).length;
        }
        if (totalImages > 0) {
            remarksParts.unshift(`\u{1F4F7} ${totalImages} photo${totalImages > 1 ? 's' : ''}`);
        }
        remarksTd.textContent = remarksParts.join(' | ');
        remarksTd.title = remarksTd.textContent;
        row.appendChild(remarksTd);

        els.gridBody.appendChild(row);
    });

    // Add item row in edit mode
    if (editMode) {
        const addRow = document.createElement('tr');
        const addTd = document.createElement('td');
        addTd.colSpan = flatNumbers.length + 2;
        addTd.innerHTML = '<div class="add-item-row"><input type="text" id="addFlatItemInput" placeholder="New work item name"><button class="btn-secondary" id="addFlatItemBtn">Add</button></div>';
        addRow.appendChild(addTd);
        els.gridBody.appendChild(addRow);
        document.getElementById('addFlatItemBtn').addEventListener('click', () => {
            const val = document.getElementById('addFlatItemInput').value.trim();
            if (val) addFlatItem(val);
        });
    }

    // Archived section in edit mode
    if (editMode && archived.length > 0) {
        const archRow = document.createElement('tr');
        const archTd = document.createElement('td');
        archTd.colSpan = flatNumbers.length + 2;
        archTd.innerHTML = '<div class="archived-section"><h4>Archived Items</h4></div>';
        const archList = archTd.querySelector('.archived-section');
        archived.forEach(archId => {
            const found = items.find(it => it.id === archId);
            if (found) {
                const div = document.createElement('div');
                div.className = 'archived-item';
                div.innerHTML = `<span>${found.label}</span><button class="btn-secondary" style="padding:4px 10px;font-size:0.75rem;">Restore</button>`;
                div.querySelector('button').addEventListener('click', () => restoreFlatItem(archId));
                archList.appendChild(div);
            }
        });
        archRow.appendChild(archTd);
        els.gridBody.appendChild(archRow);
    }
}

async function renderWorkView() {
    const container = document.getElementById('workViewContainer');
    container.innerHTML = '';

    const flatsPerFloor = currentBlockObj ? (currentBlockObj.flats_per_floor || FLATS_PER_FLOOR) : FLATS_PER_FLOOR;
    const flatNumbers = [];
    for (let i = 1; i <= flatsPerFloor; i++) {
        flatNumbers.push((currentFloor * 100) + i);
    }

    const workCategories = ensureWorkCategories((currentVenture && currentVenture.work_categories) ? currentVenture.work_categories : WORK_CATEGORIES);

    // Preload all cell data in one bulk request
    const requiredKeys = [];

    function queueKeys(category, items, flats) {
        items.forEach((itemObj) => {
            flats.forEach(flat => {
                const cellId = workViewCellKeyById(currentBlock, currentFloor, category, itemObj.id, flat);
                requiredKeys.push(cacheKey(cellId));
            });
        });
    }

    Object.entries(workCategories).forEach(([cat, items]) => {
        const catFlats = CATEGORY_FLATS[cat] || flatNumbers;
        queueKeys(cat, items, catFlats);
    });
    await ensureCellsInCache(requiredKeys);

    // Render all category sections
    Object.entries(workCategories).forEach(([category, items]) => {
        const catFlats = CATEGORY_FLATS[category] || flatNumbers;
        container.appendChild(createSectionTable(category, items, catFlats));
    });

    // Add category row in edit mode
    if (editMode) {
        const addCatDiv = document.createElement('div');
        addCatDiv.className = 'add-item-row';
        addCatDiv.style.margin = '12px 0';

        const catInput = document.createElement('input');
        catInput.type = 'text';
        catInput.id = 'addWorkCategoryInput';
        catInput.placeholder = 'New category name (e.g. Flooring, Corridors...)';

        const catBtn = document.createElement('button');
        catBtn.className = 'btn-secondary';
        catBtn.id = 'addWorkCategoryBtn';
        catBtn.textContent = 'Add Category';

        addCatDiv.appendChild(catInput);
        addCatDiv.appendChild(catBtn);
        container.appendChild(addCatDiv);

        const submitCategory = () => {
            const val = catInput.value.trim();
            if (val) addWorkCategory(val);
        };
        catBtn.addEventListener('click', submitCategory);
        catInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitCategory(); }
        });
    }
}

function createSectionTable(category, items, flats) {
    const section = document.createElement('div');
    section.className = 'work-view-section';

    const header = document.createElement('div');
    header.className = 'section-header';
    if (editMode) {
        header.innerHTML = `<span class="cat-label">${category}</span>`;
        const ctrl = document.createElement('span');
        ctrl.style.marginLeft = '12px';
        ctrl.innerHTML = '<button class="edit-btn" title="Rename category">&#9998;</button><button class="edit-btn" title="Delete category">&#10006;</button>';
        ctrl.querySelector('[title="Rename category"]').addEventListener('click', () => startInlineEdit(header, category, (newName) => renameWorkCategory(category, newName)));
        ctrl.querySelector('[title="Delete category"]').addEventListener('click', () => showConfirm('Delete Category', `Delete '${category}' and all its items?`, () => deleteWorkCategory(category)));
        header.appendChild(ctrl);
    } else {
        header.textContent = category;
    }
    section.appendChild(header);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    tableWrapper.style.padding = '0';

    const table = document.createElement('table');
    table.className = 'tracker-table';

    // Table header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    const thSNo = document.createElement('th');
    thSNo.textContent = 'S.No';
    thSNo.style.width = '50px';
    headerRow.appendChild(thSNo);

    const thWork = document.createElement('th');
    thWork.textContent = 'Work Description';
    thWork.className = 'work-col';
    headerRow.appendChild(thWork);

    flats.forEach(flat => {
        const th = document.createElement('th');
        th.textContent = flat;
        headerRow.appendChild(th);
    });

    const thRemarks = document.createElement('th');
    thRemarks.className = 'remarks-col';
    thRemarks.textContent = 'Remarks';
    headerRow.appendChild(thRemarks);

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Table body
    const tbody = document.createElement('tbody');

    items.forEach((itemObj, wi) => {
        const row = document.createElement('tr');

        const tdSNo = document.createElement('td');
        tdSNo.textContent = wi + 1;
        row.appendChild(tdSNo);

        const tdWork = document.createElement('td');
        tdWork.className = 'work-cell';
        if (editMode) {
            tdWork.innerHTML = `<span class="item-label">${itemObj.label}</span>`;
            const controls = document.createElement('div');
            controls.className = 'edit-controls';
            controls.style.marginTop = '4px';
            controls.innerHTML = `<button class="edit-btn" title="Rename">&#9998;</button><button class="edit-btn" title="Delete">&#10006;</button>`;
            if (wi > 0) controls.innerHTML += `<button class="edit-btn" title="Move up">&#9650;</button>`;
            if (wi < items.length - 1) controls.innerHTML += `<button class="edit-btn" title="Move down">&#9660;</button>`;
            tdWork.appendChild(controls);

            controls.querySelector('[title="Rename"]').addEventListener('click', () => startInlineEdit(tdWork, itemObj.label, (newLabel) => renameWorkItem(category, itemObj.id, newLabel)));
            controls.querySelector('[title="Delete"]').addEventListener('click', () => showConfirm('Delete Item', `Delete '${itemObj.label}' from ${category}?`, () => deleteWorkItem(category, itemObj.id)));
            const upBtn = controls.querySelector('[title="Move up"]');
            const downBtn = controls.querySelector('[title="Move down"]');
            if (upBtn) upBtn.addEventListener('click', () => reorderWorkItem(category, itemObj.id, -1));
            if (downBtn) downBtn.addEventListener('click', () => reorderWorkItem(category, itemObj.id, 1));
        } else {
            tdWork.textContent = itemObj.label;
        }
        row.appendChild(tdWork);

        flats.forEach(flat => {
            const cellId = workViewCellKeyById(currentBlock, currentFloor, category, itemObj.id, flat);
            const cellData = cellsCache[cacheKey(cellId)];
            const color = cellData?.color || null;

            const td = document.createElement('td');
            const wrapper = document.createElement('div');
            wrapper.className = 'cell-wrapper';

            const btn = document.createElement('button');
            btn.className = 'cell-btn ' + (color || 'empty');
            btn.title = `${flat} - ${itemObj.label}`;
            btn.dataset.cellId = cacheKey(cellId);
            if (editMode) btn.disabled = true;

            const imgCount = (cellData?.remarkImages || []).length;
            const imgIndicator = createImageIndicator(imgCount);
            if (imgIndicator) btn.appendChild(imgIndicator);

            const history = document.createElement('button');
            history.className = 'history-link';
            history.textContent = 'history';

            wrapper.appendChild(btn);
            wrapper.appendChild(history);
            td.appendChild(wrapper);
            row.appendChild(td);

            if (!editMode) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (bulkMode) {
                        const ck = cacheKey(cellId);
                        if (bulkSelectedColor) {
                            updateCellColor(cellId, bulkSelectedColor, itemObj.label, flat);
                        } else {
                            if (bulkSelected.has(ck)) {
                                bulkSelected.delete(ck);
                                btn.classList.remove('bulk-selected');
                            } else {
                                bulkSelected.add(ck);
                                btn.classList.add('bulk-selected');
                            }
                            document.getElementById('bulkCount').textContent =
                                `${bulkSelected.size} cell${bulkSelected.size !== 1 ? 's' : ''} selected`;
                        }
                    } else {
                        openStatusPopup(cellId, itemObj.label, flat, color);
                    }
                });
            }

            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                openTimelineModal(cellId, itemObj.label, flat);
            });

            history.addEventListener('click', () => {
                openTimelineModal(cellId, itemObj.label, flat);
            });
        });

        const remarksTd = document.createElement('td');
        remarksTd.className = 'remarks-cell';
        const remarksParts = [];
        let totalImages = 0;
        flats.forEach(flat => {
            const cellId = workViewCellKeyById(currentBlock, currentFloor, category, itemObj.id, flat);
            const cellData = cellsCache[cacheKey(cellId)];
            if (cellData?.remarks) {
                remarksParts.push(`${flat}: ${cellData.remarks}`);
            }
            totalImages += (cellData?.remarkImages || []).length;
        });
        if (totalImages > 0) {
            remarksParts.unshift(`\u{1F4F7} ${totalImages} photo${totalImages > 1 ? 's' : ''}`);
        }
        remarksTd.textContent = remarksParts.join(' | ');
        remarksTd.title = remarksTd.textContent;
        row.appendChild(remarksTd);

        tbody.appendChild(row);
    });

    // Add item row in edit mode
    if (editMode) {
        const addRow = document.createElement('tr');
        const addTd = document.createElement('td');
        addTd.colSpan = flats.length + 3;
        const inpId = `addWork_${slugId(category)}`;
        addTd.innerHTML = `<div class="add-item-row"><input type="text" id="${inpId}" placeholder="New item"><button class="btn-secondary add-work-item-btn" data-cat="${category}">Add</button></div>`;
        addRow.appendChild(addTd);
        tbody.appendChild(addRow);
        addTd.querySelector('.add-work-item-btn').addEventListener('click', () => {
            const val = document.getElementById(inpId).value.trim();
            if (val) addWorkItem(category, val);
        });
    }

    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    section.appendChild(tableWrapper);

    return section;
}

// ========================
// Status Picker Popup
// ========================
function openStatusPopup(cellId, workItem, flat, currentColor) {
    selectedCellId = cellId;
    selectedWorkItem = workItem;
    selectedFlat = flat;
    els.popupTitle.textContent = `${flat} - ${workItem}`;
    els.popupCurrentStatus.textContent = currentColor ? COLOR_LABELS[currentColor] : 'None';
    els.statusPopup.classList.add('show');
}

function closeStatusPopup() {
    els.statusPopup.classList.remove('show');
    selectedCellId = null;
    selectedWorkItem = null;
    selectedFlat = null;
}

document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!selectedCellId) return;
        const color = btn.dataset.color || null;
        if (selectedCellId.startsWith('superstructure_')) {
            const itemId = selectedCellId.replace('superstructure_', '');
            await updateSuperStructureStatus(itemId, color, selectedWorkItem);
        } else {
            await updateCellColor(selectedCellId, color, selectedWorkItem, selectedFlat);
        }
        closeStatusPopup();
    });
});

els.clearStatusBtn.addEventListener('click', async () => {
    if (!selectedCellId) return;
    if (selectedCellId.startsWith('superstructure_')) {
        const itemId = selectedCellId.replace('superstructure_', '');
        await updateSuperStructureStatus(itemId, null, selectedWorkItem);
    } else {
        await updateCellColor(selectedCellId, null, selectedWorkItem, selectedFlat);
    }
    closeStatusPopup();
});

els.cancelStatusBtn.addEventListener('click', closeStatusPopup);
els.statusPopup.addEventListener('click', (e) => {
    if (e.target === els.statusPopup) closeStatusPopup();
});

// ========================
// Bulk Select
// ========================
function exitBulkMode() {
    bulkMode = false;
    bulkSelectedColor = null;
    bulkSelected.clear();
    document.getElementById('bulkSelectBtn').classList.remove('active');
    document.getElementById('bulkActionBar').style.display = 'none';
    // Remove all bulk-selected highlights
    document.querySelectorAll('.cell-btn.bulk-selected').forEach(b => b.classList.remove('bulk-selected'));
    // Remove color button highlights
    document.querySelectorAll('.bulk-color-btn.selected').forEach(b => b.classList.remove('selected'));
}

document.getElementById('bulkSelectBtn').addEventListener('click', () => {
    bulkMode = !bulkMode;
    bulkSelected.clear();
    bulkSelectedColor = null;
    const btn = document.getElementById('bulkSelectBtn');
    const bar = document.getElementById('bulkActionBar');
    if (bulkMode) {
        btn.classList.add('active');
        bar.style.display = 'flex';
        document.getElementById('bulkCount').textContent = '0 cells selected';
        document.querySelectorAll('.bulk-color-btn.selected').forEach(b => b.classList.remove('selected'));
    } else {
        exitBulkMode();
    }
});

document.getElementById('bulkCancelBtn').addEventListener('click', exitBulkMode);

document.querySelectorAll('.bulk-color-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const color = btn.dataset.color || null;

        // If cells are already selected, apply color to them (existing flow)
        if (bulkSelected.size > 0) {
            const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const statusLabel = color ? COLOR_LABELS[color] : 'Cleared';
            let autoRemark = '';
            if (color === 'blue') autoRemark = `Patch work started on ${today}`;
            else if (color === 'green') autoRemark = `Completed on ${today}`;
            else if (color === 'yellow') autoRemark = `Work started on ${today}`;

            const autoRemarkPatterns = [/^Patch work started on .+$/m, /^Completed on .+$/m, /^Work started on .+$/m];
            const timelineEntry = { color: color || null, status_label: statusLabel, date: today, changed_by: currentUser };

            const batch = [];
            bulkSelected.forEach(ck => {
                const existing = cellsCache[ck] || null;
                let data;
                if (existing) {
                    const timeline = [...(existing.timeline || []), timelineEntry];
                    let remarks = existing.remarks || '';
                    autoRemarkPatterns.forEach(p => { remarks = remarks.replace(p, '').trim(); });
                    if (autoRemark) remarks = remarks ? remarks + '\n' + autoRemark : autoRemark;
                    data = { ...existing, color: color || null, remarks, timeline,
                        updated_at: new Date().toISOString(), updated_by: currentUser };
                } else {
                    data = { color: color || null, remarks: autoRemark, timeline: [timelineEntry],
                        updated_at: new Date().toISOString(), updated_by: currentUser };
                }
                cellsCache[ck] = data;
                // Update DOM instantly
                const cellBtn = document.querySelector(`[data-cell-id="${ck}"]`);
                if (cellBtn) cellBtn.className = 'cell-btn ' + (color || 'empty');
                batch.push({ id: ck, data });
            });

            const count = batch.length;
            exitBulkMode();
            showToast(`Updating ${count} cells…`);

            // Send in chunks of 50
            try {
                for (let i = 0; i < batch.length; i += 50) {
                    await apiPost('/api/cells/batch', { cells: batch.slice(i, i + 50) });
                }
                showToast(`${count} cells updated`);
            } catch (err) {
                console.error('Bulk save failed:', err);
                showToast('Bulk save failed — please retry', true);
            }
        } else {
            // Paint mode: set the active color so clicking cells applies it instantly
            bulkSelectedColor = color;
            // Highlight the selected color button
            document.querySelectorAll('.bulk-color-btn.selected').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            const colorName = color ? COLOR_LABELS[color] : 'No status color';
            document.getElementById('bulkCount').textContent = `Paint mode: ${colorName} — click cells to apply`;
        }
    });
});

// ========================
// Timeline Modal
// ========================
async function openTimelineModal(cellId, workItem, flat) {
    selectedCellId = cellId;
    selectedWorkItem = workItem;
    selectedFlat = flat;
    els.timelineTitle.textContent = `${flat} - ${workItem}`;
    els.timelineList.innerHTML = '';

    const cellData = await getCellData(cellId);
    const timeline = cellData?.timeline || [];

    if (timeline.length === 0) {
        els.timelineList.innerHTML = '<div class="no-timeline">No history yet</div>';
    } else {
        // Show newest first
        [...timeline].reverse().forEach(entry => {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            const dot = document.createElement('span');
            const statusColor = entry.color || entry.status || 'empty';
            dot.className = 'dot ' + statusColor;
            if (!statusColor || statusColor === 'empty') dot.style.background = '#ccc';
            const info = document.createElement('div');
            info.innerHTML = `<strong>${entry.status_label || 'Cleared'}</strong><br><span class="timeline-meta">${entry.date || ''} — changed by: ${entry.changed_by || 'Unknown'}</span>`;
            item.appendChild(dot);
            item.appendChild(info);
            els.timelineList.appendChild(item);
        });
    }

    els.remarksTextarea.value = cellData?.remarks || '';
    remarksImagesBuffer = (cellData?.remarkImages || []).map(a => ({ ...a }));
    renderRemarksImagePreview();
    els.timelineModal.classList.add('show');
}

function closeTimelineModal() {
    els.timelineModal.classList.remove('show');
    selectedCellId = null;
    selectedWorkItem = null;
    selectedFlat = null;
    remarksImagesBuffer = [];
    if (els.remarksFilePreview) els.remarksFilePreview.innerHTML = '';
    if (els.remarksFileDropLabel) els.remarksFileDropLabel.textContent = 'Click to upload photo or drag & drop (JPG/PNG, max 20MB, saved in low resolution)';
}

function renderRemarksImagePreview() {
    if (!els.remarksFilePreview) return;
    els.remarksFilePreview.innerHTML = '';
    remarksImagesBuffer.forEach((att, idx) => {
        const item = document.createElement('div');
        item.className = 'attach-preview-item';

        const img = document.createElement('img');
        img.src = att.dataUrl || att.url;
        img.className = 'attach-preview-thumb';
        img.alt = att.name;
        img.addEventListener('click', () => openLightbox(att));

        const removeBtn = document.createElement('button');
        removeBtn.className = 'attach-preview-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = 'Remove';
        removeBtn.addEventListener('click', () => {
            remarksImagesBuffer.splice(idx, 1);
            renderRemarksImagePreview();
        });

        item.appendChild(img);
        item.appendChild(removeBtn);
        els.remarksFilePreview.appendChild(item);
    });
    if (els.remarksFileDropLabel) {
        els.remarksFileDropLabel.textContent = remarksImagesBuffer.length > 0
            ? `${remarksImagesBuffer.length} photo(s) selected. Click to add more.`
            : 'Click to upload photo or drag & drop (JPG/PNG, max 20MB, saved in low resolution)';
    }
}

async function handleRemarksFiles(files) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    const maxSize = 20 * 1024 * 1024;
    const compressThreshold = 500 * 1024;
    const maxImages = 10;

    for (const file of files) {
        if (remarksImagesBuffer.length >= maxImages) {
            showToast(`Maximum ${maxImages} photos per cell`, true);
            return;
        }
        if (!allowed.includes(file.type)) {
            showToast(`${file.name}: Only JPG, PNG, or WEBP images allowed`, true);
            continue;
        }
        if (file.size > maxSize) {
            showToast(`${file.name}: File too large (max 20MB)`, true);
            continue;
        }
        try {
            let att;
            if (file.size > compressThreshold) {
                att = await compressImage(file, 1920, 1920, 0.8);
                showToast(`${file.name}: auto-compressed to ${(att.size / 1024).toFixed(0)} KB`);
            } else {
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = () => reject(new Error('Failed to read file'));
                    reader.readAsDataURL(file);
                });
                att = { name: file.name, type: file.type, dataUrl, size: file.size };
            }
            remarksImagesBuffer.push(att);
            renderRemarksImagePreview();
        } catch (err) {
            showToast(`${file.name}: ${err.message || 'Failed to process'}`, true);
        }
    }
}

els.closeTimeline.addEventListener('click', closeTimelineModal);
els.timelineModal.addEventListener('click', (e) => {
    if (e.target === els.timelineModal) closeTimelineModal();
});

els.saveRemarksBtn.addEventListener('click', async () => {
    if (!selectedCellId) return;
    await saveCellRemarks(selectedCellId, els.remarksTextarea.value, remarksImagesBuffer.map(a => ({ name: a.name, type: a.type, dataUrl: a.dataUrl })));
});

if (els.remarksFileDrop) {
    els.remarksFileDrop.addEventListener('click', () => els.remarksFileInput.click());
    els.remarksFileDrop.addEventListener('dragover', (e) => {
        e.preventDefault();
        els.remarksFileDrop.classList.add('drag-over');
    });
    els.remarksFileDrop.addEventListener('dragleave', () => {
        els.remarksFileDrop.classList.remove('drag-over');
    });
    els.remarksFileDrop.addEventListener('drop', (e) => {
        e.preventDefault();
        els.remarksFileDrop.classList.remove('drag-over');
        handleRemarksFiles(Array.from(e.dataTransfer.files));
    });
}

if (els.remarksFileInput) {
    els.remarksFileInput.addEventListener('change', () => {
        handleRemarksFiles(Array.from(els.remarksFileInput.files));
        els.remarksFileInput.value = '';
    });
}

// ========================
// Settings Modal
// ========================
function renderBlocksSettings() {
    if (!els.blocksSettingsList) return;
    els.blocksSettingsList.innerHTML = '';
    if (!currentVenture || !currentVenture.blocks) return;
    currentVenture.blocks.forEach((block, index) => {
        const row = document.createElement('div');
        row.className = 'block-setting-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'block-name-input';
        nameInput.value = block.name || block.id;
        nameInput.addEventListener('change', () => {
            block.name = nameInput.value.trim() || block.id;
        });

        const floorsInput = document.createElement('input');
        floorsInput.type = 'number';
        floorsInput.className = 'block-number-input';
        floorsInput.value = block.floors || 5;
        floorsInput.min = 1;
        floorsInput.title = 'Floors';
        floorsInput.addEventListener('change', () => {
            block.floors = parseInt(floorsInput.value) || 1;
        });

        const flatsInput = document.createElement('input');
        flatsInput.type = 'number';
        flatsInput.className = 'block-number-input';
        flatsInput.value = block.flats_per_floor || 6;
        flatsInput.min = 1;
        flatsInput.title = 'Flats per floor';
        flatsInput.addEventListener('change', () => {
            block.flats_per_floor = parseInt(flatsInput.value) || 1;
        });

        const remove = document.createElement('button');
        remove.className = 'remove-block-btn';
        remove.innerHTML = '&times;';
        remove.title = 'Remove block';
        remove.addEventListener('click', () => {
            if (currentVenture.blocks.length <= 1) {
                showToast('A venture must have at least one block', true);
                return;
            }
            currentVenture.blocks.splice(index, 1);
            renderBlocksSettings();
        });

        row.appendChild(nameInput);
        row.appendChild(floorsInput);
        row.appendChild(flatsInput);
        row.appendChild(remove);
        els.blocksSettingsList.appendChild(row);
    });
}

function openSettingsModal() {
    els.workItemsList.innerHTML = '';
    workItems.forEach((item, index) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.index = index;

        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '≡';

        const input = document.createElement('span');
        input.className = 'work-item-name';
        input.contentEditable = true;
        input.textContent = item;
        input.addEventListener('blur', () => {
            workItems[index] = input.textContent.trim() || item;
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
        });

        const remove = document.createElement('button');
        remove.className = 'remove-btn';
        remove.innerHTML = '&times;';
        remove.title = 'Remove';
        remove.addEventListener('click', () => {
            workItems.splice(index, 1);
            openSettingsModal(); // refresh
        });

        li.appendChild(handle);
        li.appendChild(input);
        li.appendChild(remove);
        els.workItemsList.appendChild(li);

        // Drag and drop
        li.addEventListener('dragstart', () => li.classList.add('dragging'));
        li.addEventListener('dragend', () => {
            li.classList.remove('dragging');
            // Rebuild workItems from DOM order
            const newItems = [];
            els.workItemsList.querySelectorAll('li').forEach((row, i) => {
                const nameSpan = row.querySelector('.work-item-name');
                newItems.push(nameSpan.textContent.trim());
            });
            workItems = newItems;
        });
        li.addEventListener('dragover', (e) => {
            e.preventDefault();
            const dragging = els.workItemsList.querySelector('.dragging');
            if (!dragging || dragging === li) return;
            const siblings = [...els.workItemsList.querySelectorAll('li:not(.dragging)')];
            const next = siblings.find(s => {
                const rect = s.getBoundingClientRect();
                return e.clientY <= rect.top + rect.height / 2;
            });
            els.workItemsList.insertBefore(dragging, next || null);
        });
    });
    renderBlocksSettings();
    els.settingsModal.classList.add('show');
}

function closeSettingsModal() {
    els.settingsModal.classList.remove('show');
}

els.settingsBtn.addEventListener('click', openSettingsModal);
els.closeSettings.addEventListener('click', closeSettingsModal);
els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) closeSettingsModal();
});

els.addWorkItemBtn.addEventListener('click', () => {
    workItems.push('New Work Item');
    openSettingsModal();
});

if (els.addBlockBtn) {
    els.addBlockBtn.addEventListener('click', () => {
        if (!currentVenture) return;
        const nextId = String.fromCharCode(65 + (currentVenture.blocks.length || 0));
        currentVenture.blocks.push({ id: nextId, name: `${nextId} Block`, floors: 5, flats_per_floor: 6 });
        renderBlocksSettings();
    });
}

els.saveSettingsBtn.addEventListener('click', async () => {
    // Sync work items from DOM
    const newItems = [];
    els.workItemsList.querySelectorAll('li').forEach(row => {
        const nameSpan = row.querySelector('.work-item-name');
        newItems.push(nameSpan.textContent.trim());
    });
    workItems = newItems.filter(w => w.length > 0);
    if (currentVenture) {
        currentVenture.flat_view_items = workItems;
    }
    await saveWorkItems(workItems);
    // Save venture blocks changes
    if (currentVenture) {
        await saveVentureConfig();
        // Refresh block tabs if visible
        renderBlockTabs();
    }
    closeSettingsModal();
    if (currentView === 'flat') {
        renderGrid();
    } else if (currentView === 'work') {
        renderWorkView();
    } else {
        renderSuperStructure();
    }
});

// ========================
// Dynamic Navigation
// ========================
function renderBlockTabs() {
    const container = document.getElementById('blockTabsContainer');
    container.innerHTML = '';
    if (!currentVenture || !currentVenture.blocks) return;

    const activeBlock = currentVenture.blocks.find(b => b.id === currentBlock) || currentVenture.blocks[0];
    currentBlock = activeBlock.id;
    currentBlockObj = activeBlock;

    currentVenture.blocks.forEach((block) => {
        const btn = document.createElement('button');
        const isActive = block.id === currentBlock;
        btn.className = 'block-tab' + (isActive ? ' active' : '');
        btn.dataset.block = block.id;
        btn.textContent = block.name || block.id + ' Block';
        btn.addEventListener('click', () => {
            document.querySelectorAll('.block-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentBlock = block.id;
            currentBlockObj = block;
            currentFloor = 1;
            renderFloorTabs();
            if (currentView === 'flat') {
                renderGrid();
            } else if (currentView === 'work') {
                renderWorkView();
            } else {
                renderSuperStructure();
            }
            navigateTo(buildTrackerRoute());
        });
        container.appendChild(btn);
    });
}

function renderFloorTabs() {
    const container = document.getElementById('floorTabsContainer');
    container.innerHTML = '';
    const floors = currentBlockObj ? (currentBlockObj.floors || 5) : 5;
    const floorLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

    const targetFloor = (currentFloor >= 1 && currentFloor <= floors) ? currentFloor : 1;
    currentFloor = targetFloor;

    for (let f = 1; f <= floors; f++) {
        const btn = document.createElement('button');
        const isActive = f === currentFloor;
        btn.className = 'floor-tab' + (isActive ? ' active' : '');
        btn.dataset.floor = f;
        const label = floors === 1 ? 'Ground Floor' : `${floorLabels[f - 1] || f + 'th'} Floor`;
        btn.textContent = label;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.floor-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFloor = f;
            if (currentView === 'flat') {
                renderGrid();
            } else if (currentView === 'work') {
                renderWorkView();
            } else {
                renderSuperStructure();
            }
            navigateTo(buildTrackerRoute());
        });
        container.appendChild(btn);
    }
}

// View toggle
document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentView = btn.dataset.view;
        document.getElementById('flatViewContainer').style.display = 'none';
        document.getElementById('workViewContainer').style.display = 'none';
        document.getElementById('superStructureContainer').style.display = 'none';
        document.getElementById('pendingViewContainer').style.display = 'none';
        const floorTabsContainer = document.getElementById('floorTabsContainer');
        const blockTabsContainer = document.getElementById('blockTabsContainer');
        if (currentView === 'super') {
            if (floorTabsContainer) floorTabsContainer.style.display = 'none';
            if (blockTabsContainer) blockTabsContainer.style.display = 'none';
        } else {
            if (floorTabsContainer) floorTabsContainer.style.display = '';
            if (blockTabsContainer) blockTabsContainer.style.display = '';
        }
        if (currentView === 'flat') {
            document.getElementById('flatViewContainer').style.display = '';
            renderGrid();
        } else if (currentView === 'work') {
            document.getElementById('workViewContainer').style.display = '';
            renderWorkView();
        } else {
            document.getElementById('superStructureContainer').style.display = '';
            renderSuperStructure();
        }
        navigateTo(buildTrackerRoute());
    });
});

// ========================
// Toast
// ========================
function showToast(message, isError = false) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' error' : '');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ========================
// Init
// ========================
async function init() {
    const ok = await checkSession();
    if (!ok) return;

    const defaultCategories = [
        'Brick', 'Sand', 'Steel', 'Cement', 'Tiles',
        'Electrical', 'Plumbing', 'Labour', 'Paint', 'Wood'
    ];

    // Load all initial data in parallel so the page opens faster.
    // A failed fetch must never be treated as "no data exists".
    try {
        await Promise.all([
            loadVentures().catch(err => {
                console.error('Ventures load failed on init:', err);
                // Keep current state intact; do not seed defaults on a failed fetch.
            }),
            preloadCells().catch(() => {}),
            apiGet('/api/invoices').then(d => allInvoices = d || []).catch(() => { allInvoices = []; }),
            apiGet('/api/settings/invoice_categories').then(d => allCategories = d || defaultCategories).catch(() => { allCategories = defaultCategories; }),
            apiGet('/api/pos').then(d => allPOs = d || []).catch(() => { allPOs = []; }),
            apiGet('/api/vendors').then(d => allVendors = d || []).catch(() => { allVendors = []; })
        ]);
    } catch (e) {}

    // loadVenturesFromLS already seeds defaults on a confirmed empty list.
    // Do not fall back to defaults here, because a failed fetch and an empty
    // database would be indistinguishable.

    await applyHashRoute();
    applyRoleBasedUI();
    startPolling();
}

function applyRoleBasedUI() {
    if (!currentUserPermissions) return;

    const hide = (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    };
    const show = (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
    };

    hide('settingsBtn');
    hide('editModeBtn');
    hide('openInvoicesBtn');
    hide('openPayrollBtn');
    hide('openPOBtn');
    hide('addInvoiceBtn');
    hide('invoiceAddCategoryBtn');
    hide('addPOBtn');
    hide('addVendorBtn');
    hide('addVendorCategoryBtn');
    hide('homePayrollBtn');

    if (currentUserPermissions.viewInvoices) show('openInvoicesBtn');
    if (currentUserPermissions.viewPayroll) show('openPayrollBtn');
    if (currentUserPermissions.viewPOs) show('openPOBtn');
    if (currentUserPermissions.viewPayroll) show('homePayrollBtn');
    if (currentUserPermissions.editWorkItems || currentUserPermissions.editVentures) {
        show('settingsBtn');
        show('editModeBtn');
    }
    if (currentUserPermissions.viewInvoices) show('addInvoiceBtn');
    if (currentUserPermissions.viewInvoices) show('invoiceAddCategoryBtn');
    if (currentUserPermissions.viewPOs) show('addPOBtn');
    if (currentUserPermissions.editVendors) {
        show('addVendorBtn');
        show('addVendorCategoryBtn');
    }
}

async function preloadCells() {
    const allCells = await apiGet('/api/cells');
    if (allCells) {
        cellsCache = allCells;
    }
}

let pollInterval = null;

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(pollData, 2000);
}

async function pollData() {
    // Skip polling while user is actively editing (any modal open)
    if (document.querySelector('.modal.show')) return;

    let changed = false;

    // Categories (synced live now; previously loaded once at init)
    try {
        const fresh = await apiGet('/api/settings/invoice_categories');
        if (fresh && JSON.stringify(fresh) !== JSON.stringify(allCategories)) {
            allCategories = fresh;
            changed = true;
            if (document.getElementById('invoicesPanel').style.display !== 'none') {
                renderInvoiceCards();
            }
        }
    } catch (e) {}

    // Ventures
    try {
        const fresh = await apiGet('/api/ventures');
        if (fresh && JSON.stringify(fresh) !== JSON.stringify(venturesList)) {
            venturesList = fresh;
            refreshCurrentVentureFromList();
            changed = true;
            if (document.getElementById('venturesDashboard').style.display !== 'none') {
                renderVentureDashboard();
            }
        }
    } catch (e) {}

    // Invoices
    try {
        const fresh = await apiGet('/api/invoices') || [];
        if (JSON.stringify(fresh) !== JSON.stringify(allInvoices)) {
            allInvoices = fresh;
            changed = true;
            if (document.getElementById('invoicesPanel').style.display !== 'none') {
                renderInvoiceCards();
            }
        }
    } catch (e) {}

    // POs
    try {
        const fresh = await apiGet('/api/pos') || [];
        if (JSON.stringify(fresh) !== JSON.stringify(allPOs)) {
            allPOs = fresh;
            changed = true;
            if (document.getElementById('poPanel').style.display !== 'none') {
                renderPOCards();
            }
        }
    } catch (e) {}

    // Vendors
    try {
        const fresh = await apiGet('/api/vendors') || [];
        if (JSON.stringify(fresh) !== JSON.stringify(allVendors)) {
            allVendors = fresh;
            changed = true;
            const dirModal = document.getElementById('vendorDirModal');
            if (dirModal && dirModal.classList.contains('show')) {
                renderVendorDirList();
            }
        }
    } catch (e) {}

    // Cells (merge into cache) — skip if saves still pending to avoid overwriting optimistic state
    if (pendingSaves.size > 0) return;
    try {
        const fresh = await apiGet('/api/cells');
        if (fresh) {
            let cellsChanged = false;
            for (const key in fresh) {
                if (JSON.stringify(cellsCache[key]) !== JSON.stringify(fresh[key])) {
                    cellsCache[key] = fresh[key];
                    cellsChanged = true;
                }
            }
            if (cellsChanged) {
                changed = true;
                const tracker = document.getElementById('trackerView');
                if (tracker && tracker.style.display !== 'none') {
                    if (currentView === 'flat') renderGrid();
                    else if (currentView === 'work') renderWorkView();
                    else if (currentView === 'super_structure') renderSuperStructure();
                    else if (currentView === 'pending') await renderPendingView();
                }
            }
        }
    } catch (e) {}
}

init();

// ========================
// Immediate sync triggers (visibility, focus, online)
// ========================
function triggerImmediateSync() {
    // Only sync cells when tracker is visible and no modal is open
    const tracker = document.getElementById('trackerView');
    if (tracker && tracker.style.display !== 'none' && !document.querySelector('.modal.show')) {
        pollData();
    }
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) triggerImmediateSync();
});

window.addEventListener('focus', triggerImmediateSync);
window.addEventListener('online', triggerImmediateSync);

// ========================
// Super Structure View
// ========================
function renderSuperStructure() {
    const container = document.getElementById('superStructureContainer');
    container.innerHTML = '';

    const ssItems = getSuperStructureItems();
    const archived = archivedItems['super_structure'] || [];
    const activeItems = ssItems.filter(it => !archived.includes(it.id));

    const ssWrapper = document.createElement('div');
    ssWrapper.className = 'ss-wrapper';

    const section = document.createElement('div');
    section.className = 'ss-section';
    section.style.flex = '1';
    section.style.maxWidth = '800px';
    section.style.margin = '0 auto';

    const header = document.createElement('div');
    header.className = 'section-header';
    header.textContent = 'SUPER STRUCTURE';
    section.appendChild(header);

    const subHeader = document.createElement('div');
    subHeader.className = 'ss-subheader';
    subHeader.textContent = 'PROGRESS';
    section.appendChild(subHeader);

    if (activeItems.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'ss-empty-state';
        emptyState.textContent = 'No super structure items found.';
        if (editMode) {
            const restoreBtn = document.createElement('button');
            restoreBtn.className = 'btn-secondary';
            restoreBtn.style.marginTop = '8px';
            restoreBtn.textContent = 'Restore Default Items';
            restoreBtn.addEventListener('click', restoreSuperStructureDefaults);
            emptyState.appendChild(document.createElement('br'));
            emptyState.appendChild(restoreBtn);
        }
        section.appendChild(emptyState);
        ssWrapper.appendChild(section);
        container.appendChild(ssWrapper);
        return;
    }

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    tableWrapper.style.padding = '0';

    const table = document.createElement('table');
    table.className = 'tracker-table ss-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    const thSNo = document.createElement('th');
    thSNo.textContent = 'S.No';
    thSNo.style.width = '40px';
    headerRow.appendChild(thSNo);

    const thWork = document.createElement('th');
    thWork.textContent = 'Work Description';
    thWork.className = 'work-col';
    headerRow.appendChild(thWork);

    const thStatus = document.createElement('th');
    thStatus.textContent = 'Status';
    thStatus.className = 'ss-status-col';
    headerRow.appendChild(thStatus);

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    activeItems.forEach((itemObj, wi) => {
        const row = document.createElement('tr');

        const tdSNo = document.createElement('td');
        tdSNo.textContent = wi + 1;
        row.appendChild(tdSNo);

        const tdWork = document.createElement('td');
        tdWork.className = 'work-cell';
        if (editMode) {
            tdWork.innerHTML = `<span class="item-label">${itemObj.label}</span>`;
            const controls = document.createElement('div');
            controls.className = 'edit-controls';
            controls.style.marginTop = '4px';
            controls.innerHTML = `<button class="edit-btn" title="Rename">&#9998;</button><button class="edit-btn" title="Delete">&#10006;</button>`;
            if (wi > 0) controls.innerHTML += `<button class="edit-btn" title="Move up">&#9650;</button>`;
            if (wi < activeItems.length - 1) controls.innerHTML += `<button class="edit-btn" title="Move down">&#9660;</button>`;
            tdWork.appendChild(controls);

            controls.querySelector('[title="Rename"]').addEventListener('click', () => startInlineEdit(tdWork, itemObj.label, (newLabel) => renameSuperItem(itemObj.id, newLabel)));
            controls.querySelector('[title="Delete"]').addEventListener('click', () => showConfirm('Delete Item', `Delete '${itemObj.label}'? Existing tracking data will be hidden but not lost.`, () => archiveSuperItem(itemObj.id)));
            const upBtn = controls.querySelector('[title="Move up"]');
            const downBtn = controls.querySelector('[title="Move down"]');
            if (upBtn) upBtn.addEventListener('click', () => reorderSuperItem(itemObj.id, -1));
            if (downBtn) downBtn.addEventListener('click', () => reorderSuperItem(itemObj.id, 1));
        } else {
            tdWork.textContent = itemObj.label;
        }
        row.appendChild(tdWork);

        const cellId = ssCellKeyById(itemObj.id);
        const cellData = cellsCache[cacheKey(cellId)];
        const activeStatus = cellData?.color || cellData?.status || null;

        const td = document.createElement('td');
        const wrapper = document.createElement('div');
        wrapper.className = 'cell-wrapper';

        const btn = document.createElement('button');
        btn.className = 'cell-btn ' + (activeStatus || 'empty');
        btn.title = `${itemObj.label} — ${activeStatus ? COLOR_LABELS[activeStatus] : 'No status'}`;
        if (editMode) btn.disabled = true;

        const imgCount = (cellData?.remarkImages || []).length;
        const imgIndicator = createImageIndicator(imgCount);
        if (imgIndicator) btn.appendChild(imgIndicator);

        const history = document.createElement('button');
        history.className = 'history-link';
        history.textContent = 'history';

        wrapper.appendChild(btn);
        wrapper.appendChild(history);
        td.appendChild(wrapper);
        row.appendChild(td);

        if (!editMode) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                openStatusPopup(cellId, itemObj.label, 'Super Structure', activeStatus);
            });
        }

        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            openTimelineModal(cellId, itemObj.label, 'Super Structure');
        });

        history.addEventListener('click', () => {
            openTimelineModal(cellId, itemObj.label, 'Super Structure');
        });

        tbody.appendChild(row);
    });

    // Add item row in edit mode
    if (editMode) {
        const addRow = document.createElement('tr');
        const addTd = document.createElement('td');
        addTd.colSpan = 3;
        addTd.innerHTML = '<div class="add-item-row"><input type="text" id="addSuperItemInput" placeholder="New super structure item"><button class="btn-secondary" id="addSuperItemBtn">Add</button></div>';
        addRow.appendChild(addTd);
        tbody.appendChild(addRow);
        addTd.querySelector('#addSuperItemBtn').addEventListener('click', () => {
            const val = addTd.querySelector('#addSuperItemInput').value.trim();
            if (val) addSuperItem(val);
        });
    }

    // Archived section in edit mode
    if (editMode && archived.length > 0) {
        const archRow = document.createElement('tr');
        const archTd = document.createElement('td');
        archTd.colSpan = 3;
        archTd.innerHTML = '<div class="archived-section"><h4>Archived Items</h4></div>';
        const archList = archTd.querySelector('.archived-section');
        archived.forEach(archId => {
            const found = ssItems.find(it => it.id === archId);
            if (found) {
                const div = document.createElement('div');
                div.className = 'archived-item';
                div.innerHTML = `<span>${found.label}</span><button class="btn-secondary" style="padding:4px 10px;font-size:0.75rem;">Restore</button>`;
                div.querySelector('button').addEventListener('click', () => restoreSuperItem(archId));
                archList.appendChild(div);
            }
        });
        archRow.appendChild(archTd);
        tbody.appendChild(archRow);
    }

    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    section.appendChild(tableWrapper);
    ssWrapper.appendChild(section);

    container.appendChild(ssWrapper);
}

async function updateSuperStructureStatus(itemId, status, workItem) {
    const cellId = ssCellKeyById(itemId);
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const ck = cacheKey(cellId);
    const existing = cellsCache[ck] || null;

    if (!status) {
        const timelineEntry = {
            color: null,
            status_label: 'Cleared',
            date: today,
            changed_by: currentUser
        };
        let data;
        if (existing) {
            data = {
                ...existing,
                color: null,
                timeline: [...(existing.timeline || []), timelineEntry],
                updated_at: new Date().toISOString(),
                updated_by: currentUser
            };
        } else {
            data = {
                color: null,
                timeline: [timelineEntry],
                updated_at: new Date().toISOString(),
                updated_by: currentUser
            };
        }
        await apiPost('/api/cell/' + encodeURIComponent(ck), data);
        cellsCache[ck] = data;
        renderSuperStructure();
        showToast('Status cleared');
        return;
    }

    const statusLabel = COLOR_LABELS[status];

    if (existing && existing.timeline && existing.timeline.length > 0) {
        const lastEntry = existing.timeline[existing.timeline.length - 1];
        if (lastEntry && lastEntry.color === status) return;
    }

    let autoRemark = '';
    if (status === 'blue') autoRemark = `Patch work started on ${today}`;
    else if (status === 'green') autoRemark = `Completed on ${today}`;
    else if (status === 'yellow') autoRemark = `Work started on ${today}`;

    const timelineEntry = {
        color: status,
        status_label: statusLabel,
        date: today,
        changed_by: currentUser
    };

    let data;
    if (existing) {
        const timeline = existing.timeline || [];
        timeline.push(timelineEntry);
        let remarks = existing.remarks || '';
        if (autoRemark) {
            remarks = remarks ? remarks + '\n' + autoRemark : autoRemark;
        }
        data = {
            ...existing,
            color: status,
            remarks: remarks,
            timeline: timeline,
            updated_at: new Date().toISOString(),
            updated_by: currentUser
        };
    } else {
        data = {
            color: status,
            remarks: autoRemark,
            timeline: [timelineEntry],
            updated_at: new Date().toISOString(),
            updated_by: currentUser
        };
    }
    await apiPost('/api/cell/' + encodeURIComponent(ck), data);
    cellsCache[ck] = data;
    renderSuperStructure();
    showToast('Status updated');
}

// ========================
// Venture Management
// ========================
async function loadVentures() {
    await loadVenturesFromLS();
}

function createDefaultVentures() {
    return [
        {
            id: 'elite',
            name: 'Elite',
            blocks: [
                { id: 'A', name: 'A Block', floors: 5, flats_per_floor: 6 },
                { id: 'B', name: 'B Block', floors: 5, flats_per_floor: 6 },
                { id: 'CH', name: 'Club House', floors: 1, flats_per_floor: 4 }
            ],
            flat_view_items: [...DEFAULT_WORK_ITEMS],
            work_categories: JSON.parse(JSON.stringify(WORK_CATEGORIES)),
            super_structure_items: [...SUPER_STRUCTURE_ITEMS],
            archived: {}
        },
        {
            id: 'tripura',
            name: 'Tripura',
            blocks: [
                { id: 'A', name: 'A Block', floors: 5, flats_per_floor: 6 },
                { id: 'B', name: 'B Block', floors: 5, flats_per_floor: 6 }
            ],
            flat_view_items: [...DEFAULT_WORK_ITEMS],
            work_categories: JSON.parse(JSON.stringify(WORK_CATEGORIES)),
            super_structure_items: [...SUPER_STRUCTURE_ITEMS],
            archived: {}
        }
    ];
}

async function seedDefaultVentures() {
    venturesList = createDefaultVentures();
    await saveVenturesToLS(true); // explicit full restore
}

function renderVentureDashboard() {
    document.getElementById('venturesDashboard').style.display = '';
    document.getElementById('trackerView').style.display = 'none';
    document.getElementById('breadcrumbBar').style.display = 'none';
    ['invoicesPanel', 'poPanel', 'payrollPanel', 'inventoryPanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const grid = document.getElementById('ventureCards');
    grid.innerHTML = '';

    venturesList.forEach(venture => {
        const card = document.createElement('div');
        card.className = 'venture-card';
        card.style.position = 'relative';

        const title = document.createElement('h3');
        title.textContent = venture.name;
        card.appendChild(title);

        const blocksList = document.createElement('div');
        blocksList.className = 'blocks-list';
        const blockNames = venture.blocks.map(b => b.name || b.id).join(', ');
        blocksList.textContent = blockNames;
        card.appendChild(blocksList);

        const cardEdit = document.createElement('div');
        cardEdit.className = 'edit-controls';
        cardEdit.style.position = 'absolute';
        cardEdit.style.top = '12px';
        cardEdit.style.right = '12px';
        cardEdit.innerHTML = '<button class="edit-btn" title="Rename">&#9998;</button><button class="edit-btn" title="Delete">&#10006;</button>';
        card.appendChild(cardEdit);

        cardEdit.querySelector('[title="Rename"]').addEventListener('click', (e) => {
            e.stopPropagation();
            startInlineEdit(card, venture.name, (newName) => renameVenture(venture.id, newName));
        });
        cardEdit.querySelector('[title="Delete"]').addEventListener('click', (e) => {
            e.stopPropagation();
            showConfirm('Delete Venture', `This will delete ALL data for ${venture.name}. Type venture name to confirm.`, () => deleteVenture(venture.id), venture.name);
        });

        card.addEventListener('click', async () => {
            await openVenture(venture);
            navigateTo(buildTrackerRoute());
        });
        grid.appendChild(card);
    });

    const addCard = document.createElement('div');
    addCard.className = 'venture-card add-venture-card';
    addCard.innerHTML = '<span class="plus-icon">+</span><span>Add Venture</span>';
    addCard.addEventListener('click', () => openWizard());
    grid.appendChild(addCard);

    // Refresh home quick-reports state to point at a current venture object
    if (homeQuickReportVenture) {
        const fresh = venturesList.find(v => v.id === homeQuickReportVenture.id);
        if (fresh) homeQuickReportVenture = fresh;
    }
    if (!homeQuickReportVenture && venturesList.length > 0) {
        homeQuickReportVenture = venturesList[0];
    }
    if (homeQuickReportVenture) {
        if (!homeQuickReportBlock || !homeQuickReportVenture.blocks.find(b => b.id === homeQuickReportBlock.id)) {
            homeQuickReportBlock = homeQuickReportVenture.blocks[0];
        }
    }
    renderHomeQuickReports();
}

function renderHomeQuickReports() {
    const ventureSelect = document.getElementById('homeReportVenture');
    const blockSelect = document.getElementById('homeReportBlock');
    const floorSelect = document.getElementById('homeReportFloor');
    const flatSelect = document.getElementById('homeReportFlat');
    if (!ventureSelect) return;

    ventureSelect.innerHTML = '<option value="">-- Select Venture --</option>';
    venturesList.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        ventureSelect.appendChild(opt);
    });

    if (homeQuickReportVenture) {
        ventureSelect.value = homeQuickReportVenture.id;
    }

    updateHomeQuickReportFilters();
    updateHomeQuickReportButtonStates();

    ventureSelect.onchange = () => {
        homeQuickReportVenture = venturesList.find(v => v.id === ventureSelect.value) || null;
        homeQuickReportBlock = homeQuickReportVenture ? homeQuickReportVenture.blocks[0] : null;
        homeQuickReportFloor = 1;
        homeQuickReportFlat = 'all';
        updateHomeQuickReportFilters();
    };

    blockSelect.onchange = () => {
        if (!homeQuickReportVenture) return;
        homeQuickReportBlock = homeQuickReportVenture.blocks.find(b => b.id === blockSelect.value) || homeQuickReportVenture.blocks[0];
        homeQuickReportFloor = 1;
        homeQuickReportFlat = 'all';
        updateHomeQuickReportFilters();
    };

    floorSelect.onchange = () => {
        homeQuickReportFloor = parseInt(floorSelect.value) || 1;
        homeQuickReportFlat = 'all';
        updateHomeQuickReportFilters();
    };

    flatSelect.onchange = () => {
        homeQuickReportFlat = flatSelect.value;
    };

    document.getElementById('homePendingWorkBtn').onclick = () => {
        homeQuickReportType = 'pending';
        updateHomeQuickReportButtonStates();
        runHomeQuickReport();
    };
    document.getElementById('homeReportsBtn').onclick = () => {
        homeQuickReportType = 'reports';
        updateHomeQuickReportButtonStates();
        runHomeQuickReport();
    };
    document.getElementById('homePayrollBtn').onclick = () => {
        if (!payrollPasswordVerified) {
            const entered = window.prompt('Enter payroll password (amount 1010):');
            if (entered !== PAYROLL_PASSWORD) {
                showToast('Incorrect payroll password', true);
                document.getElementById('homeReportsOutput').innerHTML = '';
                homeQuickReportType = 'reports';
                updateHomeQuickReportButtonStates();
                return;
            }
            payrollPasswordVerified = true;
        }
        homeQuickReportType = 'payroll';
        updateHomeQuickReportButtonStates();
        runHomeQuickReport();
    };
    document.getElementById('homeReportShowBtn').onclick = () => {
        if (!homeQuickReportVenture) {
            showToast('Please select a venture', true);
            return;
        }
        runHomeQuickReport();
    };
}

function updateHomeQuickReportFilters() {
    const blockSelect = document.getElementById('homeReportBlock');
    const floorSelect = document.getElementById('homeReportFloor');
    const flatSelect = document.getElementById('homeReportFlat');

    if (!homeQuickReportVenture) {
        blockSelect.innerHTML = '<option value="">-- Select Venture --</option>';
        blockSelect.disabled = true;
        floorSelect.innerHTML = '<option value="">-- Select Venture --</option>';
        floorSelect.disabled = true;
        flatSelect.innerHTML = '<option value="">-- Select Venture --</option>';
        flatSelect.disabled = true;
        return;
    }

    blockSelect.disabled = false;
    blockSelect.innerHTML = '';
    homeQuickReportVenture.blocks.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name || b.id;
        blockSelect.appendChild(opt);
    });
    if (homeQuickReportBlock) blockSelect.value = homeQuickReportBlock.id;

    const floors = homeQuickReportBlock ? (homeQuickReportBlock.floors || 5) : 5;
    const floorLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
    floorSelect.disabled = false;
    floorSelect.innerHTML = '';
    for (let f = 1; f <= floors; f++) {
        const label = floors === 1 ? 'Ground Floor' : `${floorLabels[f - 1] || f + 'th'} Floor`;
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = label;
        floorSelect.appendChild(opt);
    }
    floorSelect.value = String(homeQuickReportFloor);

    const flatsPerFloor = homeQuickReportBlock ? (homeQuickReportBlock.flats_per_floor || FLATS_PER_FLOOR) : FLATS_PER_FLOOR;
    flatSelect.disabled = false;
    flatSelect.innerHTML = '<option value="all">All Flats</option>';
    for (let i = 1; i <= flatsPerFloor; i++) {
        const flatNum = (homeQuickReportFloor * 100) + i;
        const opt = document.createElement('option');
        opt.value = flatNum;
        opt.textContent = flatNum;
        flatSelect.appendChild(opt);
    }
    flatSelect.value = String(homeQuickReportFlat);
}

function updateHomeQuickReportButtonStates() {
    document.querySelectorAll('.home-quick-buttons .btn-pending-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === homeQuickReportType);
    });
}

async function runHomeQuickReport() {
    if (!homeQuickReportVenture) {
        showToast('Please select a venture', true);
        return;
    }

    currentVenture = homeQuickReportVenture;
    currentBlockObj = homeQuickReportBlock;
    currentBlock = homeQuickReportBlock ? homeQuickReportBlock.id : 'A';
    currentFloor = homeQuickReportFloor;

    const output = document.getElementById('homeReportsOutput');
    output.innerHTML = '';

    if (homeQuickReportType === 'pending') {
        pendingFilterFloor = homeQuickReportFloor;
        pendingFilterFlat = homeQuickReportFlat;
        previousView = 'flat';
        await renderPendingView(output);
    } else if (homeQuickReportType === 'reports') {
        await renderHomeReports(output);
    } else if (homeQuickReportType === 'payroll') {
        await renderHomePayroll(output);
    }
}

async function renderHomeReports(container) {
    if (!currentVenture || !currentBlockObj) return;

    const floors = currentBlockObj.floors || 5;
    const flatsPerFloor = currentBlockObj.flats_per_floor || FLATS_PER_FLOOR;
    const workCategories = ensureWorkCategories((currentVenture && currentVenture.work_categories) ? currentVenture.work_categories : WORK_CATEGORIES);
    const flatWorkItems = getFlatWorkItems();

    let flatNumbers = [];
    if (homeQuickReportFlat === 'all') {
        for (let i = 1; i <= flatsPerFloor; i++) {
            flatNumbers.push((homeQuickReportFloor * 100) + i);
        }
    } else {
        flatNumbers = [parseInt(homeQuickReportFlat)];
    }

    const requiredKeys = [];
    flatNumbers.forEach(flat => {
        flatWorkItems.forEach(item => {
            requiredKeys.push(cacheKey(cellKeyById(currentBlock, homeQuickReportFloor, flat, item.id)));
        });
        Object.entries(workCategories).forEach(([category, items]) => {
            items.forEach(itemObj => {
                requiredKeys.push(cacheKey(workViewCellKeyById(currentBlock, homeQuickReportFloor, category, itemObj.id, flat)));
            });
        });
    });
    await ensureCellsInCache(requiredKeys);

    const statusCounts = { red: 0, yellow: 0, blue: 0, green: 0, none: 0 };
    let totalCells = 0;
    const workRows = [];

    flatNumbers.forEach(flat => {
        flatWorkItems.forEach(item => {
            const cellId = cellKeyById(currentBlock, homeQuickReportFloor, flat, item.id);
            const cellData = cellsCache[cacheKey(cellId)];
            const color = cellData?.color || null;
            if (color && statusCounts.hasOwnProperty(color)) statusCounts[color]++;
            else statusCounts.none++;
            totalCells++;
            workRows.push({
                flat: flat,
                workItem: item.label,
                category: 'Flat View',
                color: color || 'none',
                statusLabel: color ? COLOR_LABELS[color] : 'Not started'
            });
        });
        Object.entries(workCategories).forEach(([category, items]) => {
            items.forEach(itemObj => {
                const cellId = workViewCellKeyById(currentBlock, homeQuickReportFloor, category, itemObj.id, flat);
                const cellData = cellsCache[cacheKey(cellId)];
                const color = cellData?.color || null;
                if (color && statusCounts.hasOwnProperty(color)) statusCounts[color]++;
                else statusCounts.none++;
                totalCells++;
                workRows.push({
                    flat: flat,
                    workItem: itemObj.label,
                    category: category,
                    color: color || 'none',
                    statusLabel: color ? COLOR_LABELS[color] : 'Not started'
                });
            });
        });
    });

    const statusInfo = [
        { key: 'red', label: 'Yet to start', color: getColorHex('red') },
        { key: 'yellow', label: 'In progress', color: getColorHex('yellow') },
        { key: 'blue', label: 'Patch work', color: getColorHex('blue') },
        { key: 'green', label: 'Completed', color: getColorHex('green') },
        { key: 'none', label: 'Not started', color: '#ccc' }
    ];

    const chartWrapper = document.createElement('div');
    chartWrapper.className = 'reports-chart-wrapper';

    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'reports-canvas-container';
    const canvas = document.createElement('canvas');
    canvas.id = 'homeReportsPieChart';
    canvasContainer.appendChild(canvas);
    chartWrapper.appendChild(canvasContainer);

    const legendContainer = document.createElement('div');
    legendContainer.className = 'reports-legend';
    statusInfo.forEach(info => {
        const count = statusCounts[info.key];
        const pct = totalCells > 0 ? ((count / totalCells) * 100).toFixed(1) : '0.0';
        const item = document.createElement('div');
        item.className = 'reports-legend-item';
        item.innerHTML = `
            <span class="reports-legend-dot" style="background:${info.color};"></span>
            <span class="reports-legend-label">${info.label}</span>
            <span class="reports-legend-count">${count}</span>
            <span class="reports-legend-pct">${pct}%</span>
        `;
        legendContainer.appendChild(item);
    });
    chartWrapper.appendChild(legendContainer);
    container.appendChild(chartWrapper);

    const summary = document.createElement('div');
    summary.className = 'pending-summary';
    const flatText = homeQuickReportFlat === 'all' ? 'All Flats' : `Flat ${homeQuickReportFlat}`;
    summary.textContent = `Total cells: ${totalCells} | ${currentVenture.name} | ${currentBlockObj.name || currentBlock} | ${homeQuickReportFloor}${['st','nd','rd','th','th','th','th','th','th','th'][homeQuickReportFloor - 1] || 'th'} Floor | ${flatText}`;
    container.appendChild(summary);

    // Work details table
    const statusOrder = { green: 0, yellow: 1, blue: 2, red: 3, none: 4 };
    const sortedRows = [...workRows].sort((a, b) => {
        const diff = statusOrder[a.color] - statusOrder[b.color];
        if (diff !== 0) return diff;
        if (a.flat !== b.flat) return a.flat - b.flat;
        return a.workItem.localeCompare(b.workItem);
    });

    const detailsHeading = document.createElement('h4');
    detailsHeading.style.margin = '16px 0 8px';
    detailsHeading.style.color = '#1a2a6c';
    detailsHeading.textContent = 'Work Details';
    container.appendChild(detailsHeading);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    const table = document.createElement('table');
    table.className = 'tracker-table pending-table';
    table.innerHTML = '<thead><tr><th>Status</th><th>Work Item</th><th>Category</th><th>Flat</th></tr></thead>';
    const tbody = document.createElement('tbody');
    if (sortedRows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:24px;">No work items found</td></tr>';
    } else {
        sortedRows.forEach(row => {
            const tr = document.createElement('tr');
            const dotColor = row.color === 'none' ? '#ccc' : getColorHex(row.color);
            tr.innerHTML = `
                <td><span class="dot" style="background:${dotColor};"></span> ${row.statusLabel}</td>
                <td>${escapeHtml(row.workItem)}</td>
                <td>${escapeHtml(row.category)}</td>
                <td>${row.flat}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);

    if (window.homeReportsChart) window.homeReportsChart.destroy();
    const chartData = statusInfo.filter(info => statusCounts[info.key] > 0);
    window.homeReportsChart = new Chart(canvas, {
        type: 'pie',
        data: {
            labels: chartData.map(info => info.label),
            datasets: [{
                data: chartData.map(info => statusCounts[info.key]),
                backgroundColor: chartData.map(info => info.color),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const pct = totalCells > 0 ? ((value / totalCells) * 100).toFixed(1) : '0.0';
                            return `${label}: ${value} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

let homePayrollData = { employees: [], categories: [] };
let homePayrollMonth = new Date().toISOString().slice(0, 7);
let homePayrollEditingId = null;
let payrollPasswordVerified = false;
const PAYROLL_PASSWORD = '1010';

async function renderHomePayroll(container) {
    if (!currentVenture) return;

    const headerBar = document.createElement('div');
    headerBar.className = 'pending-filter-bar';
    headerBar.innerHTML = `
        <div class="pending-filter-group">
            <label>Month</label>
            <input type="month" id="homePayrollMonth" value="${homePayrollMonth}">
        </div>
        <div class="pending-filter-group" style="align-self:flex-end;">
            <button id="homePayrollAddEmpBtn" class="btn-primary" style="padding:8px 16px;">+ Add Employee</button>
        </div>
    `;
    container.appendChild(headerBar);

    homePayrollMonth = document.getElementById('homePayrollMonth').value;
    const key = `payroll_${currentVenture.id}_${homePayrollMonth}`;
    try {
        const saved = await apiGet('/api/settings/' + encodeURIComponent(key));
        if (saved && saved.employees) homePayrollData = saved;
        else homePayrollData = { employees: [], categories: [] };
    } catch (e) {
        homePayrollData = { employees: [], categories: [] };
    }

    const summaryBar = document.createElement('div');
    summaryBar.className = 'pending-summary';
    const totalBase = (homePayrollData.employees || []).reduce((s, e) => s + (parseFloat(e.base) || 0), 0);
    const totalAdvance = (homePayrollData.employees || []).reduce((s, e) => s + (parseFloat(e.advance) || 0), 0);
    const netPay = totalBase - totalAdvance;
    summaryBar.innerHTML = `
        <strong>${(homePayrollData.employees || []).length}</strong> employees |
        Total Base: <strong>&#8377;${totalBase.toLocaleString('en-IN', {maximumFractionDigits:2})}</strong> |
        Total Advance: <strong>&#8377;${totalAdvance.toLocaleString('en-IN', {maximumFractionDigits:2})}</strong> |
        Net Pay: <strong>&#8377;${netPay.toLocaleString('en-IN', {maximumFractionDigits:2})}</strong>
    `;
    container.appendChild(summaryBar);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    const table = document.createElement('table');
    table.className = 'tracker-table pending-table';
    table.innerHTML = '<thead><tr><th>S.No</th><th>Name</th><th>Category</th><th>Base (&#8377;)</th><th>Advance (&#8377;)</th><th>Net Pay (&#8377;)</th><th>Actions</th></tr></thead>';
    const tbody = document.createElement('tbody');

    if (!homePayrollData.employees || homePayrollData.employees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:24px;">No employees added yet. Click "+ Add Employee" to get started.</td></tr>';
    } else {
        homePayrollData.employees.forEach((emp, idx) => {
            const net = (parseFloat(emp.base) || 0) - (parseFloat(emp.advance) || 0);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${idx + 1}</td>
                <td>${escapeHtml(emp.name)}</td>
                <td>${escapeHtml(emp.category || '')}</td>
                <td>&#8377;${(parseFloat(emp.base) || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                <td>&#8377;${(parseFloat(emp.advance) || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                <td>&#8377;${net.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                <td style="text-align:center;">
                    <div class="payroll-actions">
                        <button class="btn-text home-payroll-edit" data-empid="${emp.id}" title="Edit">&#9998;</button>
                        <button class="btn-text home-payroll-del" data-empid="${emp.id}" style="color:#c0392b;" title="Delete">Delete</button>
                        <button class="btn-text home-payroll-history" data-empid="${emp.id}">history</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);

    container.querySelector('#homePayrollAddEmpBtn').addEventListener('click', () => {
        payrollModalContext = { type: 'home', data: homePayrollData, key: key, container: container };
        payrollEditingEmpId = null;
        openPayrollEmpModal(null);
    });

    container.querySelector('#homePayrollMonth').addEventListener('change', async () => {
        homePayrollMonth = container.querySelector('#homePayrollMonth').value;
        await renderHomePayroll(container);
    });

    container.querySelectorAll('.home-payroll-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const emp = homePayrollData.employees.find(e => e.id === btn.dataset.empid);
            if (emp) {
                payrollModalContext = { type: 'home', data: homePayrollData, key: key, container: container };
                payrollEditingEmpId = emp.id;
                openPayrollEmpModal(emp);
            }
        });
    });

    container.querySelectorAll('.home-payroll-history').forEach(btn => {
        btn.addEventListener('click', () => {
            const emp = homePayrollData.employees.find(e => e.id === btn.dataset.empid);
            if (emp) {
                const advHistory = emp.advanceHistory || [];
                openPayrollHistoryModal(emp, { isAdvanceHistory: true, history: advHistory, title: `Advance History - ${emp.name}` });
            }
        });
    });

    container.querySelectorAll('.home-payroll-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            const empId = btn.dataset.empid;
            homePayrollData.employees = homePayrollData.employees.filter(e => e.id !== empId);
            renderHomePayroll(container);
            showToast('Employee deleted');
            try {
                await apiPost('/api/settings/' + encodeURIComponent(key), homePayrollData);
            } catch (err) {
                showToast('Failed to save deletion', true);
            }
        });
    });
}

async function openVenture(venture, opts = {}) {
    currentVenture = venture;

    const requestedBlock = opts.block || (opts.blockId);
    currentBlockObj = requestedBlock
        ? (venture.blocks.find(b => b.id === requestedBlock) || venture.blocks[0])
        : venture.blocks[0];
    currentBlock = currentBlockObj.id;

    currentFloor = opts.floor ? parseInt(opts.floor) : 1;
    currentView = ['flat', 'work', 'super'].includes(opts.view) ? opts.view : 'flat';

    editMode = false;
    archivedItems = venture.archived || {};

    workItems = venture.flat_view_items ? [...venture.flat_view_items] : [...DEFAULT_WORK_ITEMS];

    document.getElementById('venturesDashboard').style.display = 'none';
    document.getElementById('invoicesPanel').style.display = 'none';
    document.getElementById('poPanel').style.display = 'none';
    document.getElementById('payrollPanel').style.display = 'none';
    document.getElementById('inventoryPanel').style.display = 'none';
    document.getElementById('trackerView').style.display = '';
    document.getElementById('breadcrumbBar').style.display = 'flex';
    document.getElementById('bcVenture').textContent = venture.name;
    document.getElementById('ventureTitle').textContent = venture.name.toUpperCase();

    const editBtn = document.getElementById('editModeBtn');
    editBtn.style.display = '';
    editBtn.textContent = 'Edit Structure';
    document.getElementById('editModeBanner').style.display = 'none';
    document.body.classList.remove('edit-mode-active');

    // Reset view tabs
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    const activeTab = document.querySelector(`.view-tab[data-view="${currentView}"]`);
    if (activeTab) activeTab.classList.add('active');

    document.getElementById('flatViewContainer').style.display = 'none';
    document.getElementById('workViewContainer').style.display = 'none';
    document.getElementById('superStructureContainer').style.display = 'none';
    document.getElementById('pendingViewContainer').style.display = 'none';
    const reportsViewContainer = document.getElementById('reportsViewContainer');
    if (reportsViewContainer) reportsViewContainer.style.display = 'none';
    const payrollViewContainer = document.getElementById('payrollViewContainer');
    if (payrollViewContainer) payrollViewContainer.style.display = 'none';
    const floorTabsContainer = document.getElementById('floorTabsContainer');
    const blockTabsContainer = document.getElementById('blockTabsContainer');
    if (currentView === 'super') {
        if (floorTabsContainer) floorTabsContainer.style.display = 'none';
        if (blockTabsContainer) blockTabsContainer.style.display = 'none';
    } else {
        if (floorTabsContainer) floorTabsContainer.style.display = '';
        if (blockTabsContainer) blockTabsContainer.style.display = '';
    }

    renderBlockTabs();
    renderFloorTabs();
    if (currentView === 'flat') {
        await renderGrid();
    } else if (currentView === 'work') {
        await renderWorkView();
    } else if (currentView === 'super') {
        await renderSuperStructure();
    }
}

function exitToDashboard() {
    currentVenture = null;
    currentBlockObj = null;
    currentBlock = 'A';
    currentFloor = 1;
    editMode = false;
    document.getElementById('editModeBtn').style.display = 'none';
    document.getElementById('editModeBanner').style.display = 'none';
    document.body.classList.remove('edit-mode-active');
    renderVentureDashboard();
    navigateTo('#/ventures');
}

document.getElementById('backToVentures').addEventListener('click', exitToDashboard);

document.getElementById('bcHome').addEventListener('click', exitToDashboard);

// ========================
// Setup Wizard
// ========================
let wizardStep = 1;
let wizardData = {};

function openWizard() {
    wizardStep = 1;
    wizardData = { blocks: [], workCategories: JSON.parse(JSON.stringify(WORK_CATEGORIES)), superItems: [...SUPER_STRUCTURE_ITEMS] };
    renderWizardStep();
    document.getElementById('wizardModal').classList.add('show');
}

function closeWizard() {
    document.getElementById('wizardModal').classList.remove('show');
}

document.getElementById('closeWizard').addEventListener('click', closeWizard);
document.getElementById('wizardModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('wizardModal')) closeWizard();
});

function renderWizardStep() {
    const title = document.getElementById('wizardTitle');
    const body = document.getElementById('wizardBody');
    const backBtn = document.getElementById('wizardBack');
    const nextBtn = document.getElementById('wizardNext');

    backBtn.style.display = wizardStep > 1 ? '' : 'none';
    nextBtn.textContent = wizardStep === 5 ? 'Create Venture' : 'Next';

    body.innerHTML = '';

    if (wizardStep === 1) {
        title.textContent = 'Add New Venture — Step 1: Venture Name';
        body.innerHTML = `
            <div class="wizard-field">
                <label>Venture Name</label>
                <input type="text" id="wizName" placeholder="e.g. Greenfield Heights" value="${wizardData.name || ''}">
            </div>
        `;
    } else if (wizardStep === 2) {
        title.textContent = 'Add New Venture — Step 2: Blocks';
        let blocksHtml = '<div id="wizBlocksList">';
        wizardData.blocks.forEach((b, i) => {
            blocksHtml += `
                <div class="wizard-block-row">
                    <div class="wizard-field"><label>Block Name</label><input type="text" class="wiz-block-name" value="${b.name}"></div>
                    <div class="wizard-field"><label>Floors</label><input type="number" class="wiz-block-floors" value="${b.floors}" min="1"></div>
                    <div class="wizard-field"><label>Flats/Floor</label><input type="number" class="wiz-block-flats" value="${b.flats_per_floor}" min="1"></div>
                    <button class="remove-block-btn" data-index="${i}">&times;</button>
                </div>
            `;
        });
        blocksHtml += '</div>';
        body.innerHTML = blocksHtml + '<button class="btn-secondary" id="wizAddBlock" style="margin-top:8px;">+ Add Block</button>';

        body.querySelectorAll('.remove-block-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                wizardData.blocks.splice(parseInt(btn.dataset.index), 1);
                renderWizardStep();
            });
        });
        document.getElementById('wizAddBlock').addEventListener('click', () => {
            wizardData.blocks.push({ name: 'New Block', floors: 5, flats_per_floor: 6 });
            renderWizardStep();
        });
    } else if (wizardStep === 3) {
        title.textContent = 'Add New Venture — Step 3: Work Items';
        let html = '<div style="max-height:400px;overflow-y:auto;">';
        Object.entries(wizardData.workCategories).forEach(([cat, items]) => {
            html += `<div class="wizard-items-section"><h4>${cat}</h4>`;
            items.forEach((item, i) => {
                html += `<div class="wizard-item-row">
                    <input type="text" value="${item}" data-cat="${cat}" data-index="${i}">
                    <button class="remove-item-btn" data-cat="${cat}" data-index="${i}">&times;</button>
                </div>`;
            });
            html += `<button class="btn-text" id="wizAddCat_${cat.replace(/[^a-z]/gi, '')}" style="margin-top:4px;">+ Add item</button>`;
            html += '</div>';
        });
        html += '</div>';
        body.innerHTML = html;

        body.querySelectorAll('input[data-cat]').forEach(input => {
            input.addEventListener('change', () => {
                const cat = input.dataset.cat;
                const idx = parseInt(input.dataset.index);
                wizardData.workCategories[cat][idx] = input.value;
            });
        });
        body.querySelectorAll('.remove-item-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cat = btn.dataset.cat;
                const idx = parseInt(btn.dataset.index);
                wizardData.workCategories[cat].splice(idx, 1);
                renderWizardStep();
            });
        });
        Object.keys(wizardData.workCategories).forEach(cat => {
            const btn = document.getElementById('wizAddCat_' + cat.replace(/[^a-z]/gi, ''));
            if (btn) {
                btn.addEventListener('click', () => {
                    wizardData.workCategories[cat].push('New Item');
                    renderWizardStep();
                });
            }
        });
    } else if (wizardStep === 4) {
        title.textContent = 'Add New Venture — Step 4: Super Structure';
        let html = '<div style="max-height:400px;overflow-y:auto;">';
        wizardData.superItems.forEach((item, i) => {
            html += `<div class="wizard-item-row">
                <input type="text" value="${item}" data-index="${i}">
                <button class="remove-item-btn" data-index="${i}">&times;</button>
            </div>`;
        });
        html += '<button class="btn-text" id="wizAddSuper" style="margin-top:4px;">+ Add item</button>';
        html += '</div>';
        body.innerHTML = html;

        body.querySelectorAll('input[data-index]').forEach(input => {
            input.addEventListener('change', () => {
                const idx = parseInt(input.dataset.index);
                wizardData.superItems[idx] = input.value;
            });
        });
        body.querySelectorAll('.remove-item-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index);
                wizardData.superItems.splice(idx, 1);
                renderWizardStep();
            });
        });
        document.getElementById('wizAddSuper').addEventListener('click', () => {
            wizardData.superItems.push('New Item');
            renderWizardStep();
        });
    } else if (wizardStep === 5) {
        title.textContent = 'Add New Venture — Step 5: Review';
        const catCounts = Object.entries(wizardData.workCategories).map(([k, v]) => `${k}: ${v.length} items`).join(', ');
        body.innerHTML = `
            <div class="wizard-summary-card">
                <h4>Venture Name</h4>
                <ul><li>${wizardData.name}</li></ul>
            </div>
            <div class="wizard-summary-card">
                <h4>Blocks</h4>
                <ul>${wizardData.blocks.map(b => `<li>${b.name} — ${b.floors} floors, ${b.flats_per_floor} flats/floor</li>`).join('')}</ul>
            </div>
            <div class="wizard-summary-card">
                <h4>Work Categories</h4>
                <ul><li>${catCounts}</li></ul>
            </div>
            <div class="wizard-summary-card">
                <h4>Super Structure</h4>
                <ul><li>${wizardData.superItems.length} items</li></ul>
            </div>
        `;
    }
}

document.getElementById('wizardBack').addEventListener('click', () => {
    if (wizardStep > 1) {
        wizardStep--;
        renderWizardStep();
    }
});

document.getElementById('wizardNext').addEventListener('click', async () => {
    if (wizardStep === 1) {
        const name = document.getElementById('wizName').value.trim();
        if (!name) {
            showToast('Please enter a venture name', true);
            return;
        }
        wizardData.name = name;
    } else if (wizardStep === 2) {
        const rows = document.querySelectorAll('.wiz-block-name');
        wizardData.blocks = [];
        rows.forEach((input, i) => {
            const name = input.value.trim();
            const floors = parseInt(document.querySelectorAll('.wiz-block-floors')[i].value) || 1;
            const flats = parseInt(document.querySelectorAll('.wiz-block-flats')[i].value) || 1;
            if (name) {
                wizardData.blocks.push({ id: name.charAt(0).toUpperCase(), name, floors, flats_per_floor: flats });
            }
        });
        if (wizardData.blocks.length === 0) {
            showToast('Please add at least one block', true);
            return;
        }
    }

    if (wizardStep < 5) {
        wizardStep++;
        renderWizardStep();
    } else {
        await createVentureFromWizard();
    }
});

async function createVentureFromWizard() {
    const newVenture = {
        id: generateId(),
        name: wizardData.name,
        created_by: currentUser,
        created_at: new Date().toISOString(),
        blocks: wizardData.blocks,
        flat_view_items: [...DEFAULT_WORK_ITEMS],
        work_categories: wizardData.workCategories,
        super_structure_items: wizardData.superItems,
        archived: {}
    };
    venturesList.push(newVenture);
    await saveVenture(newVenture);
    showToast('Venture created successfully');
    closeWizard();
    await loadVentures();
    renderVentureDashboard();
}

// ========================
// Edit Mode & Inline Editing
// ========================
document.getElementById('editModeBtn').addEventListener('click', () => {
    editMode = !editMode;
    const btn = document.getElementById('editModeBtn');
    const banner = document.getElementById('editModeBanner');
    if (editMode) {
        btn.textContent = 'Done Editing';
        banner.style.display = '';
        document.body.classList.add('edit-mode-active');
    } else {
        btn.textContent = 'Edit Structure';
        banner.style.display = 'none';
        document.body.classList.remove('edit-mode-active');
    }
    if (currentView === 'flat') renderGrid();
    else if (currentView === 'work') renderWorkView();
    else renderSuperStructure();
});

let confirmCallback = null;
function showConfirm(title, message, onConfirm, requireType) {
    confirmCallback = onConfirm;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const input = document.getElementById('confirmInput');
    if (requireType) {
        input.style.display = '';
        input.value = '';
        input.placeholder = `Type "${requireType}" to confirm`;
    } else {
        input.style.display = 'none';
    }
    document.getElementById('confirmOverlay').classList.add('show');
}

document.getElementById('confirmCancel').addEventListener('click', () => {
    document.getElementById('confirmOverlay').classList.remove('show');
    confirmCallback = null;
});

document.getElementById('confirmAction').addEventListener('click', () => {
    const input = document.getElementById('confirmInput');
    const required = input.placeholder.replace(/Type "(.+)" to confirm/, '$1');
    if (input.style.display !== 'none' && input.value.trim() !== required) {
        showToast('Confirmation text does not match', true);
        return;
    }
    if (confirmCallback) confirmCallback();
    document.getElementById('confirmOverlay').classList.remove('show');
    confirmCallback = null;
});

function startInlineEdit(container, currentValue, onSave) {
    const labelSpan = container.querySelector('.item-label, .cat-label');
    const controls = container.querySelector('.edit-controls');
    if (labelSpan) labelSpan.style.display = 'none';
    if (controls) controls.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'item-edit-input';
    input.value = currentValue;
    input.style.width = '140px';
    container.appendChild(input);
    input.focus();

    const actionRow = document.createElement('div');
    actionRow.style.display = 'flex';
    actionRow.style.gap = '4px';
    actionRow.style.marginTop = '4px';
    actionRow.innerHTML = '<button class="btn-secondary" style="padding:4px 10px;font-size:0.8rem;">Save</button><button class="btn-text" style="padding:4px 10px;font-size:0.8rem;">Cancel</button>';
    container.appendChild(actionRow);

    actionRow.querySelector('.btn-secondary').addEventListener('click', () => {
        const newVal = input.value.trim();
        if (newVal && newVal !== currentValue) onSave(newVal);
        cleanup();
    });

    actionRow.querySelector('.btn-text').addEventListener('click', cleanup);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const newVal = input.value.trim();
            if (newVal && newVal !== currentValue) onSave(newVal);
            cleanup();
        } else if (e.key === 'Escape') {
            cleanup();
        }
    });

    function cleanup() {
        input.remove();
        actionRow.remove();
        if (labelSpan) labelSpan.style.display = '';
        if (controls) controls.style.display = '';
    }
}

async function saveVentureConfig() {
    if (!currentVenture) return;
    const idx = venturesList.findIndex(v => v.id === currentVenture.id);
    if (idx >= 0) {
        venturesList[idx] = currentVenture;
    }
    await saveVenture(currentVenture);
    showToast('Changes saved');
}

async function logEdit(action, section, itemId, oldVal, newVal) {
    if (!currentVenture) return;
    const logEntry = {
        action, section, item_id: itemId,
        old_value: oldVal, new_value: newVal,
        changed_by: currentUser,
        changed_at: new Date().toISOString()
    };
    const key = 'editlog_' + currentVenture.id;
    let existing = { entries: [] };
    try {
        existing = (await apiGet('/api/settings/' + encodeURIComponent(key))) || { entries: [] };
    } catch (err) {
        console.error('Failed to load edit log for', key, err);
    }
    existing.entries.push(logEntry);
    await apiPost('/api/settings/' + encodeURIComponent(key), existing);
}

// Flat View Editing
async function renameFlatItem(itemId, newLabel) {
    const items = ensureItemIds(currentVenture.flat_view_items || workItems);
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const old = item.label;
    item.label = newLabel;
    currentVenture.flat_view_items = items;
    await logEdit('rename', 'flat_view', itemId, old, newLabel);
    await saveVentureConfig();
    renderGrid();
}

async function addFlatItem(label) {
    const items = ensureItemIds(currentVenture.flat_view_items || workItems);
    const newId = `item_${slugId(label)}_${Date.now()}`;
    items.push({ id: newId, label });
    currentVenture.flat_view_items = items;
    await logEdit('add', 'flat_view', newId, null, label);
    await saveVentureConfig();
    renderGrid();
}

async function archiveFlatItem(itemId) {
    if (!archivedItems['flat_view']) archivedItems['flat_view'] = [];
    archivedItems['flat_view'].push(itemId);
    currentVenture.archived = archivedItems;
    await logEdit('delete', 'flat_view', itemId, null, null);
    await saveVentureConfig();
    renderGrid();
}

async function restoreFlatItem(itemId) {
    archivedItems['flat_view'] = (archivedItems['flat_view'] || []).filter(id => id !== itemId);
    currentVenture.archived = archivedItems;
    await logEdit('restore', 'flat_view', itemId, null, null);
    await saveVentureConfig();
    renderGrid();
}

async function reorderFlatItem(itemId, direction) {
    const items = ensureItemIds(currentVenture.flat_view_items || workItems);
    const idx = items.findIndex(i => i.id === itemId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= items.length) return;
    [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
    currentVenture.flat_view_items = items;
    await logEdit('reorder', 'flat_view', itemId, idx, newIdx);
    await saveVentureConfig();
    renderGrid();
}

// Work View Editing
async function renameWorkCategory(oldName, newName) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    if (cats[newName]) {
        showToast('Category name already exists', true);
        return;
    }
    cats[newName] = cats[oldName];
    delete cats[oldName];
    currentVenture.work_categories = cats;
    await logEdit('rename', 'work_category', oldName, oldName, newName);
    await saveVentureConfig();
    renderWorkView();
}

async function renameWorkItem(category, itemId, newLabel) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    const item = cats[category].find(i => i.id === itemId);
    if (!item) return;
    const old = item.label;
    item.label = newLabel;
    currentVenture.work_categories = cats;
    await logEdit('rename', 'work_item', itemId, old, newLabel);
    await saveVentureConfig();
    renderWorkView();
}

async function addWorkItem(category, label) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    const newId = `item_${slugId(category)}_${slugId(label)}_${Date.now()}`;
    cats[category].push({ id: newId, label });
    currentVenture.work_categories = cats;
    await logEdit('add', 'work_item', newId, null, label);
    await saveVentureConfig();
    renderWorkView();
}

async function addWorkCategory(categoryName) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    if (cats[categoryName]) {
        showToast('Category name already exists', true);
        return;
    }
    cats[categoryName] = [];
    currentVenture.work_categories = cats;
    await logEdit('add', 'work_category', categoryName, null, categoryName);
    await saveVentureConfig();
    renderWorkView();
}

async function deleteWorkCategory(categoryName) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    delete cats[categoryName];
    currentVenture.work_categories = cats;
    await logEdit('delete', 'work_category', categoryName, null, null);
    await saveVentureConfig();
    renderWorkView();
}

async function deleteWorkItem(category, itemId) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    cats[category] = cats[category].filter(i => i.id !== itemId);
    currentVenture.work_categories = cats;
    await logEdit('delete', 'work_item', itemId, null, null);
    await saveVentureConfig();
    renderWorkView();
}

async function reorderWorkItem(category, itemId, direction) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    const items = cats[category];
    const idx = items.findIndex(i => i.id === itemId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= items.length) return;
    [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
    currentVenture.work_categories = cats;
    await logEdit('reorder', 'work_item', itemId, idx, newIdx);
    await saveVentureConfig();
    renderWorkView();
}

// Super Structure Editing
async function renameSuperItem(itemId, newLabel) {
    const items = ensureItemIds(currentVenture.super_structure_items || SUPER_STRUCTURE_ITEMS);
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const old = item.label;
    item.label = newLabel;
    currentVenture.super_structure_items = items;
    await logEdit('rename', 'super_structure', itemId, old, newLabel);
    await saveVentureConfig();
    renderSuperStructure();
}

async function addSuperItem(label) {
    const items = ensureItemIds(currentVenture.super_structure_items || SUPER_STRUCTURE_ITEMS);
    const newId = `ss_item_${slugId(label)}_${Date.now()}`;
    items.push({ id: newId, label });
    currentVenture.super_structure_items = items;
    await logEdit('add', 'super_structure', newId, null, label);
    await saveVentureConfig();
    renderSuperStructure();
}

async function archiveSuperItem(itemId) {
    if (!archivedItems['super_structure']) archivedItems['super_structure'] = [];
    archivedItems['super_structure'].push(itemId);
    currentVenture.archived = archivedItems;
    await logEdit('delete', 'super_structure', itemId, null, null);
    await saveVentureConfig();
    renderSuperStructure();
}

async function restoreSuperItem(itemId) {
    archivedItems['super_structure'] = (archivedItems['super_structure'] || []).filter(id => id !== itemId);
    currentVenture.archived = archivedItems;
    await logEdit('restore', 'super_structure', itemId, null, null);
    await saveVentureConfig();
    renderSuperStructure();
}

async function reorderSuperItem(itemId, direction) {
    const items = ensureItemIds(currentVenture.super_structure_items || SUPER_STRUCTURE_ITEMS);
    const idx = items.findIndex(i => i.id === itemId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= items.length) return;
    [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
    currentVenture.super_structure_items = items;
    await logEdit('reorder', 'super_structure', itemId, idx, newIdx);
    await saveVentureConfig();
    renderSuperStructure();
}

async function restoreSuperStructureDefaults() {
    if (!currentVenture) return;
    currentVenture.super_structure_items = [...SUPER_STRUCTURE_ITEMS];
    archivedItems['super_structure'] = [];
    currentVenture.archived = archivedItems;
    await logEdit('restore_defaults', 'super_structure', null, null, null);
    await saveVentureConfig();
    renderSuperStructure();
    showToast('Super structure defaults restored');
}

// Venture Dashboard Editing
async function renameVenture(ventureId, newName) {
    const venture = venturesList.find(v => v.id === ventureId);
    if (!venture) return;
    venture.name = newName;
    await saveVenture(venture);
    showToast('Venture renamed');
    renderVentureDashboard();
}

async function deleteVenture(ventureId) {
    const venture = venturesList.find(v => v.id === ventureId);
    if (!venture) return;
    await apiDelete('/api/venture/' + encodeURIComponent(ventureId));
    venturesList = venturesList.filter(v => v.id !== ventureId);
    showToast('Venture deleted');
    renderVentureDashboard();
}

// ========================
// Pending Work View
// ========================
async function renderPendingView(targetContainer) {
    const container = targetContainer || document.getElementById('pendingViewContainer');
    container.innerHTML = '';

    if (!currentVenture || !currentBlockObj) return;

    const floors = currentBlockObj.floors || 5;
    const flatsPerFloor = currentBlockObj.flats_per_floor || FLATS_PER_FLOOR;
    const floorLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

    // Filter bar
    const filterBar = document.createElement('div');
    filterBar.className = 'pending-filter-bar';

    // Venture label (read-only)
    const ventureGroup = document.createElement('div');
    ventureGroup.className = 'pending-filter-group';
    ventureGroup.innerHTML = `<label>Venture</label><div class="pending-readonly">${currentVenture.name}</div>`;
    filterBar.appendChild(ventureGroup);

    // Floor dropdown
    const floorGroup = document.createElement('div');
    floorGroup.className = 'pending-filter-group';
    let floorOptions = '<option value="all">All Floors</option>';
    for (let f = 1; f <= floors; f++) {
        const label = floors === 1 ? 'Ground Floor' : `${floorLabels[f - 1] || f + 'th'} Floor`;
        floorOptions += `<option value="${f}" ${pendingFilterFloor == f ? 'selected' : ''}>${label}</option>`;
    }
    floorGroup.innerHTML = `<label>Floor</label><select id="pendingFloorSelect">${floorOptions}</select>`;
    filterBar.appendChild(floorGroup);

    // Flat dropdown
    const flatGroup = document.createElement('div');
    flatGroup.className = 'pending-filter-group';
    let flatOptions = '<option value="all">All Flats</option>';
    if (pendingFilterFloor !== 'all') {
        const floorNum = parseInt(pendingFilterFloor);
        for (let i = 1; i <= flatsPerFloor; i++) {
            const flatNum = (floorNum * 100) + i;
            flatOptions += `<option value="${flatNum}" ${pendingFilterFlat == flatNum ? 'selected' : ''}>${flatNum}</option>`;
        }
    }
    flatGroup.innerHTML = `<label>Flat</label><select id="pendingFlatSelect" ${pendingFilterFloor === 'all' ? 'disabled' : ''}>${flatOptions}</select>`;
    filterBar.appendChild(flatGroup);

    container.appendChild(filterBar);

    // Event listeners for filters
    // Export PDF button
    const exportBtnGroup = document.createElement('div');
    exportBtnGroup.className = 'pending-filter-group';
    exportBtnGroup.style.alignSelf = 'flex-end';
    exportBtnGroup.innerHTML = `<button id="exportPendingPDF" class="btn-secondary" style="padding:8px 16px;">📄 Export PDF</button>`;
    filterBar.appendChild(exportBtnGroup);

    filterBar.querySelector('#exportPendingPDF').addEventListener('click', exportPendingWorkPDF);

    filterBar.querySelector('#pendingFloorSelect').addEventListener('change', (e) => {
        pendingFilterFloor = e.target.value;
        if (pendingFilterFloor === 'all') pendingFilterFlat = 'all';
        renderPendingView();
    });
    const flatSelect = filterBar.querySelector('#pendingFlatSelect');
    if (flatSelect) {
        flatSelect.addEventListener('change', (e) => {
            pendingFilterFlat = e.target.value;
            renderPendingView();
        });
    }

    // Determine floors and flats to iterate
    const floorsToCheck = pendingFilterFloor === 'all'
        ? Array.from({ length: floors }, (_, i) => i + 1)
        : [parseInt(pendingFilterFloor)];

    // Preload all cell data
    const flatWorkItems = getFlatWorkItems();
    const workCategories = ensureWorkCategories((currentVenture && currentVenture.work_categories) ? currentVenture.work_categories : WORK_CATEGORIES);
    const requiredKeys = [];

    floorsToCheck.forEach(floor => {
        const flatNumbers = [];
        for (let i = 1; i <= flatsPerFloor; i++) {
            flatNumbers.push((floor * 100) + i);
        }
        flatNumbers.forEach(flat => {
            flatWorkItems.forEach(item => {
                requiredKeys.push(cacheKey(cellKeyById(currentBlock, floor, flat, item.id)));
            });
            Object.entries(workCategories).forEach(([category, items]) => {
                items.forEach(itemObj => {
                    requiredKeys.push(cacheKey(workViewCellKeyById(currentBlock, floor, category, itemObj.id, flat)));
                });
            });
        });
    });
    await ensureCellsInCache(requiredKeys);

    // Build rows
    const rows = [];
    floorsToCheck.forEach(floor => {
        const flatNumbers = [];
        for (let i = 1; i <= flatsPerFloor; i++) {
            flatNumbers.push((floor * 100) + i);
        }
        const flatsToCheck = pendingFilterFlat === 'all'
            ? flatNumbers
            : [parseInt(pendingFilterFlat)].filter(f => flatNumbers.includes(f));

        flatsToCheck.forEach(flat => {
            // Flat view items
            flatWorkItems.forEach(item => {
                const cellId = cellKeyById(currentBlock, floor, flat, item.id);
                const cellData = cellsCache[cacheKey(cellId)];
                const color = cellData?.color || null;
                if (color !== 'green') {
                    rows.push({
                        floor: floors === 1 ? 'Ground' : `${floorLabels[floor - 1] || floor + 'th'}`,
                        flat: flat,
                        workItem: item.label,
                        status: color,
                        statusLabel: color ? COLOR_LABELS[color] : 'Not started',
                        category: 'Flat View',
                        cellId: cellId
                    });
                }
            });
            // Work view items
            Object.entries(workCategories).forEach(([category, items]) => {
                items.forEach(itemObj => {
                    const cellId = workViewCellKeyById(currentBlock, floor, category, itemObj.id, flat);
                    const cellData = cellsCache[cacheKey(cellId)];
                    const color = cellData?.color || null;
                    if (color !== 'green') {
                        rows.push({
                            floor: floors === 1 ? 'Ground' : `${floorLabels[floor - 1] || floor + 'th'}`,
                            flat: flat,
                            workItem: itemObj.label,
                            status: color,
                            statusLabel: color ? COLOR_LABELS[color] : 'Not started',
                            category: category,
                            cellId: cellId
                        });
                    }
                });
            });
        });
    });

    // Store for export
    lastPendingRows = rows;

    // Summary count
    const summary = document.createElement('div');
    summary.className = 'pending-summary';
    const floorLabelText = pendingFilterFloor === 'all' ? 'All Floors' : `${floorLabels[parseInt(pendingFilterFloor) - 1] || pendingFilterFloor + 'th'} Floor`;
    const flatLabelText = pendingFilterFlat === 'all' ? 'All Flats' : `Flat ${pendingFilterFlat}`;
    summary.textContent = `Showing ${rows.length} pending items for ${floorLabelText} — ${flatLabelText}`;
    container.appendChild(summary);

    // Results table
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    const table = document.createElement('table');
    table.className = 'tracker-table pending-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Floor</th><th>Flat</th><th>Work Item</th><th>Status</th><th>Category</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = '<td colspan="5" style="text-align:center;color:#999;padding:24px;">No pending items found</td>';
        tbody.appendChild(emptyRow);
    } else {
        rows.forEach(row => {
            const tr = document.createElement('tr');
            const statusDot = row.status ? `<span class="dot ${row.status}"></span>` : '<span class="dot empty-dot"></span>';
            tr.innerHTML = `
                <td>${row.floor}</td>
                <td>${row.flat}</td>
                <td class="pending-work-cell" data-cellid="${row.cellId}" data-work="${row.workItem}" data-flat="${row.flat}">${row.workItem}</td>
                <td>${statusDot} ${row.statusLabel}</td>
                <td>${row.category}</td>
            `;
            const workCell = tr.querySelector('.pending-work-cell');
            if (!editMode) {
                workCell.style.cursor = 'pointer';
                workCell.style.color = '#1a2a6c';
                workCell.style.textDecoration = 'underline';
                workCell.addEventListener('click', () => {
                    openTimelineModal(row.cellId, row.workItem, row.flat);
                });
            }
            tbody.appendChild(tr);
        });
    }
    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);
}

function exportPendingWorkPDF() {
    if (!lastPendingRows.length) {
        showToast('No pending items to export', true);
        return;
    }
    const ventureName = currentVenture ? currentVenture.name : 'Venture';
    const blockName = currentBlockObj ? (currentBlockObj.name || currentBlockObj.id) : '';
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    const floorLabelText = pendingFilterFloor === 'all' ? 'All Floors' : `${['1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th'][parseInt(pendingFilterFloor)-1] || pendingFilterFloor+'th'} Floor`;
    const flatLabelText = pendingFilterFlat === 'all' ? 'All Flats' : `Flat ${pendingFilterFlat}`;

    let rowsHtml = '';
    lastPendingRows.forEach(row => {
        const statusDot = row.status ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${getColorHex(row.status)};margin-right:6px;"></span>` : '';
        rowsHtml += `
            <tr>
                <td style="padding:10px 12px;border:1px solid #ddd;">${row.floor}</td>
                <td style="padding:10px 12px;border:1px solid #ddd;">${row.flat}</td>
                <td style="padding:10px 12px;border:1px solid #ddd;">${row.workItem}</td>
                <td style="padding:10px 12px;border:1px solid #ddd;">${statusDot}${row.statusLabel}</td>
                <td style="padding:10px 12px;border:1px solid #ddd;">${row.category}</td>
            </tr>`;
    });

    const logoUrl = window.location.origin + '/static/images/image.png';
    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>VGrand Infra - Pending Work Report</title>
    <style>
        @media print { body { margin: 0; } .no-print { display: none !important; } }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 40px; color: #333; }
        .report-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px; border-bottom: 3px solid #1a2a6c; padding-bottom: 20px; }
        .report-header-left { text-align: left; }
        .report-header-left h1 { color: #1a2a6c; font-size: 1.6rem; margin: 0 0 6px 0; }
        .report-header-left p { margin: 2px 0; color: #555; font-size: 0.9rem; }
        .report-logo { max-height: 50px; width: auto; }
        .report-meta { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 0.85rem; color: #777; }
        table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        th { background: #1a2a6c; color: #fff; padding: 12px; text-align: left; border: 1px solid #1a2a6c; }
        .no-print { text-align: center; margin-top: 30px; }
        .no-print button { background: #1a2a6c; color: #fff; border: none; padding: 10px 24px; border-radius: 6px; font-size: 1rem; cursor: pointer; }
    </style>
</head>
<body>
    <div class="report-header">
        <div class="report-header-left">
            <h1>VGrand Infra Tracking</h1>
            <p><strong>Pending Work Report</strong></p>
            <p>Venture: ${ventureName}${blockName ? ' | Block: ' + blockName : ''} | ${floorLabelText} — ${flatLabelText}</p>
        </div>
        <img src="${logoUrl}" alt="Logo" class="report-logo">
    </div>
    <div class="report-meta">
        <span>Generated on: ${dateStr} at ${timeStr}</span>
        <span>Total Pending Items: ${lastPendingRows.length}</span>
    </div>
    <table>
        <thead>
            <tr>
                <th>Floor</th>
                <th>Flat</th>
                <th>Work Item</th>
                <th>Status</th>
                <th>Category</th>
            </tr>
        </thead>
        <tbody>
            ${rowsHtml}
        </tbody>
    </table>
    <div class="no-print">
        <button onclick="window.print()">Print / Save as PDF</button>
    </div>
</body>
</html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
}

function getColorHex(color) {
    const map = { red: '#e74c3c', yellow: '#f1c40f', blue: '#3498db', green: '#2ecc71' };
    return map[color] || '#ccc';
}

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

function openInvoicesPanel() {
    document.getElementById('venturesDashboard').style.display = 'none';
    document.getElementById('invoicesPanel').style.display = '';
    document.getElementById('poPanel').style.display = 'none';
    document.getElementById('payrollPanel').style.display = 'none';
    document.getElementById('inventoryPanel').style.display = 'none';
    document.getElementById('breadcrumbBar').style.display = 'none';
    populateInvoiceFilterVentures();
    populateInvoiceFilterCategories();
    restorePanelState('invoices');
    renderInvoiceCards();
    navigateTo('#/invoices');
}

function closeInvoicesPanel() {
    document.getElementById('invoicesPanel').style.display = 'none';
    document.getElementById('venturesDashboard').style.display = '';
    navigateTo('#/ventures');
}

function openInventoryPanel() {
    document.getElementById('venturesDashboard').style.display = 'none';
    document.getElementById('invoicesPanel').style.display = 'none';
    document.getElementById('poPanel').style.display = 'none';
    document.getElementById('payrollPanel').style.display = 'none';
    document.getElementById('inventoryPanel').style.display = '';
    document.getElementById('breadcrumbBar').style.display = 'none';
    restorePanelState('inventory');
    if (venturesList.length > 0 && !selectedInventoryVenture) {
        selectedInventoryVenture = venturesList[0];
    }
    renderInventoryView();
    navigateTo('#/inventory');
}

function closeInventoryPanel() {
    document.getElementById('inventoryPanel').style.display = 'none';
    document.getElementById('venturesDashboard').style.display = '';
    selectedInventoryVenture = null;
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
        });
    };

    document.getElementById('invoiceViewModal').classList.add('show');
}

function closeInvoiceView() {
    document.getElementById('invoiceViewModal').classList.remove('show');
}

async function deleteInvoice(invoiceId) {
    const invoices = loadAllInvoices().filter(i => i.id !== invoiceId);
    await apiDelete('/api/invoice/' + encodeURIComponent(invoiceId));
    allInvoices = invoices;
    renderInvoiceCards();
    showToast('Invoice deleted');
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
document.getElementById('openInvoicesBtn').addEventListener('click', openInvoicesPanel);
document.getElementById('backFromInvoices').addEventListener('click', closeInvoicesPanel);

// Inventory event wiring
document.getElementById('openInventoryBtn').addEventListener('click', openInventoryPanel);
document.getElementById('backFromInventory').addEventListener('click', closeInventoryPanel);

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

function openPOPanel() {
    document.getElementById('venturesDashboard').style.display = 'none';
    ['invoicesPanel', 'attendancePanel', 'payrollPanel', 'inventoryPanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    document.getElementById('poPanel').style.display = '';
    document.getElementById('breadcrumbBar').style.display = 'none';
    populatePOFilters();
    restorePanelState('po');
    renderPOCards();
    navigateTo('#/pos');
}

function closePOPanel() {
    document.getElementById('poPanel').style.display = 'none';
    document.getElementById('venturesDashboard').style.display = '';
    navigateTo('#/ventures');
}

document.getElementById('openPOBtn').addEventListener('click', openPOPanel);
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
            await apiDelete('/api/po/' + encodeURIComponent(poId));
            allPOs = loadPOs().filter(p => p.id !== poId);
            closePOView();
            renderPOCards();
            showToast('PO deleted');
        });
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

function openVendorDirectory() {
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
                await apiDelete('/api/vendor/' + encodeURIComponent(v.id));
                allVendors = loadVendors().filter(x => x.id !== v.id);
                renderVendorDirList();
                populatePOFilters();
                showToast('Vendor deleted');
            });
        });
        list.appendChild(div);
    });
}

document.getElementById('openVendorDirectoryBtn').addEventListener('click', openVendorDirectory);
document.getElementById('closeVendorDir').addEventListener('click', closeVendorDirectory);
document.getElementById('vendorDirModal').addEventListener('click', e => {
    if (e.target === document.getElementById('vendorDirModal')) closeVendorDirectory();
});
document.getElementById('addVendorBtn').addEventListener('click', () => openVendorForm(null));

function openVendorForm(vendorId, fromPOForm) {
    vendorEditingId = vendorId;
    _vendorFromPOForm = fromPOForm || false;
    document.getElementById('vendorFormTitle').textContent = vendorId ? 'Edit Vendor' : 'Add Vendor';

    ['vendorNameInput','vendorContactInput','vendorPhoneInput','vendorEmailInput',
     'vendorGSTInput','vendorAddressInput','vendorBankNameInput','vendorAccNoInput',
     'vendorIFSCInput','vendorAccHolderInput','vendorNotesInput'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('vendorTypeInput').value = '';

    if (vendorId) {
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

    await saveVendors(vendors);
    showToast(vendorEditingId ? 'Vendor updated' : 'Vendor added');
    closeVendorForm();
    renderVendorDirList();
    populatePOFilters();

    if (_vendorFromPOForm) {
        populatePOVendorSelect(vendorData.id);
    }
});

// ========================
// Payroll View
// ========================
let payrollData = { employees: [], categories: [] };
let payrollEditingEmpId = null;
let selectedPayrollVenture = null; // used when opened from dashboard panel; null = All Ventures
let payrollPanelMode = false;
let payrollModalContext = { type: 'panel', data: null, key: '', container: null };

document.getElementById('payrollBtn')?.addEventListener('click', () => {
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    previousView = currentView;
    currentView = 'payroll';
    document.getElementById('flatViewContainer').style.display = 'none';
    document.getElementById('workViewContainer').style.display = 'none';
    document.getElementById('superStructureContainer').style.display = 'none';
    document.getElementById('pendingViewContainer').style.display = 'none';
    const rvc = document.getElementById('reportsViewContainer');
    if (rvc) rvc.style.display = 'none';
    document.getElementById('payrollViewContainer').style.display = '';
    payrollPanelMode = false;
    selectedPayrollVenture = null;
    renderPayrollView();
});

function openPayrollPanel() {
    document.getElementById('venturesDashboard').style.display = 'none';
    ['invoicesPanel', 'poPanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    document.getElementById('payrollPanel').style.display = '';
    document.getElementById('breadcrumbBar').style.display = 'none';
    restorePanelState('payroll');
    payrollPanelMode = true;
    renderPayrollView();
    navigateTo('#/payroll');
}

function closePayrollPanel() {
    document.getElementById('payrollPanel').style.display = 'none';
    document.getElementById('venturesDashboard').style.display = '';
    selectedPayrollVenture = null;
    payrollPanelMode = false;
    navigateTo('#/ventures');
}

document.getElementById('openPayrollBtn').addEventListener('click', openPayrollPanel);
document.getElementById('backFromPayroll').addEventListener('click', closePayrollPanel);

function payrollMonthKey() {
    const monthInput = document.getElementById('payrollMonthSelect');
    return monthInput ? monthInput.value : new Date().toISOString().slice(0, 7);
}

function payrollActiveVenture() {
    if (payrollPanelMode) return selectedPayrollVenture;
    return currentVenture;
}

function payrollSettingKey(month, venture) {
    const v = venture || payrollActiveVenture();
    return v ? `payroll_${v.id}_${month}` : '';
}

async function loadPayrollData(month, venture) {
    const v = venture || payrollActiveVenture();
    if (!v) {
        // Aggregate payroll data across all ventures
        const allData = { employees: [], categories: [] };
        const promises = venturesList.map(async (venture) => {
            const key = `payroll_${venture.id}_${month}`;
            const data = await apiGet('/api/settings/' + encodeURIComponent(key));
            if (data && data.employees) {
                const employees = (data.employees || []).map(e => ({
                    ...e,
                    ventureId: venture.id,
                    ventureName: venture.name
                }));
                allData.employees.push(...employees);
                (data.categories || []).forEach(cat => {
                    if (!allData.categories.includes(cat)) allData.categories.push(cat);
                });
            }
        });
        await Promise.all(promises);
        return allData;
    }
    const key = payrollSettingKey(month, v);
    const data = await apiGet('/api/settings/' + encodeURIComponent(key));
    if (data && data.employees) {
        return data;
    }
    return { employees: [], categories: [] };
}

async function savePayrollData(month, data, venture) {
    const v = venture || payrollActiveVenture();
    if (!v) return;
    const key = payrollSettingKey(month, v);
    await apiPost('/api/settings/' + encodeURIComponent(key), data);
}

async function renderPayrollView() {
    const venture = payrollActiveVenture();
    const isPanel = payrollPanelMode;
    const isAllMode = isPanel && !selectedPayrollVenture;
    const container = document.getElementById(isPanel ? 'payrollPanelContent' : 'payrollViewContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!venture && !isAllMode) {
        container.innerHTML = '<div style="padding:24px;color:#999;">No venture selected.</div>';
        return;
    }

    // Default to current month
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Header bar
    const headerBar = document.createElement('div');
    headerBar.className = 'pending-filter-bar';

    // Venture selector (only in panel mode)
    if (isPanel) {
        const ventureGroup = document.createElement('div');
        ventureGroup.className = 'pending-filter-group';
        let ventureOptions = `<option value="all" ${!selectedPayrollVenture ? 'selected' : ''}>All Ventures</option>`;
        venturesList.forEach(v => {
            ventureOptions += `<option value="${v.id}" ${selectedPayrollVenture && selectedPayrollVenture.id === v.id ? 'selected' : ''}>${v.name}</option>`;
        });
        ventureGroup.innerHTML = `<label>Venture</label><select id="payrollVentureSelect">${ventureOptions}</select>`;
        headerBar.appendChild(ventureGroup);
    } else {
        // Venture label (tracker view)
        const ventureGroup = document.createElement('div');
        ventureGroup.className = 'pending-filter-group';
        ventureGroup.innerHTML = `<label>Venture</label><div class="pending-readonly">${venture.name}</div>`;
        headerBar.appendChild(ventureGroup);
    }

    // Month selector
    const monthGroup = document.createElement('div');
    monthGroup.className = 'pending-filter-group';
    monthGroup.innerHTML = `<label>Month</label><input type="month" id="payrollMonthSelect" value="${currentMonth}">`;
    headerBar.appendChild(monthGroup);

    // Add employee button
    const addGroup = document.createElement('div');
    addGroup.className = 'pending-filter-group';
    addGroup.style.alignSelf = 'flex-end';
    addGroup.innerHTML = `<button id="payrollAddEmpBtn" class="btn-primary" style="padding:8px 16px;" ${isAllMode ? 'disabled title="Select a venture to add employees"' : ''}>+ Add Employee</button>`;
    headerBar.appendChild(addGroup);

    // Export CSV button
    const exportGroup = document.createElement('div');
    exportGroup.className = 'pending-filter-group';
    exportGroup.style.alignSelf = 'flex-end';
    exportGroup.innerHTML = `<button id="payrollExportCSV" class="btn-secondary" style="padding:8px 16px;">📄 Export CSV</button>`;
    headerBar.appendChild(exportGroup);

    container.appendChild(headerBar);

    // Load payroll data for the month
    payrollData = await loadPayrollData(currentMonth, venture);

    // Populate category datalist
    const datalist = document.getElementById('payrollCategoryList');
    if (datalist) {
        datalist.innerHTML = '';
        (payrollData.categories || []).forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            datalist.appendChild(opt);
        });
    }

    // Summary bar
    const summaryBar = document.createElement('div');
    summaryBar.className = 'pending-summary';
    const totalBase = (payrollData.employees || []).reduce((s, e) => s + (parseFloat(e.base) || 0), 0);
    const totalAdvance = (payrollData.employees || []).reduce((s, e) => s + (parseFloat(e.advance) || 0), 0);
    const netPay = totalBase - totalAdvance;
    let summaryHtml = `
        <strong>${(payrollData.employees || []).length}</strong> employees |
        Total Base: <strong>&#8377;${totalBase.toLocaleString('en-IN', {maximumFractionDigits:2})}</strong> |
        Total Advance: <strong>&#8377;${totalAdvance.toLocaleString('en-IN', {maximumFractionDigits:2})}</strong> |
        Net Pay: <strong>&#8377;${netPay.toLocaleString('en-IN', {maximumFractionDigits:2})}</strong>
    `;
    if (isAllMode) {
        summaryHtml += `<span style="margin-left:12px;color:#666;">(Showing all ventures — select a venture to manage employees)</span>`;
    }
    summaryBar.innerHTML = summaryHtml;
    container.appendChild(summaryBar);

    // Employee table
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    const table = document.createElement('table');
    table.className = 'tracker-table pending-table';

    const thead = document.createElement('thead');
    if (isAllMode) {
        thead.innerHTML = '<tr><th>S.No</th><th>Venture</th><th>Name</th><th>Category</th><th>Base (&#8377;)</th><th>Advance (&#8377;)</th><th>Net Pay (&#8377;)</th></tr>';
    } else {
        thead.innerHTML = '<tr><th>S.No</th><th>Name</th><th>Category</th><th>Base (&#8377;)</th><th>Advance (&#8377;)</th><th>Net Pay (&#8377;)</th><th>Actions</th></tr>';
    }
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    if (!payrollData.employees || payrollData.employees.length === 0) {
        const emptyRow = document.createElement('tr');
        const colCount = isAllMode ? 7 : 7;
        emptyRow.innerHTML = `<td colspan="${colCount}" style="text-align:center;color:#999;padding:24px;">No employees added yet. Click "+ Add Employee" to get started.</td>`;
        tbody.appendChild(emptyRow);
    } else {
        payrollData.employees.forEach((emp, idx) => {
            const tr = document.createElement('tr');
            const netPay = (parseFloat(emp.base) || 0) - (parseFloat(emp.advance) || 0);
            if (isAllMode) {
                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(emp.ventureName || '')}</td>
                    <td>${escapeHtml(emp.name)}</td>
                    <td>${escapeHtml(emp.category || '')}</td>
                    <td>${(parseFloat(emp.base) || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td>${(parseFloat(emp.advance) || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td>${netPay.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                `;
            } else {
                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(emp.name)}</td>
                    <td>${escapeHtml(emp.category || '')}</td>
                    <td>${(parseFloat(emp.base) || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td>${(parseFloat(emp.advance) || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td>${netPay.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td style="text-align:center;">
                        <div class="payroll-actions">
                            <button class="btn-text payroll-edit-btn" data-empid="${emp.id}" title="Edit">&#9998;</button>
                            <button class="btn-text payroll-del-btn" data-empid="${emp.id}" style="color:#c0392b;" title="Delete">Delete</button>
                            <button class="btn-text payroll-history-btn" data-empid="${emp.id}">history</button>
                        </div>
                    </td>
                `;
            }
            tbody.appendChild(tr);
        });
    }
    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);

    // Wire events
    const monthSelect = container.querySelector('#payrollMonthSelect');
    monthSelect.addEventListener('change', async () => {
        renderPayrollView();
    });

    if (isPanel) {
        const ventureSelect = container.querySelector('#payrollVentureSelect');
        if (ventureSelect) {
            ventureSelect.addEventListener('change', (e) => {
                selectedPayrollVenture = e.target.value === 'all' ? null : venturesList.find(v => v.id === e.target.value) || null;
                renderPayrollView();
            });
        }
    }

    const addBtn = container.querySelector('#payrollAddEmpBtn');
    if (addBtn && !isAllMode) {
        addBtn.addEventListener('click', () => {
            payrollModalContext = { type: 'panel', data: null, key: '', container: null };
            payrollEditingEmpId = null;
            openPayrollEmpModal(null);
        });
    }

    container.querySelector('#payrollExportCSV').addEventListener('click', exportPayrollCSV);

    if (!isAllMode) {
        container.querySelectorAll('.payroll-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const emp = payrollData.employees.find(e => e.id === btn.dataset.empid);
                if (emp) {
                    payrollModalContext = { type: 'panel', data: null, key: '', container: null };
                    payrollEditingEmpId = emp.id;
                    openPayrollEmpModal(emp);
                }
            });
        });

        container.querySelectorAll('.payroll-del-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const emp = payrollData.employees.find(e => e.id === btn.dataset.empid);
                if (!emp) return;
                showConfirm('Delete Employee', `Delete '${emp.name}' from payroll?`, async () => {
                    payrollData.employees = payrollData.employees.filter(e => e.id !== emp.id);
                    renderPayrollView();
                    showToast('Employee deleted');
                    try {
                        await savePayrollData(payrollMonthKey(), payrollData);
                    } catch (err) {
                        showToast('Failed to save deletion', true);
                        console.error(err);
                    }
                });
            });
        });

        // History button (small link under the pencil, like flat/work view)
        container.querySelectorAll('.payroll-history-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const emp = payrollData.employees.find(e => e.id === btn.dataset.empid);
                if (emp) openPayrollHistoryModal(emp);
            });
        });
    }
}

function openPayrollEmpModal(emp) {
    const data = payrollModalContext.type === 'home' ? (payrollModalContext.data || payrollData) : payrollData;
    document.getElementById('payrollEmpTitle').textContent = emp ? 'Edit Employee' : 'Add Employee';
    document.getElementById('payrollEmpName').value = emp ? (emp.name || '') : '';
    document.getElementById('payrollEmpCategory').value = emp ? (emp.category || '') : '';
    document.getElementById('payrollEmpBase').value = emp ? (emp.base || '') : '';
    document.getElementById('payrollEmpAdvance').value = emp ? (emp.advance || '') : '';

    // Populate datalist
    const datalist = document.getElementById('payrollCategoryList');
    datalist.innerHTML = '';
    (data.categories || []).forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        datalist.appendChild(opt);
    });

    document.getElementById('payrollEmpModal').classList.add('show');
}

function closePayrollEmpModal() {
    document.getElementById('payrollEmpModal').classList.remove('show');
    payrollEditingEmpId = null;
}

document.getElementById('closePayrollEmp').addEventListener('click', closePayrollEmpModal);
document.getElementById('cancelPayrollEmp').addEventListener('click', closePayrollEmpModal);
document.getElementById('payrollEmpModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('payrollEmpModal')) closePayrollEmpModal();
});

document.getElementById('savePayrollEmp').addEventListener('click', async () => {
    const name = document.getElementById('payrollEmpName').value.trim();
    if (!name) { showToast('Please enter a name', true); return; }

    const category = document.getElementById('payrollEmpCategory').value.trim();
    const base = parseFloat(document.getElementById('payrollEmpBase').value) || 0;
    const advance = parseFloat(document.getElementById('payrollEmpAdvance').value) || 0;

    if (payrollModalContext.type === 'home') {
        const data = payrollModalContext.data;
        const key = payrollModalContext.key;
        const container = payrollModalContext.container;
        if (category && !data.categories.includes(category)) {
            data.categories.push(category);
        }
        if (payrollEditingEmpId) {
            const emp = data.employees.find(e => e.id === payrollEditingEmpId);
            if (emp) {
                emp.name = name;
                emp.category = category;
                emp.base = base;
                emp.advance = advance;
            }
        } else {
            data.employees.push({ id: generateId(), name, category, base, advance, advanceHistory: [] });
        }
        closePayrollEmpModal();
        renderHomePayroll(container);
        showToast('Employee saved');
        try {
            await apiPost('/api/settings/' + encodeURIComponent(key), data);
        } catch (err) {
            showToast('Failed to save changes', true);
            console.error(err);
        }
        return;
    }

    if (category && !payrollData.categories.includes(category)) {
        payrollData.categories.push(category);
    }

    if (payrollEditingEmpId) {
        const emp = payrollData.employees.find(e => e.id === payrollEditingEmpId);
        if (emp) {
            emp.history = emp.history || [];
            const oldBase = parseFloat(emp.base) || 0;
            const oldAdvance = parseFloat(emp.advance) || 0;
            const now = new Date().toISOString();
            if (base !== oldBase) {
                emp.history.push({ date: now, field: 'Base', oldValue: oldBase, newValue: base });
            }
            if (advance !== oldAdvance) {
                emp.history.push({ date: now, field: 'Advance', oldValue: oldAdvance, newValue: advance });
            }
            emp.name = name;
            emp.category = category;
            emp.base = base;
            emp.advance = advance;
        }
    } else {
        payrollData.employees.push({
            id: generateId(),
            name,
            category,
            base,
            advance,
            history: []
        });
    }

    closePayrollEmpModal();
    renderPayrollView();
    showToast('Employee saved');
    try {
        await savePayrollData(payrollMonthKey(), payrollData);
    } catch (err) {
        showToast('Failed to save changes', true);
        console.error(err);
    }
});

function openPayrollHistoryModal(emp, opts = {}) {
    const isAdvance = opts.isAdvanceHistory || false;
    document.getElementById('payrollHistoryTitle').textContent = opts.title || `History - ${emp.name}`;
    const body = document.getElementById('payrollHistoryBody');
    const history = opts.history || emp.history || [];
    if (history.length === 0) {
        body.innerHTML = '<div style="padding:12px;color:#999;">No history recorded yet.</div>';
    } else if (isAdvance) {
        body.innerHTML = history.map(h => {
            const amount = parseFloat(h.amount) || 0;
            return `<div style="padding:8px 0;border-bottom:1px solid #f0f2f5;">
                <div style="font-size:0.75rem;color:#888;">${h.date || '-'}</div>
                <div style="font-size:0.85rem;">Advance: &#8377;${amount.toLocaleString('en-IN', {maximumFractionDigits:2})}${h.remarks ? ' <span style="color:#666;">(' + escapeHtml(h.remarks) + ')</span>' : ''}</div>
                ${h.nextAdvanceDate ? `<div style="font-size:0.75rem;color:#666;">Next: ${h.nextAdvanceDate}</div>` : ''}
            </div>`;
        }).join('');
    } else {
        body.innerHTML = history.map(h => {
            const oldVal = parseFloat(h.oldValue) || 0;
            const newVal = parseFloat(h.newValue) || 0;
            return `<div style="padding:8px 0;border-bottom:1px solid #f0f2f5;">
                <div style="font-size:0.75rem;color:#888;">${new Date(h.date).toLocaleString('en-IN')}</div>
                <div style="font-size:0.85rem;">${h.field}: &#8377;${oldVal.toLocaleString('en-IN', {maximumFractionDigits:2})} &rarr; &#8377;${newVal.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
            </div>`;
        }).join('');
    }
    document.getElementById('payrollHistoryModal').classList.add('show');
}

function closePayrollHistoryModal() {
    document.getElementById('payrollHistoryModal').classList.remove('show');
}

document.getElementById('closePayrollHistory').addEventListener('click', closePayrollHistoryModal);
document.getElementById('payrollHistoryModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('payrollHistoryModal')) closePayrollHistoryModal();
});

function exportPayrollCSV() {
    if (!payrollData.employees || payrollData.employees.length === 0) {
        showToast('No employees to export', true);
        return;
    }

    const month = payrollMonthKey();
    const isAllMode = payrollPanelMode && !selectedPayrollVenture;
    const ventureName = isAllMode ? 'All Ventures' : (payrollActiveVenture()?.name || 'Venture');
    const rows = isAllMode
        ? [['S.No', 'Venture', 'Name', 'Category', 'Base', 'Advance', 'Net Pay']]
        : [['S.No', 'Name', 'Category', 'Base', 'Advance', 'Net Pay']];

    payrollData.employees.forEach((emp, idx) => {
        const netPay = (parseFloat(emp.base) || 0) - (parseFloat(emp.advance) || 0);
        if (isAllMode) {
            rows.push([
                idx + 1,
                emp.ventureName || '',
                emp.name,
                emp.category || '',
                emp.base || 0,
                emp.advance || 0,
                netPay
            ]);
        } else {
            rows.push([
                idx + 1,
                emp.name,
                emp.category || '',
                emp.base || 0,
                emp.advance || 0,
                netPay
            ]);
        }
    });

    // Totals row
    const totalBase = payrollData.employees.reduce((s, e) => s + (parseFloat(e.base) || 0), 0);
    const totalAdvance = payrollData.employees.reduce((s, e) => s + (parseFloat(e.advance) || 0), 0);
    const totalRow = isAllMode
        ? ['', 'TOTALS', '', '', totalBase, totalAdvance, totalBase - totalAdvance]
        : ['', 'TOTALS', '', totalBase, totalAdvance, totalBase - totalAdvance];
    rows.push([]);
    rows.push(totalRow);

    const csvContent = rows.map(row =>
        row.map(cell => {
            const str = String(cell);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        }).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `payroll_${ventureName}_${month}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    showToast('CSV exported');
}

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
                <td>${escapeHtml(mat.name || 'Unknown')}</td>
                <td>${escapeHtml(mat.category || '-')}</td>
                <td>${escapeHtml(mat.unit || '-')}</td>
                <td>${formatNumber(row.total_in)}</td>
                <td>${formatNumber(row.total_out)}</td>
                <td>${formatNumber(row.total_adjust)}</td>
                <td style="font-weight:700;">${formatNumber(row.balance)}</td>
                <td>${statusHtml}</td>
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
            const item = document.createElement('div');
            item.className = 'material-list-item';
            item.innerHTML = `
                <div class="material-list-info">
                    <span class="material-list-name">${escapeHtml(mat.name)}</span>
                    <span class="material-list-meta">${escapeHtml(mat.category || 'Uncategorized')} | ${escapeHtml(mat.unit)} | threshold: ${mat.min_threshold || 0}</span>
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


