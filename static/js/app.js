// ========================
// Firebase Config (USER MUST FILL THIS)
// ========================
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase if config is provided
let db = null;
let firebaseInitialized = false;
try {
    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        firebaseInitialized = true;
    }
} catch (e) {
    console.warn('Firebase not initialized:', e);
}

// ========================
// App State
// ========================
let currentUser = null;
let currentBlock = 'A';
let currentFloor = 1;
let workItems = [];
let cellsCache = {};
let selectedCellId = null;
let selectedWorkItem = null;
let selectedFlat = null;

const DEFAULT_WORK_ITEMS = [
    "Brick work", "Plastering", "Electrical pipe", "Pop bolster",
    "Bathroom plumbing", "Baby sink lines", "Tiles", "Pop primer",
    "Window fitting", "Window grills", "Door frames", "Door shutters",
    "Grills", "Main door", "Flooring", "Wall care", "Primer", "Putty",
    "Paint", "Dado tiles", "Final coat"
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
// Firestore Helpers
// ========================
function getProjectRef() {
    if (!db) return null;
    return db.collection('projects').doc('vgrand-infra');
}

function getCellRef(cellId) {
    if (!db) return null;
    return getProjectRef().collection('cells').doc(cellId);
}

function getSettingsRef() {
    if (!db) return null;
    return getProjectRef().collection('settings').doc('workItems');
}

async function loadWorkItems() {
    if (!db) {
        workItems = [...DEFAULT_WORK_ITEMS];
        return;
    }
    try {
        const doc = await getSettingsRef().get();
        if (doc.exists) {
            const data = doc.data();
            workItems = data.items || [...DEFAULT_WORK_ITEMS];
        } else {
            workItems = [...DEFAULT_WORK_ITEMS];
            await getSettingsRef().set({ items: workItems });
        }
    } catch (e) {
        console.error('Error loading work items:', e);
        workItems = [...DEFAULT_WORK_ITEMS];
    }
}

async function saveWorkItems(items) {
    if (!db) {
        showToast('Firebase not configured. Changes saved locally only.', true);
        return;
    }
    try {
        await getSettingsRef().set({ items: items });
        showToast('Work items saved successfully');
    } catch (e) {
        console.error('Error saving work items:', e);
        showToast('Failed to save work items', true);
    }
}

async function getCellData(cellId) {
    if (!db) return null;
    if (cellsCache[cellId] !== undefined) return cellsCache[cellId];
    try {
        const doc = await getCellRef(cellId).get();
        const data = doc.exists ? doc.data() : null;
        cellsCache[cellId] = data;
        return data;
    } catch (e) {
        console.error('Error loading cell:', e);
        return null;
    }
}

async function updateCellColor(cellId, color, workItem, flat) {
    if (!db) {
        showToast('Firebase not configured. Changes not saved.', true);
        return;
    }
    const cellRef = getCellRef(cellId);
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

    try {
        const doc = await cellRef.get();
        if (doc.exists) {
            const existing = doc.data();
            const timeline = existing.timeline || [];
            timeline.push(timelineEntry);
            let remarks = existing.remarks || '';
            if (autoRemark) {
                remarks = remarks ? remarks + '\n' + autoRemark : autoRemark;
            }
            await cellRef.update({
                color: color || null,
                remarks: remarks,
                timeline: timeline,
                updated_at: firebase.firestore.FieldValue.serverTimestamp(),
                updated_by: currentUser
            });
        } else {
            await cellRef.set({
                color: color || null,
                remarks: autoRemark,
                timeline: [timelineEntry],
                updated_at: firebase.firestore.FieldValue.serverTimestamp(),
                updated_by: currentUser
            });
        }
        cellsCache[cellId] = null; // invalidate cache
        await getCellData(cellId); // refresh
        renderGrid();
        showToast('Status updated');
    } catch (e) {
        console.error('Error updating cell:', e);
        showToast('Failed to update status', true);
    }
}

async function saveCellRemarks(cellId, remarks) {
    if (!db) {
        showToast('Firebase not configured. Changes not saved.', true);
        return;
    }
    try {
        await getCellRef(cellId).update({
            remarks: remarks,
            updated_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_by: currentUser
        });
        cellsCache[cellId] = null;
        await getCellData(cellId);
        renderGrid();
        showToast('Remarks saved');
    } catch (e) {
        console.error('Error saving remarks:', e);
        showToast('Failed to save remarks', true);
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
    const flatNumbers = [];
    for (let i = 1; i <= FLATS_PER_FLOOR; i++) {
        flatNumbers.push((currentFloor * 100) + i);
    }

    // Preload all cell data
    const promises = [];
    for (let wi = 0; wi < workItems.length; wi++) {
        for (const flat of flatNumbers) {
            const cellId = getCellId(currentBlock, currentFloor, flat, wi);
            promises.push(getCellData(cellId));
        }
    }
    await Promise.all(promises);

    for (let wi = 0; wi < workItems.length; wi++) {
        const workItem = workItems[wi];
        const row = document.createElement('tr');

        // Work item name
        const workTd = document.createElement('td');
        workTd.className = 'work-cell';
        workTd.textContent = workItem;
        row.appendChild(workTd);

        // Flat cells
        for (const flat of flatNumbers) {
            const cellId = getCellId(currentBlock, currentFloor, flat, wi);
            const cellData = cellsCache[cellId];
            const color = cellData?.color || null;

            const td = document.createElement('td');
            const wrapper = document.createElement('div');
            wrapper.className = 'cell-wrapper';

            const btn = document.createElement('button');
            btn.className = 'cell-btn ' + (color || 'empty');
            btn.dataset.cellId = cellId;
            btn.dataset.workItem = workItem;
            btn.dataset.flat = flat;
            btn.title = `${flat} - ${workItem}`;

            const history = document.createElement('button');
            history.className = 'history-link';
            history.textContent = 'history';
            history.dataset.cellId = cellId;
            history.dataset.workItem = workItem;
            history.dataset.flat = flat;

            wrapper.appendChild(btn);
            wrapper.appendChild(history);
            td.appendChild(wrapper);
            row.appendChild(td);

            // Left click: status picker
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                openStatusPopup(cellId, workItem, flat, color);
            });

            // Right click: timeline
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                openTimelineModal(cellId, workItem, flat);
            });

            // History link: timeline
            history.addEventListener('click', () => {
                openTimelineModal(cellId, workItem, flat);
            });
        }

        // Remarks summary for this work row
        const remarksTd = document.createElement('td');
        remarksTd.className = 'remarks-cell';
        const remarksParts = [];
        for (const flat of flatNumbers) {
            const cellId = getCellId(currentBlock, currentFloor, flat, wi);
            const cellData = cellsCache[cellId];
            if (cellData?.remarks) {
                remarksParts.push(`${flat}: ${cellData.remarks}`);
            }
        }
        remarksTd.textContent = remarksParts.join(' | ');
        remarksTd.title = remarksTd.textContent;
        row.appendChild(remarksTd);

        els.gridBody.appendChild(row);
    }
}

async function renderWorkView() {
    const container = document.getElementById('workViewContainer');
    container.innerHTML = '';

    const flatNumbers = [];
    for (let i = 1; i <= FLATS_PER_FLOOR; i++) {
        flatNumbers.push((currentFloor * 100) + i);
    }

    // Preload all cell data
    const promises = [];

    function queueLoads(category, items, flats) {
        items.forEach((item, wi) => {
            flats.forEach(flat => {
                const cellId = getWorkViewCellId(currentBlock, currentFloor, category, wi, flat);
                promises.push(getCellData(cellId));
            });
        });
    }

    Object.entries(WORK_CATEGORIES).forEach(([cat, items]) => {
        queueLoads(cat, items, flatNumbers);
    });
    queueLoads('CORRIDORS', CORRIDORS, ['P-004']);
    queueLoads('ELEVATION WORK', ELEVATION_WORK, ['P-004']);
    await Promise.all(promises);

    // Render 5 main category sections
    Object.entries(WORK_CATEGORIES).forEach(([category, items]) => {
        container.appendChild(createSectionTable(category, items, flatNumbers));
    });

    // Corridors
    container.appendChild(createSectionTable('CORRIDORS', CORRIDORS, ['P-004']));

    // Elevation Work
    container.appendChild(createSectionTable('ELEVATION WORK', ELEVATION_WORK, ['P-004']));
}

function createSectionTable(category, items, flats) {
    const section = document.createElement('div');
    section.className = 'work-view-section';

    const header = document.createElement('div');
    header.className = 'section-header';
    header.textContent = category;
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

    items.forEach((item, wi) => {
        const row = document.createElement('tr');

        const tdSNo = document.createElement('td');
        tdSNo.textContent = wi + 1;
        row.appendChild(tdSNo);

        const tdWork = document.createElement('td');
        tdWork.className = 'work-cell';
        tdWork.textContent = item;
        row.appendChild(tdWork);

        flats.forEach(flat => {
            const cellId = getWorkViewCellId(currentBlock, currentFloor, category, wi, flat);
            const cellData = cellsCache[cellId];
            const color = cellData?.color || null;

            const td = document.createElement('td');
            const wrapper = document.createElement('div');
            wrapper.className = 'cell-wrapper';

            const btn = document.createElement('button');
            btn.className = 'cell-btn ' + (color || 'empty');
            btn.title = `${flat} - ${item}`;

            const history = document.createElement('button');
            history.className = 'history-link';
            history.textContent = 'history';

            wrapper.appendChild(btn);
            wrapper.appendChild(history);
            td.appendChild(wrapper);
            row.appendChild(td);

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                openStatusPopup(cellId, item, flat, color);
            });

            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                openTimelineModal(cellId, item, flat);
            });

            history.addEventListener('click', () => {
                openTimelineModal(cellId, item, flat);
            });
        });

        // Remarks summary
        const remarksTd = document.createElement('td');
        remarksTd.className = 'remarks-cell';
        const remarksParts = [];
        flats.forEach(flat => {
            const cellId = getWorkViewCellId(currentBlock, currentFloor, category, wi, flat);
            const cellData = cellsCache[cellId];
            if (cellData?.remarks) {
                remarksParts.push(`${flat}: ${cellData.remarks}`);
            }
        });
        remarksTd.textContent = remarksParts.join(' | ');
        remarksTd.title = remarksTd.textContent;
        row.appendChild(remarksTd);

        tbody.appendChild(row);
    });

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
        const color = btn.dataset.color;
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

els.saveSettingsBtn.addEventListener('click', async () => {
    // Sync from DOM in case edits were made
    const newItems = [];
    els.workItemsList.querySelectorAll('li').forEach(row => {
        const nameSpan = row.querySelector('.work-item-name');
        newItems.push(nameSpan.textContent.trim());
    });
    workItems = newItems.filter(w => w.length > 0);
    await saveWorkItems(workItems);
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
// Navigation
// ========================
document.querySelectorAll('.block-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.block-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentBlock = btn.dataset.block;
        cellsCache = {};
        if (currentView === 'flat') {
            renderGrid();
        } else {
            renderWorkView();
        }
    });
});

document.querySelectorAll('.floor-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.floor-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFloor = parseInt(btn.dataset.floor);
        cellsCache = {};
        if (currentView === 'flat') {
            renderGrid();
        } else {
            renderWorkView();
        }
    });
});

// View toggle
document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentView = btn.dataset.view;
        cellsCache = {};
        document.getElementById('flatViewContainer').style.display = 'none';
        document.getElementById('workViewContainer').style.display = 'none';
        document.getElementById('superStructureContainer').style.display = 'none';
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
    await loadWorkItems();
    currentView = 'flat';
    await renderGrid();
}

init();

// ========================
// Super Structure View
// ========================
async function renderSuperStructure() {
    const container = document.getElementById('superStructureContainer');
    container.innerHTML = '';

    const blocks = ['A', 'B'];

    // Preload all cell data
    const promises = [];
    blocks.forEach(block => {
        SUPER_STRUCTURE_ITEMS.forEach((_, wi) => {
            const cellId = `superstructure_${block}_${wi}`;
            promises.push(getCellData(cellId));
        });
    });
    await Promise.all(promises);

    const ssWrapper = document.createElement('div');
    ssWrapper.className = 'ss-wrapper';

    blocks.forEach(block => {
        const section = document.createElement('div');
        section.className = 'ss-section';

        const header = document.createElement('div');
        header.className = 'section-header';
        header.textContent = `${block} BLOCK`;
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

        SUPER_STRUCTURE_ITEMS.forEach((item, wi) => {
            const row = document.createElement('tr');

            const tdSNo = document.createElement('td');
            tdSNo.textContent = wi + 1;
            row.appendChild(tdSNo);

            const tdWork = document.createElement('td');
            tdWork.className = 'work-cell';
            tdWork.textContent = item;
            row.appendChild(tdWork);

            const cellId = `superstructure_${block}_${wi}`;
            const cellData = cellsCache[cellId];
            const activeStatus = cellData?.color || cellData?.status || null;

            statusCols.forEach(col => {
                const td = document.createElement('td');
                td.className = 'ss-cell-col';
                const wrapper = document.createElement('div');
                wrapper.className = 'cell-wrapper';

                const btn = document.createElement('button');
                const isActive = activeStatus === col.key;
                btn.className = 'ss-cell ' + (isActive ? 'ss-cell-active ' + col.key : 'ss-cell-inactive');
                btn.title = `${item} — ${col.label}`;

                const history = document.createElement('button');
                history.className = 'history-link';
                history.textContent = 'history';
                history.style.fontSize = '0.6rem';

                wrapper.appendChild(btn);
                wrapper.appendChild(history);
                td.appendChild(wrapper);
                row.appendChild(td);

                // Single click sets this status directly
                btn.addEventListener('click', async () => {
                    if (isActive) return; // no-op if already active
                    await updateSuperStructureStatus(block, wi, col.key, item);
                });

                // Right-click timeline
                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    openTimelineModal(cellId, item, `${block} Block`);
                });

                history.addEventListener('click', () => {
                    openTimelineModal(cellId, item, `${block} Block`);
                });
            });

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        tableWrapper.appendChild(table);
        section.appendChild(tableWrapper);
        ssWrapper.appendChild(section);
    });

    container.appendChild(ssWrapper);
}

async function updateSuperStructureStatus(block, workIndex, status, workItem) {
    if (!db) {
        showToast('Firebase not configured. Changes not saved.', true);
        return;
    }
    const cellId = `superstructure_${block}_${workIndex}`;
    const cellRef = getCellRef(cellId);
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

    try {
        const doc = await cellRef.get();
        if (doc.exists) {
            const existing = doc.data();
            const timeline = existing.timeline || [];
            timeline.push(timelineEntry);
            let remarks = existing.remarks || '';
            if (autoRemark) {
                remarks = remarks ? remarks + '\n' + autoRemark : autoRemark;
            }
            await cellRef.update({
                color: status,
                remarks: remarks,
                timeline: timeline,
                updated_at: firebase.firestore.FieldValue.serverTimestamp(),
                updated_by: currentUser
            });
        } else {
            await cellRef.set({
                color: status,
                remarks: autoRemark,
                timeline: [timelineEntry],
                updated_at: firebase.firestore.FieldValue.serverTimestamp(),
                updated_by: currentUser
            });
        }
        cellsCache[cellId] = null;
        await getCellData(cellId);
        renderSuperStructure();
        showToast('Status updated');
    } catch (e) {
        console.error('Error updating superstructure cell:', e);
        showToast('Failed to update status', true);
    }
}
