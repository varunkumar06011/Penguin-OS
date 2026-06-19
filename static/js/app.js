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

function cacheKey(cellId) {
    return currentVenture ? `${currentVenture.id}_${cellId}` : cellId;
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
    if (currentVenture) {
        return db.collection('ventures').doc(currentVenture.id).collection('cells').doc(cellId);
    }
    return getProjectRef().collection('cells').doc(cellId);
}

function getSuperstructureRef(cellId) {
    if (!db) return null;
    if (currentVenture) {
        return db.collection('ventures').doc(currentVenture.id).collection('superstructure').doc(cellId);
    }
    return getProjectRef().collection('superstructure').doc(cellId);
}

function getSettingsRef() {
    if (!db) return null;
    return getProjectRef().collection('settings').doc('workItems');
}

function getVentureRef(ventureId) {
    if (!db) return null;
    return db.collection('ventures').doc(ventureId);
}

async function loadWorkItems() {
    if (currentVenture && currentVenture.flat_view_items) {
        workItems = [...currentVenture.flat_view_items];
        return;
    }
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
    if (currentVenture) {
        currentVenture.flat_view_items = items;
        if (!db) {
            showToast('Firebase not configured. Changes saved locally only.', true);
            return;
        }
        try {
            await getVentureRef(currentVenture.id).update({ flat_view_items: items });
            showToast('Work items saved successfully');
        } catch (e) {
            console.error('Error saving work items:', e);
            showToast('Failed to save work items', true);
        }
        return;
    }
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
    const cacheKey = currentVenture ? `${currentVenture.id}_${cellId}` : cellId;
    if (cellsCache[cacheKey] !== undefined) return cellsCache[cacheKey];
    try {
        const doc = await getCellRef(cellId).get();
        const data = doc.exists ? doc.data() : null;
        cellsCache[cacheKey] = data;
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
        const cacheKey = currentVenture ? `${currentVenture.id}_${cellId}` : cellId;
        cellsCache[cacheKey] = null;
        await getCellData(cellId);
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
        const cacheKey = currentVenture ? `${currentVenture.id}_${cellId}` : cellId;
        cellsCache[cacheKey] = null;
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
    const flatsPerFloor = currentBlockObj ? (currentBlockObj.flats_per_floor || FLATS_PER_FLOOR) : FLATS_PER_FLOOR;
    const flatNumbers = [];
    for (let i = 1; i <= flatsPerFloor; i++) {
        flatNumbers.push((currentFloor * 100) + i);
    }

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

        const workTd = document.createElement('td');
        workTd.className = 'work-cell';
        workTd.textContent = workItem;
        row.appendChild(workTd);

        for (const flat of flatNumbers) {
            const cellId = getCellId(currentBlock, currentFloor, flat, wi);
            const cellData = cellsCache[cacheKey(cellId)];
            const color = cellData?.color || null;

            const td = document.createElement('td');
            const wrapper = document.createElement('div');
            wrapper.className = 'cell-wrapper';

            const btn = document.createElement('button');
            btn.className = 'cell-btn ' + (color || 'empty');
            btn.title = `${flat} - ${workItem}`;

            const history = document.createElement('button');
            history.className = 'history-link';
            history.textContent = 'history';

            wrapper.appendChild(btn);
            wrapper.appendChild(history);
            td.appendChild(wrapper);
            row.appendChild(td);

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                openStatusPopup(cellId, workItem, flat, color);
            });

            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                openTimelineModal(cellId, workItem, flat);
            });

            history.addEventListener('click', () => {
                openTimelineModal(cellId, workItem, flat);
            });
        }

        const remarksTd = document.createElement('td');
        remarksTd.className = 'remarks-cell';
        const remarksParts = [];
        for (const flat of flatNumbers) {
            const cellId = getCellId(currentBlock, currentFloor, flat, wi);
            const cellData = cellsCache[cacheKey(cellId)];
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

    const flatsPerFloor = currentBlockObj ? (currentBlockObj.flats_per_floor || FLATS_PER_FLOOR) : FLATS_PER_FLOOR;
    const flatNumbers = [];
    for (let i = 1; i <= flatsPerFloor; i++) {
        flatNumbers.push((currentFloor * 100) + i);
    }

    const workCategories = (currentVenture && currentVenture.work_categories) ? currentVenture.work_categories : WORK_CATEGORIES;

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

    Object.entries(workCategories).forEach(([cat, items]) => {
        queueLoads(cat, items, flatNumbers);
    });
    queueLoads('CORRIDORS', CORRIDORS, ['P-004']);
    queueLoads('ELEVATION WORK', ELEVATION_WORK, ['P-004']);
    await Promise.all(promises);

    // Render 5 main category sections
    Object.entries(workCategories).forEach(([category, items]) => {
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
            const cellData = cellsCache[cacheKey(cellId)];
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
    if (!db) {
        showToast('Firebase not configured. Showing local demo data.', true);
    }
    await loadVentures();
}

init();

// ========================
// Super Structure View
// ========================
async function renderSuperStructure() {
    const container = document.getElementById('superStructureContainer');
    container.innerHTML = '';

    const ssItems = (currentVenture && currentVenture.super_structure_items) ? currentVenture.super_structure_items : SUPER_STRUCTURE_ITEMS;
    const blocks = currentVenture ? currentVenture.blocks : [{ id: 'A' }, { id: 'B' }];

    // Preload all cell data
    const promises = [];
    blocks.forEach(block => {
        ssItems.forEach((_, wi) => {
            const cellId = `superstructure_${block.id}_${wi}`;
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

        ssItems.forEach((item, wi) => {
            const row = document.createElement('tr');

            const tdSNo = document.createElement('td');
            tdSNo.textContent = wi + 1;
            row.appendChild(tdSNo);

            const tdWork = document.createElement('td');
            tdWork.className = 'work-cell';
            tdWork.textContent = item;
            row.appendChild(tdWork);

            const cellId = `superstructure_${block.id}_${wi}`;
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
                btn.title = `${item} — ${col.label}`;

                const history = document.createElement('button');
                history.className = 'history-link';
                history.textContent = 'history';
                history.style.fontSize = '0.6rem';

                wrapper.appendChild(btn);
                wrapper.appendChild(history);
                td.appendChild(wrapper);
                row.appendChild(td);

                btn.addEventListener('click', async () => {
                    if (isActive) return;
                    await updateSuperStructureStatus(block.id, wi, col.key, item);
                });

                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    openTimelineModal(cellId, item, `${block.id} Block`);
                });

                history.addEventListener('click', () => {
                    openTimelineModal(cellId, item, `${block.id} Block`);
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
    const cellRef = getSuperstructureRef(cellId);
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
        cellsCache[cacheKey(cellId)] = null;
        await getCellData(cellId);
        renderSuperStructure();
        showToast('Status updated');
    } catch (e) {
        console.error('Error updating superstructure cell:', e);
        showToast('Failed to update status', true);
    }
}

// ========================
// Venture Management
// ========================
async function loadVentures() {
    if (!db) {
        // Local demo: create in-memory ventures
        venturesList = createDefaultVentures();
        renderVentureDashboard();
        return;
    }
    try {
        const snapshot = await db.collection('ventures').get();
        venturesList = [];
        snapshot.forEach(doc => {
            venturesList.push({ id: doc.id, ...doc.data() });
        });
        if (venturesList.length === 0) {
            await seedDefaultVentures();
            const snap2 = await db.collection('ventures').get();
            venturesList = [];
            snap2.forEach(doc => {
                venturesList.push({ id: doc.id, ...doc.data() });
            });
        }
        renderVentureDashboard();
    } catch (e) {
        console.error('Error loading ventures:', e);
        venturesList = createDefaultVentures();
        renderVentureDashboard();
    }
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
            super_structure_items: [...SUPER_STRUCTURE_ITEMS]
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
            super_structure_items: [...SUPER_STRUCTURE_ITEMS]
        }
    ];
}

async function seedDefaultVentures() {
    if (!db) return;
    const ventures = createDefaultVentures();
    const batch = db.batch();
    ventures.forEach(v => {
        const ref = db.collection('ventures').doc(v.id);
        batch.set(ref, {
            name: v.name,
            created_by: currentUser,
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            blocks: v.blocks,
            flat_view_items: v.flat_view_items,
            work_categories: v.work_categories,
            super_structure_items: v.super_structure_items
        });
    });
    await batch.commit();
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

        const title = document.createElement('h3');
        title.textContent = venture.name;
        card.appendChild(title);

        const blocksList = document.createElement('div');
        blocksList.className = 'blocks-list';
        const blockNames = venture.blocks.map(b => b.name || b.id).join(', ');
        blocksList.textContent = blockNames;
        card.appendChild(blocksList);

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
    cellsCache = {};

    workItems = venture.flat_view_items ? [...venture.flat_view_items] : [...DEFAULT_WORK_ITEMS];

    document.getElementById('venturesDashboard').style.display = 'none';
    document.getElementById('trackerView').style.display = '';
    document.getElementById('breadcrumbBar').style.display = 'flex';
    document.getElementById('bcVenture').textContent = venture.name;

    document.getElementById('ventureTitle').textContent = venture.name.toUpperCase();

    // Reset view tabs
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    document.querySelector('.view-tab[data-view="flat"]').classList.add('active');

    document.getElementById('flatViewContainer').style.display = '';
    document.getElementById('workViewContainer').style.display = 'none';
    document.getElementById('superStructureContainer').style.display = 'none';

    renderBlockTabs();
    renderFloorTabs();
    await renderGrid();
}

document.getElementById('backToVentures').addEventListener('click', () => {
    currentVenture = null;
    currentBlockObj = null;
    currentBlock = 'A';
    currentFloor = 1;
    cellsCache = {};
    renderVentureDashboard();
});

document.getElementById('bcHome').addEventListener('click', () => {
    currentVenture = null;
    currentBlockObj = null;
    currentBlock = 'A';
    currentFloor = 1;
    cellsCache = {};
    renderVentureDashboard();
});

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
    if (!db) {
        showToast('Firebase not configured. Cannot create venture.', true);
        closeWizard();
        return;
    }
    try {
        const ventureRef = db.collection('ventures').doc();
        await ventureRef.set({
            name: wizardData.name,
            created_by: currentUser,
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            blocks: wizardData.blocks,
            flat_view_items: [...DEFAULT_WORK_ITEMS],
            work_categories: wizardData.workCategories,
            super_structure_items: wizardData.superItems
        });
        showToast('Venture created successfully');
        closeWizard();
        await loadVentures();
    } catch (e) {
        console.error('Error creating venture:', e);
        showToast('Failed to create venture', true);
    }
}
