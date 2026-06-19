// ========================
// API Persistence
// ========================

async function apiGet(path) {
    const res = await fetch(path);
    if (!res.ok) return null;
    return res.json();
}

async function apiPost(path, data) {
    await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
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
let currentVenture = null;
let currentBlockObj = null;
let currentBlock = 'A';
let currentFloor = 1;
let workItems = [];
let cellsCache = {};
let selectedCellId = null;
let selectedWorkItem = null;
let selectedFlat = null;
let venturesList = [];

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
    ]
};

const CORRIDORS = ["Plaster", "Mesh", "Lanter", "Wiring", "Stains & Cleaning", "Flooring"];
const ELEVATION_WORK = ["Marka", "Elevation", "Electrics", "Wall Care", "Texture"];

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

function cacheKey(cellId) {
    return currentVenture ? `${currentVenture.id}_${cellId}` : cellId;
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
    if (!cats) return JSON.parse(JSON.stringify(WORK_CATEGORIES));
    const result = {};
    Object.entries(cats).forEach(([catLabel, items]) => {
        const catId = `cat_${slugId(catLabel)}`;
        if (typeof items[0] === 'object' && items[0].id) {
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
    if (currentVenture && currentVenture.super_structure_items) {
        return ensureItemIds(currentVenture.super_structure_items);
    }
    return ensureItemIds(SUPER_STRUCTURE_ITEMS);
}

function cellKeyById(block, floor, flat, itemId) {
    return `${block}_floor${floor}_${flat}_${itemId}`;
}

function ssCellKeyById(block, itemId) {
    return `superstructure_${block}_${itemId}`;
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
async function checkSession() {
    try {
        const resp = await fetch('/api/me');
        const data = await resp.json();
        if (data.user) {
            currentUser = data.user;
            els.userEmail.textContent = currentUser;
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
        await saveVenturesToLS();
        showToast('Work items saved successfully');
        return;
    }
    showToast('Work items saved');
}

async function getCellData(cellId) {
    const ck = cacheKey(cellId);
    if (cellsCache[ck] !== undefined) return cellsCache[ck];
    // Preloaded at init; if missing, try API fallback
    const data = await apiGet('/api/cell/' + encodeURIComponent(ck));
    cellsCache[ck] = data;
    return data;
}

async function getSsCellData(cellId) {
    const ck = cacheKey(cellId);
    if (cellsCache[ck] !== undefined) return cellsCache[ck];
    const data = await apiGet('/api/cell/' + encodeURIComponent(ck));
    cellsCache[ck] = data;
    return data;
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
        const timeline = existing.timeline || [];
        timeline.push(timelineEntry);
        let remarks = existing.remarks || '';
        if (autoRemark) {
            remarks = remarks ? remarks + '\n' + autoRemark : autoRemark;
        }
        data = {
            ...existing,
            color: color || null,
            remarks: remarks,
            timeline: timeline,
            updated_at: new Date().toISOString(),
            updated_by: currentUser
        };
    } else {
        data = {
            color: color || null,
            remarks: autoRemark,
            timeline: [timelineEntry],
            updated_at: new Date().toISOString(),
            updated_by: currentUser
        };
    }
    await apiPost('/api/cell/' + encodeURIComponent(ck), data);
    cellsCache[ck] = data;
    if (currentView === 'flat') renderGrid();
    else if (currentView === 'work') renderWorkView();
    showToast('Status updated');
}

async function saveCellRemarks(cellId, remarks) {
    const ck = cacheKey(cellId);
    const existing = cellsCache[ck] || {};
    const data = {
        ...existing,
        remarks: remarks,
        updated_at: new Date().toISOString(),
        updated_by: currentUser
    };
    await apiPost('/api/cell/' + encodeURIComponent(ck), data);
    cellsCache[ck] = data;
    if (currentView === 'flat') renderGrid();
    else if (currentView === 'work') renderWorkView();
    showToast('Remarks saved');
}

// Venture persistence
async function saveVenturesToLS() {
    await apiPost('/api/ventures', venturesList);
}

async function seedEliteBlockColors(blockId) {
    const gateKey = `elite_${blockId}_seeded_v3`;
    if (localStorage.getItem(gateKey) === 'true') return;

    const elite = venturesList.find(v => v.id === 'elite');
    if (!elite) return;

    // Generate item IDs exactly like ensureItemIds does for DEFAULT_WORK_ITEMS
    const items = DEFAULT_WORK_ITEMS.map((label, i) => ({ id: `item_${slugId(label)}_${i}`, label }));

    const colorMap = {
        G: { color: 'green', status_label: 'Completed' },
        Y: { color: 'yellow', status_label: 'In progress' },
        R: { color: 'red', status_label: 'Yet to start' }
    };

    // Color data matrix: floor -> flat -> itemIndex -> 'G'|'Y'|'R'
    const matrix = {
        1: {
            101: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            102: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            103: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            104: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            105: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            106: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'}
        },
        2: {
            201: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            202: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            203: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            204: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            205: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'Y',17:'Y',18:'R',19:'R',20:'R'},
            206: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'}
        },
        3: {
            301: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            302: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            303: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            304: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'R',14:'R',15:'R',16:'R',17:'R',18:'R',19:'R',20:'R'},
            305: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            306: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'}
        },
        4: {
            401: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            402: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            403: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'Y',14:'R',15:'R',16:'R',17:'R',18:'R',19:'R',20:'R'},
            404: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'Y',14:'R',15:'R',16:'R',17:'R',18:'R',19:'R',20:'R'},
            405: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'R',14:'R',15:'R',16:'R',17:'R',18:'R',19:'R',20:'R'},
            406: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'R',14:'R',15:'R',16:'R',17:'R',18:'R',19:'R',20:'R'}
        },
        5: {
            501: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            502: {0:'G',1:'G',2:'G',3:'G',4:'G',5:'G',6:'G',7:'G',8:'G',9:'G',10:'G',11:'G',12:'G',13:'G',14:'G',15:'G',16:'G',17:'G',18:'G',19:'G',20:'G'},
            503: {0:'G',1:'G',2:'G',3:'G',4:'R',5:'R',6:'R',7:'R',8:'R',9:'R',10:'R',11:'R',12:'R',13:'R',14:'R',15:'R',16:'R',17:'R',18:'R',19:'R',20:'R'},
            504: {0:'G',1:'G',2:'G',3:'G',4:'R',5:'R',6:'R',7:'R',8:'R',9:'R',10:'R',11:'R',12:'R',13:'R',14:'R',15:'R',16:'R',17:'R',18:'R',19:'R',20:'R'},
            505: {0:'G',1:'G',2:'G',3:'G',4:'R',5:'R',6:'R',7:'R',8:'R',9:'R',10:'R',11:'R',12:'R',13:'R',14:'R',15:'R',16:'R',17:'R',18:'R',19:'R',20:'R'},
            506: {0:'G',1:'G',2:'G',3:'G',4:'R',5:'R',6:'R',7:'R',8:'R',9:'R',10:'R',11:'R',12:'R',13:'R',14:'R',15:'R',16:'R',17:'R',18:'R',19:'R',20:'R'}
        }
    };

    const ventureId = 'elite';
    const batch = [];

    for (let floor = 1; floor <= 5; floor++) {
        const floorData = matrix[floor];
        if (!floorData) continue;
        for (let flatPos = 1; flatPos <= 6; flatPos++) {
            const flat = (floor * 100) + flatPos;
            const flatData = floorData[flat];
            if (!flatData) continue;
            for (let itemIdx = 0; itemIdx < 21; itemIdx++) {
                const code = flatData[itemIdx];
                if (!code || !colorMap[code]) continue;
                const item = items[itemIdx];
                const cellId = cellKeyById(blockId, floor, flat, item.id);
                const ck = `${ventureId}_${cellId}`;
                const data = {
                    color: colorMap[code].color,
                    status_label: colorMap[code].status_label,
                    timeline: [],
                    remarks: ''
                };
                batch.push({ id: ck, data });
                cellsCache[ck] = data;
            }
        }
    }

    if (batch.length > 0) {
        await apiPost('/api/cells/batch', { cells: batch });
    }
    localStorage.setItem(gateKey, 'true');
}

async function loadVenturesFromLS() {
    const saved = await apiGet('/api/ventures');
    if (saved && saved.length > 0) {
        venturesList = saved;
    } else {
        venturesList = createDefaultVentures();
        await saveVenturesToLS();
    }

    // Seed ELITE A and B block colors once per block
    try { await seedEliteBlockColors('A'); } catch (e) { console.error('Seed A failed', e); }
    try { await seedEliteBlockColors('B'); } catch (e) { console.error('Seed B failed', e); }
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

    // Preload all cell data
    const promises = [];
    activeItems.forEach(item => {
        for (const flat of flatNumbers) {
            const cellId = cellKeyById(currentBlock, currentFloor, flat, item.id);
            promises.push(getCellData(cellId));
        }
    });
    await Promise.all(promises);

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
            if (editMode) btn.disabled = true;

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
                    openStatusPopup(cellId, item.label, flat, color);
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
        for (const flat of flatNumbers) {
            const cellId = cellKeyById(currentBlock, currentFloor, flat, item.id);
            const cellData = cellsCache[cacheKey(cellId)];
            if (cellData?.remarks) {
                remarksParts.push(`${flat}: ${cellData.remarks}`);
            }
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

    // Preload all cell data
    const promises = [];

    function queueLoads(category, items, flats) {
        items.forEach((itemObj) => {
            flats.forEach(flat => {
                const cellId = workViewCellKeyById(currentBlock, currentFloor, category, itemObj.id, flat);
                promises.push(getCellData(cellId));
            });
        });
    }

    Object.entries(workCategories).forEach(([cat, items]) => {
        queueLoads(cat, items, flatNumbers);
    });
    queueLoads('CORRIDORS', CORRIDORS.map((l, i) => ({ id: `corridor_${i}`, label: l })), ['P-004']);
    queueLoads('ELEVATION WORK', ELEVATION_WORK.map((l, i) => ({ id: `elevation_${i}`, label: l })), ['P-004']);
    await Promise.all(promises);

    // Render 5 main category sections
    Object.entries(workCategories).forEach(([category, items]) => {
        container.appendChild(createSectionTable(category, items, flatNumbers));
    });

    // Corridors
    container.appendChild(createSectionTable('CORRIDORS', CORRIDORS.map((l, i) => ({ id: `corridor_${i}`, label: l })), ['P-004']));

    // Elevation Work
    container.appendChild(createSectionTable('ELEVATION WORK', ELEVATION_WORK.map((l, i) => ({ id: `elevation_${i}`, label: l })), ['P-004']));
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
        ctrl.innerHTML = '<button class="edit-btn" title="Rename category">&#9998;</button>';
        ctrl.querySelector('button').addEventListener('click', () => startInlineEdit(header, category, (newName) => renameWorkCategory(category, newName)));
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
            if (editMode) btn.disabled = true;

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
                    openStatusPopup(cellId, itemObj.label, flat, color);
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
        flats.forEach(flat => {
            const cellId = workViewCellKeyById(currentBlock, currentFloor, category, itemObj.id, flat);
            const cellData = cellsCache[cacheKey(cellId)];
            if (cellData?.remarks) {
                remarksParts.push(`${flat}: ${cellData.remarks}`);
            }
        });
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
        await updateCellColor(selectedCellId, color, selectedWorkItem, selectedFlat);
        closeStatusPopup();
    });
});

els.clearStatusBtn.addEventListener('click', async () => {
    if (!selectedCellId) return;
    await updateCellColor(selectedCellId, null, selectedWorkItem, selectedFlat);
    closeStatusPopup();
});

els.cancelStatusBtn.addEventListener('click', closeStatusPopup);
els.statusPopup.addEventListener('click', (e) => {
    if (e.target === els.statusPopup) closeStatusPopup();
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
    els.timelineModal.classList.add('show');
}

function closeTimelineModal() {
    els.timelineModal.classList.remove('show');
    selectedCellId = null;
    selectedWorkItem = null;
    selectedFlat = null;
}

els.closeTimeline.addEventListener('click', closeTimelineModal);
els.timelineModal.addEventListener('click', (e) => {
    if (e.target === els.timelineModal) closeTimelineModal();
});

els.saveRemarksBtn.addEventListener('click', async () => {
    if (!selectedCellId) return;
    await saveCellRemarks(selectedCellId, els.remarksTextarea.value);
});

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
    currentVenture.blocks.forEach((block, index) => {
        const btn = document.createElement('button');
        btn.className = 'block-tab' + (index === 0 ? ' active' : '');
        btn.dataset.block = block.id;
        btn.textContent = block.name || block.id + ' Block';
        btn.addEventListener('click', () => {
            document.querySelectorAll('.block-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentBlock = block.id;
            currentBlockObj = block;
            currentFloor = 1;
            cellsCache = {};
            renderFloorTabs();
            if (currentView === 'flat') {
                renderGrid();
            } else if (currentView === 'work') {
                renderWorkView();
            } else {
                renderSuperStructure();
            }
        });
        container.appendChild(btn);
    });
    if (currentVenture.blocks.length > 0) {
        currentBlock = currentVenture.blocks[0].id;
        currentBlockObj = currentVenture.blocks[0];
    }
}

function renderFloorTabs() {
    const container = document.getElementById('floorTabsContainer');
    container.innerHTML = '';
    const floors = currentBlockObj ? (currentBlockObj.floors || 5) : 5;
    const floorLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
    for (let f = 1; f <= floors; f++) {
        const btn = document.createElement('button');
        btn.className = 'floor-tab' + (f === 1 ? ' active' : '');
        btn.dataset.floor = f;
        const label = floors === 1 ? 'Ground Floor' : `${floorLabels[f - 1] || f + 'th'} Floor`;
        btn.textContent = label;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.floor-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFloor = f;
            cellsCache = {};
            if (currentView === 'flat') {
                renderGrid();
            } else if (currentView === 'work') {
                renderWorkView();
            } else {
                renderSuperStructure();
            }
        });
        container.appendChild(btn);
    }
    currentFloor = 1;
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
    try { await preloadCells(); } catch (e) { cellsCache = {}; }
    try { await loadVentures(); } catch (e) { venturesList = createDefaultVentures(); renderVentureDashboard(); }
    try { allInvoices = await apiGet('/api/invoices') || []; } catch (e) { allInvoices = []; }
    try { allCategories = await apiGet('/api/settings/invoice_categories') || [
        'Brick', 'Sand', 'Steel', 'Cement', 'Tiles',
        'Electrical', 'Plumbing', 'Labour', 'Paint', 'Wood'
    ]; } catch (e) { allCategories = ['Brick', 'Sand', 'Steel', 'Cement', 'Tiles', 'Electrical', 'Plumbing', 'Labour', 'Paint', 'Wood']; }
    try { allPOs = await apiGet('/api/pos') || []; } catch (e) { allPOs = []; }
    try { allVendors = await apiGet('/api/vendors') || []; } catch (e) { allVendors = []; }
    startPolling();
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
    pollInterval = setInterval(pollData, 5000);
}

async function pollData() {
    // Skip polling while user is actively editing (any modal open)
    if (document.querySelector('.modal.show')) return;

    let changed = false;

    // Ventures
    try {
        const fresh = await apiGet('/api/ventures');
        if (fresh && JSON.stringify(fresh) !== JSON.stringify(venturesList)) {
            venturesList = fresh;
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

    // Cells (merge into cache)
    try {
        const fresh = await apiGet('/api/cells');
        if (fresh) {
            let cellsChanged = false;
            for (const key in fresh) {
                if (cellsCache[key] !== fresh[key]) {
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
// Super Structure View
// ========================
function renderSuperStructure() {
    const container = document.getElementById('superStructureContainer');
    container.innerHTML = '';

    const ssItems = getSuperStructureItems();
    const archived = archivedItems['super_structure'] || [];
    const activeItems = ssItems.filter(it => !archived.includes(it.id));
    const blocks = currentVenture ? currentVenture.blocks : [{ id: 'A' }, { id: 'B' }];

    const ssWrapper = document.createElement('div');
    ssWrapper.className = 'ss-wrapper';

    blocks.forEach(block => {
        const section = document.createElement('div');
        section.className = 'ss-section';

        const header = document.createElement('div');
        header.className = 'section-header';
        header.textContent = `${block.id} BLOCK`;
        section.appendChild(header);

        const subHeader = document.createElement('div');
        subHeader.className = 'ss-subheader';
        subHeader.textContent = 'PROGRESS';
        section.appendChild(subHeader);

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

        const statusCols = [
            { key: 'red', label: 'Yet to Start', cls: 'ss-header-red' },
            { key: 'yellow', label: 'In Progress', cls: 'ss-header-yellow' },
            { key: 'blue', label: 'Pending', cls: 'ss-header-blue' },
            { key: 'green', label: 'Completed', cls: 'ss-header-green' }
        ];

        statusCols.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col.label;
            th.className = col.cls;
            headerRow.appendChild(th);
        });

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

            const cellId = ssCellKeyById(block.id, itemObj.id);
            const cellData = cellsCache[cacheKey(cellId)];
            const activeStatus = cellData?.color || cellData?.status || null;

            statusCols.forEach(col => {
                const td = document.createElement('td');
                td.className = 'ss-cell-col';
                const wrapper = document.createElement('div');
                wrapper.className = 'cell-wrapper';

                const btn = document.createElement('button');
                const isActive = activeStatus === col.key;
                btn.className = 'ss-cell ' + (isActive ? 'ss-cell-active ' + col.key : 'ss-cell-inactive');
                btn.title = `${itemObj.label} — ${col.label}`;
                if (editMode) btn.disabled = true;

                const history = document.createElement('button');
                history.className = 'history-link';
                history.textContent = 'history';
                history.style.fontSize = '0.6rem';

                wrapper.appendChild(btn);
                wrapper.appendChild(history);
                td.appendChild(wrapper);
                row.appendChild(td);

                if (!editMode) {
                    btn.addEventListener('click', async () => {
                        if (isActive) return;
                        await updateSuperStructureStatus(block.id, itemObj.id, col.key, itemObj.label);
                    });
                }

                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    openTimelineModal(cellId, itemObj.label, `${block.id} Block`);
                });

                history.addEventListener('click', () => {
                    openTimelineModal(cellId, itemObj.label, `${block.id} Block`);
                });
            });

            tbody.appendChild(row);
        });

        // Add item row in edit mode
        if (editMode) {
            const addRow = document.createElement('tr');
            const addTd = document.createElement('td');
            addTd.colSpan = 6;
            addTd.innerHTML = '<div class="add-item-row"><input type="text" id="addSuperItemInput" placeholder="New super structure item"><button class="btn-secondary" id="addSuperItemBtn">Add</button></div>';
            addRow.appendChild(addTd);
            tbody.appendChild(addRow);
            document.getElementById('addSuperItemBtn').addEventListener('click', () => {
                const val = document.getElementById('addSuperItemInput').value.trim();
                if (val) addSuperItem(val);
            });
        }

        // Archived section in edit mode
        if (editMode && archived.length > 0) {
            const archRow = document.createElement('tr');
            const archTd = document.createElement('td');
            archTd.colSpan = 6;
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
    });

    container.appendChild(ssWrapper);
}

async function updateSuperStructureStatus(block, itemId, status, workItem) {
    const cellId = ssCellKeyById(block, itemId);
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const statusLabel = COLOR_LABELS[status];

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

    const ck = cacheKey(cellId);
    const existing = cellsCache[ck] || null;
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
    renderVentureDashboard();
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
    await saveVenturesToLS();
}

function renderVentureDashboard() {
    document.getElementById('venturesDashboard').style.display = '';
    document.getElementById('trackerView').style.display = 'none';
    document.getElementById('breadcrumbBar').style.display = 'none';

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

        card.addEventListener('click', () => openVenture(venture));
        grid.appendChild(card);
    });

    const addCard = document.createElement('div');
    addCard.className = 'venture-card add-venture-card';
    addCard.innerHTML = '<span class="plus-icon">+</span><span>Add Venture</span>';
    addCard.addEventListener('click', () => openWizard());
    grid.appendChild(addCard);
}

async function openVenture(venture) {
    currentVenture = venture;
    currentBlockObj = venture.blocks[0];
    currentBlock = currentBlockObj.id;
    currentFloor = 1;
    currentView = 'flat';
    editMode = false;
    cellsCache = {};
    archivedItems = venture.archived || {};

    workItems = venture.flat_view_items ? [...venture.flat_view_items] : [...DEFAULT_WORK_ITEMS];

    document.getElementById('venturesDashboard').style.display = 'none';
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
    document.querySelector('.view-tab[data-view="flat"]').classList.add('active');

    document.getElementById('flatViewContainer').style.display = '';
    document.getElementById('workViewContainer').style.display = 'none';
    document.getElementById('superStructureContainer').style.display = 'none';
    document.getElementById('pendingViewContainer').style.display = 'none';

    renderBlockTabs();
    renderFloorTabs();
    await renderGrid();
}

function exitToDashboard() {
    currentVenture = null;
    currentBlockObj = null;
    currentBlock = 'A';
    currentFloor = 1;
    editMode = false;
    cellsCache = {};
    document.getElementById('editModeBtn').style.display = 'none';
    document.getElementById('editModeBanner').style.display = 'none';
    document.body.classList.remove('edit-mode-active');
    renderVentureDashboard();
}

document.getElementById('backToVentures').addEventListener('click', exitToDashboard);

document.getElementById('pendingWorkBtn').addEventListener('click', () => {
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    currentView = 'pending';
    cellsCache = {};
    document.getElementById('flatViewContainer').style.display = 'none';
    document.getElementById('workViewContainer').style.display = 'none';
    document.getElementById('superStructureContainer').style.display = 'none';
    document.getElementById('pendingViewContainer').style.display = '';
    renderPendingView();
});

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
    await saveVenturesToLS();
    showToast('Venture created successfully');
    closeWizard();
    await loadVentures();
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
    cellsCache = {};
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
        await saveVenturesToLS();
    }
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
    const existing = (await apiGet('/api/settings/' + encodeURIComponent(key))) || { entries: [] };
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
    cellsCache = {};
    renderGrid();
}

async function addFlatItem(label) {
    const items = ensureItemIds(currentVenture.flat_view_items || workItems);
    const newId = `item_${slugId(label)}_${Date.now()}`;
    items.push({ id: newId, label });
    currentVenture.flat_view_items = items;
    await logEdit('add', 'flat_view', newId, null, label);
    await saveVentureConfig();
    cellsCache = {};
    renderGrid();
}

async function archiveFlatItem(itemId) {
    if (!archivedItems['flat_view']) archivedItems['flat_view'] = [];
    archivedItems['flat_view'].push(itemId);
    currentVenture.archived = archivedItems;
    await logEdit('delete', 'flat_view', itemId, null, null);
    await saveVentureConfig();
    cellsCache = {};
    renderGrid();
}

async function restoreFlatItem(itemId) {
    archivedItems['flat_view'] = (archivedItems['flat_view'] || []).filter(id => id !== itemId);
    currentVenture.archived = archivedItems;
    await logEdit('restore', 'flat_view', itemId, null, null);
    await saveVentureConfig();
    cellsCache = {};
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
    cellsCache = {};
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
    cellsCache = {};
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
    cellsCache = {};
    renderWorkView();
}

async function addWorkItem(category, label) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    const newId = `item_${slugId(category)}_${slugId(label)}_${Date.now()}`;
    cats[category].push({ id: newId, label });
    currentVenture.work_categories = cats;
    await logEdit('add', 'work_item', newId, null, label);
    await saveVentureConfig();
    cellsCache = {};
    renderWorkView();
}

async function deleteWorkItem(category, itemId) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    cats[category] = cats[category].filter(i => i.id !== itemId);
    currentVenture.work_categories = cats;
    await logEdit('delete', 'work_item', itemId, null, null);
    await saveVentureConfig();
    cellsCache = {};
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
    cellsCache = {};
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
    cellsCache = {};
    renderSuperStructure();
}

async function addSuperItem(label) {
    const items = ensureItemIds(currentVenture.super_structure_items || SUPER_STRUCTURE_ITEMS);
    const newId = `ss_item_${slugId(label)}_${Date.now()}`;
    items.push({ id: newId, label });
    currentVenture.super_structure_items = items;
    await logEdit('add', 'super_structure', newId, null, label);
    await saveVentureConfig();
    cellsCache = {};
    renderSuperStructure();
}

async function archiveSuperItem(itemId) {
    if (!archivedItems['super_structure']) archivedItems['super_structure'] = [];
    archivedItems['super_structure'].push(itemId);
    currentVenture.archived = archivedItems;
    await logEdit('delete', 'super_structure', itemId, null, null);
    await saveVentureConfig();
    cellsCache = {};
    renderSuperStructure();
}

async function restoreSuperItem(itemId) {
    archivedItems['super_structure'] = (archivedItems['super_structure'] || []).filter(id => id !== itemId);
    currentVenture.archived = archivedItems;
    await logEdit('restore', 'super_structure', itemId, null, null);
    await saveVentureConfig();
    cellsCache = {};
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
    cellsCache = {};
    renderSuperStructure();
}

// Venture Dashboard Editing
async function renameVenture(ventureId, newName) {
    const venture = venturesList.find(v => v.id === ventureId);
    if (!venture) return;
    venture.name = newName;
    await saveVenturesToLS();
    showToast('Venture renamed');
    renderVentureDashboard();
}

async function deleteVenture(ventureId) {
    const venture = venturesList.find(v => v.id === ventureId);
    if (!venture) return;
    await apiDelete('/api/venture/' + encodeURIComponent(ventureId));
    venturesList = venturesList.filter(v => v.id !== ventureId);
    await saveVenturesToLS();
    showToast('Venture deleted');
    renderVentureDashboard();
}

// ========================
// Pending Work View
// ========================
async function renderPendingView() {
    const container = document.getElementById('pendingViewContainer');
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
    const promises = [];

    floorsToCheck.forEach(floor => {
        const flatNumbers = [];
        for (let i = 1; i <= flatsPerFloor; i++) {
            flatNumbers.push((floor * 100) + i);
        }
        flatNumbers.forEach(flat => {
            flatWorkItems.forEach(item => {
                const cellId = cellKeyById(currentBlock, floor, flat, item.id);
                promises.push(getCellData(cellId));
            });
            Object.entries(workCategories).forEach(([category, items]) => {
                items.forEach(itemObj => {
                    const cellId = workViewCellKeyById(currentBlock, floor, category, itemObj.id, flat);
                    promises.push(getCellData(cellId));
                });
            });
        });
    });
    await Promise.all(promises);

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
    document.getElementById('breadcrumbBar').style.display = 'none';
    populateInvoiceFilterVentures();
    populateInvoiceFilterCategories();
    renderInvoiceCards();
}

function closeInvoicesPanel() {
    document.getElementById('invoicesPanel').style.display = 'none';
    document.getElementById('venturesDashboard').style.display = '';
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
    ['invoicesPanel', 'attendancePanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    document.getElementById('poPanel').style.display = '';
    document.getElementById('breadcrumbBar').style.display = 'none';
    populatePOFilters();
    renderPOCards();
}

function closePOPanel() {
    document.getElementById('poPanel').style.display = 'none';
    document.getElementById('venturesDashboard').style.display = '';
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
