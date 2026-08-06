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
        if (data && Object.keys(data).length > 0) {
            cellsCache[ck] = data;
            return data;
        }
        cellsCache[ck] = CELL_NOT_FOUND;
        return CELL_NOT_FOUND;
    } catch (err) {
        console.error('Failed to load cell', ck, err);
        return CELL_NOT_FOUND;
    }
}

async function getSsCellData(cellId) {
    const ck = cacheKey(cellId);
    if (cellsCache[ck] !== undefined) return cellsCache[ck];
    try {
        const data = await apiGet('/api/cell/' + encodeURIComponent(ck));
        if (data && Object.keys(data).length > 0) {
            cellsCache[ck] = data;
            return data;
        }
        cellsCache[ck] = CELL_NOT_FOUND;
        return CELL_NOT_FOUND;
    } catch (err) {
        console.error('Failed to load ss cell', ck, err);
        return CELL_NOT_FOUND;
    }
}

let _allCellsBulkLoaded = false;

async function ensureCellsInCache(requiredKeys) {
    const missing = requiredKeys.filter(k => cellsCache[k] === undefined);
    if (missing.length === 0) return;
    try {
        // Fetch all cells for venture+block (no floor filter) to cache every floor at once.
        // This makes floor switching instant on subsequent visits.
        const params = new URLSearchParams();
        if (currentVenture && currentVenture.id) params.set('venture_id', currentVenture.id);
        if (currentBlock) params.set('block', currentBlock);
        const qs = params.toString();
        const allCells = await apiGet(`/api/cells${qs ? '?' + qs : ''}`);
        if (allCells) {
            Object.assign(cellsCache, allCells);
        }
        // Any still-missing keys simply don't exist in DB — mark as not found.
        // (Previous code fetched each missing key individually, causing 100+ sequential
        //  API calls and multi-minute load times.)
        const stillMissing = requiredKeys.filter(k => cellsCache[k] === undefined);
        stillMissing.forEach(ck => { cellsCache[ck] = CELL_NOT_FOUND; });
    } catch (e) {
        console.error('Failed to bulk load cells:', e);
    }
}

/* ============================================================
   Add Work Description — Compact FAB + Dialog
   ============================================================ */
let _workAddCategory = null;

function ensureWorkAddDialog() {
    if (document.getElementById('workAddDialogOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'workAddDialogOverlay';
    overlay.innerHTML = `
        <div id="workAddDialog" role="dialog" aria-modal="true" aria-labelledby="workAddDialogTitle">
            <h3 class="work-add-title" id="workAddDialogTitle">Add Work Description</h3>
            <form class="work-add-form" id="workAddForm" onsubmit="return false;">
                <label>
                    Work Description Name
                    <input type="text" id="workAddInput" placeholder="e.g. Lintel" autocomplete="off">
                </label>
                <label class="work-add-scope">
                    <input type="checkbox" id="workAddScopeAll">
                    Apply to all ventures
                </label>
                <div class="work-add-actions">
                    <button type="button" class="btn-cancel" id="workAddCancel">Cancel</button>
                    <button type="submit" class="btn-add" id="workAddSubmit">Add</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeWorkAddDialog();
    });
    document.getElementById('workAddCancel').addEventListener('click', closeWorkAddDialog);
    document.getElementById('workAddForm').addEventListener('submit', (e) => {
        e.preventDefault();
        submitWorkAddDialog();
    });
    document.getElementById('workAddInput').addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeWorkAddDialog();
    });
}

function openWorkAddDialog(category) {
    ensureWorkAddDialog();
    _workAddCategory = category;
    const input = document.getElementById('workAddInput');
    const scopeAll = document.getElementById('workAddScopeAll');
    if (input) input.value = '';
    if (scopeAll) scopeAll.checked = false;
    document.getElementById('workAddDialogOverlay').classList.add('open');
    if (input) setTimeout(() => input.focus(), 50);
}

function closeWorkAddDialog() {
    const overlay = document.getElementById('workAddDialogOverlay');
    if (overlay) overlay.classList.remove('open');
    _workAddCategory = null;
}

async function submitWorkAddDialog() {
    const input = document.getElementById('workAddInput');
    const scopeAll = document.getElementById('workAddScopeAll');
    if (!input || !_workAddCategory) return;
    const val = input.value.trim();
    if (!val) return;
    closeWorkAddDialog();
    await addWorkItem(_workAddCategory, val, scopeAll && scopeAll.checked);
}

// Deferred paint-mode cell update — optimistic DOM only, no API save until Save button clicked
function bulkPaintCell(cellId, color, workItem, flat) {
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const statusLabel = color ? COLOR_LABELS[color] : 'Cleared';
    let autoRemark = '';
    if (color === 'blue') autoRemark = `Patch work started on ${today}`;
    else if (color === 'green') autoRemark = `Completed on ${today}`;
    else if (color === 'yellow') autoRemark = `Work started on ${today}`;

    const autoRemarkPatterns = [/^Patch work started on .+$/m, /^Completed on .+$/m, /^Work started on .+$/m];
    const timelineEntry = { color: color || null, status_label: statusLabel, date: today, changed_by: currentUser };

    const ck = cacheKey(cellId);
    const existing = (cellsCache[ck] && !cellsCache[ck]?.__notFound) ? cellsCache[ck] : null;

    // Skip if same color as last timeline entry
    if (existing && existing.timeline && existing.timeline.length > 0) {
        const lastEntry = existing.timeline[existing.timeline.length - 1];
        if (lastEntry && lastEntry.color === color) return;
    }

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
    if (currentVenture && currentVenture.id) data.venture_id = currentVenture.id;
    if (currentBlock) data.block = currentBlock;
    if (currentFloor !== null && currentFloor !== undefined) data.floor = String(currentFloor);

    // Store original data for cancel/revert (only first time)
    if (!bulkOriginalData.has(ck)) {
        bulkOriginalData.set(ck, existing || CELL_NOT_FOUND);
    }
    // Track pending change
    bulkPendingChanges.set(ck, { oldData: existing, newData: data });

    // Optimistic DOM update only — no API save
    cellsCache[ck] = data;
    const cellBtn = document.querySelector(`[data-cell-id="${ck}"]`);
    if (cellBtn) cellBtn.className = 'cell-btn ' + (color || 'red');

    // Update count display
    document.getElementById('bulkCount').textContent =
        `${bulkPendingChanges.size} cell${bulkPendingChanges.size !== 1 ? 's' : ''} painted — click Save to commit`;
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
    const existing = (cellsCache[ck] && !cellsCache[ck]?.__notFound) ? cellsCache[ck] : null;
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
    // Ensure venture_id/block/floor are present for filtered queries
    if (currentVenture && currentVenture.id) data.venture_id = currentVenture.id;
    if (currentBlock) data.block = currentBlock;
    if (currentFloor !== null && currentFloor !== undefined) data.floor = String(currentFloor);

    // --- Optimistic instant update: cache + DOM, no full re-render ---
    cellsCache[ck] = data;
    const cellBtn = document.querySelector(`[data-cell-id="${ck}"]`);
    if (cellBtn) {
        cellBtn.className = 'cell-btn ' + (color || 'red');
    }
    showToast('Status updated');

    // --- Background save with debounce (deduplicate rapid taps on same cell) ---
    if (pendingSaves.has(ck)) clearTimeout(pendingSaves.get(ck));
    const timer = setTimeout(async () => {
        pendingSaves.delete(ck);
        inFlightSaves++;
        try {
            const resp = await apiPost('/api/cell/' + encodeURIComponent(ck), data);
            // Reversal prompt: if cell was downgraded from green, offer to reverse material usage
            if (resp && resp.previous_color === 'green' && color && color !== 'green') {
                promptDowngradeReversal(ck, selectedFlat, selectedWorkItem);
            }
        } catch (err) {
            console.error('Failed to save cell:', err);
            showToast('Save failed — please retry', true);
        } finally {
            inFlightSaves--;
        }
    }, 300);
    pendingSaves.set(ck, timer);
}

async function saveCellRemarks(cellId, remarks, images) {
    const ck = cacheKey(cellId);
    const existing = (cellsCache[ck] && !cellsCache[ck]?.__notFound) ? cellsCache[ck] : {};
    const data = {
        ...existing,
        remarks: remarks,
        remarkImages: images || [],
        updated_at: new Date().toISOString(),
        updated_by: currentUser
    };
    // Ensure venture_id/block/floor are present for filtered queries
    if (currentVenture && currentVenture.id) data.venture_id = currentVenture.id;
    if (currentBlock) data.block = currentBlock;
    if (currentFloor !== null && currentFloor !== undefined) data.floor = String(currentFloor);
    try {
        inFlightSaves++;
        await apiPost('/api/cell/' + encodeURIComponent(ck), data);
        cellsCache[ck] = data;
        if (currentView === 'work') await renderWorkView(true);
        else if (currentView === 'super') await renderSuperStructure();
        showToast('Remarks saved');
    } catch (err) {
        console.error('Failed to save remarks:', err);
        showToast('Failed to save \u2014 please retry', true);
    } finally {
        inFlightSaves--;
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
            // Filter out the synthetic '__all__' venture used only for attendance
            venturesList = saved.filter(v => v.id !== '__all__');
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
    workItems = ensureItemIds(currentVenture.flat_view_items ? [...currentVenture.flat_view_items] : [...DEFAULT_WORK_ITEMS]);

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
        if (currentView === 'work') renderWorkView();
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
    // Flat View has been removed — redirect to Work View
    await renderWorkView();
}

function isMobileView() {
    return window.innerWidth <= 768;
}

var mobileSelectedFlat = null;

async function renderWorkView(force) {
    const container = document.getElementById('workViewContainer');

    // Check if we can reuse existing DOM (same venture/block/floor/editMode)
    const renderKey = `${currentVenture?.id}_${currentBlock}_${currentFloor}_${editMode}`;
    if (!force && container._renderKey === renderKey && container._rendered && !editMode) {
        container.style.display = '';
        return; // DOM already built for this context — just show it
    }
    container._renderKey = renderKey;
    container._rendered = true;

    container.style.display = '';
    container.innerHTML = '';
    container.className = 'work-view-container';

    if (isMobileView() && !editMode) {
        await renderWorkViewMobile(container);
        return;
    }

    let chipBar = null; // declared in outer scope so enableCategoryDragReorder can access it


    const flatsPerFloor = currentBlockObj ? (currentBlockObj.flats_per_floor || FLATS_PER_FLOOR) : FLATS_PER_FLOOR;
    const flatNumbers = [];
    for (let i = 1; i <= flatsPerFloor; i++) {
        flatNumbers.push((currentFloor * 100) + i);
    }

    let rawCategories = (currentVenture && currentVenture.work_categories) ? currentVenture.work_categories : WORK_CATEGORIES;
    // Defensive: ensure every category value is an array so createSectionTable can iterate safely.
    const sanitizedCategories = {};
    Object.entries(rawCategories || {}).forEach(([cat, items]) => {
        sanitizedCategories[cat] = Array.isArray(items) ? items : [];
    });
    const workCategories = ensureWorkCategories(sanitizedCategories);
    const categoryNames = Object.keys(workCategories);

    // Category chip bar (non-edit mode only)
    if (!editMode && categoryNames.length > 1) {
        chipBar = document.createElement('div');
        chipBar.className = 'category-chip-bar';
        chipBar.style.cssText = 'display:flex;gap:8px;padding:8px 24px;flex-wrap:wrap;background:#fff;border-bottom:1px solid #e0e4e8;';

        const allChip = document.createElement('button');
        allChip.className = 'category-chip';
        allChip.textContent = 'All';
        allChip.style.cssText = 'padding:6px 14px;border:1px solid #1a1a1a;border-radius:16px;background:#1a1a1a;color:#fff;cursor:pointer;font-size:0.8rem;';
        allChip.dataset.category = '__all__';
        chipBar.appendChild(allChip);

        const sortedCategoryNames = sortWorkCategoryNames(categoryNames);
        sortedCategoryNames.forEach(cat => {
            const chip = document.createElement('button');
            chip.className = 'category-chip';
            chip.textContent = getWorkCategoryDisplayName(cat);
            chip.style.cssText = 'padding:6px 14px;border:1px solid #ccc;border-radius:16px;background:#fff;color:#555;cursor:pointer;font-size:0.8rem;';
            chip.dataset.category = cat;
            chipBar.appendChild(chip);
        });

        container.appendChild(chipBar);

        chipBar.addEventListener('click', (e) => {
            const chip = e.target.closest('.category-chip');
            if (!chip) return;
            const cat = chip.dataset.category;
            chipBar.querySelectorAll('.category-chip').forEach(c => {
                if (c.dataset.category === cat) {
                    c.style.background = '#1a1a1a';
                    c.style.color = '#fff';
                    c.style.borderColor = '#1a1a1a';
                } else {
                    c.style.background = '#fff';
                    c.style.color = '#555';
                    c.style.borderColor = '#ccc';
                }
            });
            // Show/hide sections
            container.querySelectorAll('.work-view-section').forEach(sec => {
                if (cat === '__all__' || sec.dataset.category === cat) {
                    sec.style.display = '';
                } else {
                    sec.style.display = 'none';
                }
            });
        });
    }

    // Preload all cell data in one bulk request
    const requiredKeys = [];

    function queueKeys(category, items, flats) {
        items.forEach((itemObj) => {
            flats.forEach(flat => {
                const cellId = cellKeyById(currentBlock, currentFloor, flat, itemObj.id);
                requiredKeys.push(cacheKey(cellId));
            });
        });
    }

    // Use sorted category names (respects userPrefs order) for both preloading and rendering
    const sortedNames = sortWorkCategoryNames(Object.keys(workCategories));
    sortedNames.forEach(cat => {
        const items = workCategories[cat] || [];
        const catFlats = CATEGORY_FLATS[cat] || flatNumbers;
        queueKeys(cat, items, catFlats);
    });
    await ensureCellsInCache(requiredKeys);

    // Render all category sections in sorted order (respects userPrefs drag-reorder)
    let sectionCount = 0;
    sortedNames.forEach(category => {
        const items = workCategories[category] || [];
        const catFlats = CATEGORY_FLATS[category] || flatNumbers;
        try {
            const sectionEl = createSectionTable(category, items, catFlats);
            sectionEl.dataset.category = category;
            container.appendChild(sectionEl);
            sectionCount++;
        } catch (err) {
            console.error('[renderWorkView] failed to render section', category, err);
        }
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

    // Enable drag-to-reorder for category sections (non-edit mode only, per-user)
    if (!editMode && sectionCount > 1) {
        enableCategoryDragReorder(container, chipBar);
    }

    if (window.updateTrackerStickyOffset) window.updateTrackerStickyOffset();
}

// ========================
// Drag-to-reorder for Work View categories (per-user, persists)
// ========================
function enableCategoryDragReorder(container, chipBar) {
    let draggedSection = null;
    let draggedChip = null;
    let sectionDragActive = false;
    let chipDragActive = false;

    // --- Section drag (category sections) ---
    container.querySelectorAll('.work-view-section').forEach(section => {
        section.draggable = true;
        section.addEventListener('dragstart', (e) => {
            draggedSection = section;
            sectionDragActive = true;
            section.style.opacity = '0.5';
            e.dataTransfer.effectAllowed = 'move';
        });
        section.addEventListener('dragend', () => {
            if (draggedSection) draggedSection.style.opacity = '';
            draggedSection = null;
            // Save after a short delay to ensure DOM is settled
            if (sectionDragActive) {
                sectionDragActive = false;
                const newOrder = Array.from(container.querySelectorAll('.work-view-section'))
                    .map(s => s.dataset.category)
                    .filter(Boolean);
                if (newOrder.length > 0 && JSON.stringify(newOrder) !== JSON.stringify(userPrefs.workCategoryOrder)) {
                    userPrefs.workCategoryOrder = newOrder;
                    if (typeof saveUserPrefsDebounced === 'function') saveUserPrefsDebounced();
                    if (chipBar) reorderChipBar(chipBar, newOrder);
                }
            }
        });
        section.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (draggedSection && section !== draggedSection) {
                const rect = section.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                if (e.clientY < midpoint) {
                    container.insertBefore(draggedSection, section);
                } else {
                    container.insertBefore(draggedSection, section.nextSibling);
                }
            }
        });
    });

    // --- Chip bar drag (category filter chips) ---
    if (chipBar) {
        chipBar.querySelectorAll('.category-chip').forEach(chip => {
            if (chip.dataset.category === '__all__') return; // Don't make "All" draggable
            chip.draggable = true;
            chip.addEventListener('dragstart', (e) => {
                draggedChip = chip;
                chipDragActive = true;
                chip.style.opacity = '0.5';
                e.dataTransfer.effectAllowed = 'move';
            });
            chip.addEventListener('dragend', () => {
                if (draggedChip) draggedChip.style.opacity = '';
                draggedChip = null;
                if (chipDragActive) {
                    chipDragActive = false;
                    const newOrder = Array.from(chipBar.querySelectorAll('.category-chip'))
                        .map(c => c.dataset.category)
                        .filter(c => c && c !== '__all__');
                    if (newOrder.length > 0 && JSON.stringify(newOrder) !== JSON.stringify(userPrefs.workCategoryOrder)) {
                        userPrefs.workCategoryOrder = newOrder;
                        if (typeof saveUserPrefsDebounced === 'function') saveUserPrefsDebounced();
                        reorderSections(container, newOrder);
                    }
                }
            });
            chip.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedChip && chip !== draggedChip && chip.dataset.category !== '__all__') {
                    const allChip = chipBar.querySelector('.category-chip[data-category="__all__"]');
                    const refNode = chip === allChip ? chip.nextSibling : chip;
                    if (refNode) {
                        chipBar.insertBefore(draggedChip, refNode);
                    } else {
                        chipBar.appendChild(draggedChip);
                    }
                }
            });
        });
    }
}

function reorderChipBar(chipBar, newOrder) {
    const allChip = chipBar.querySelector('.category-chip[data-category="__all__"]');
    const chips = {};
    chipBar.querySelectorAll('.category-chip').forEach(c => {
        if (c.dataset.category && c.dataset.category !== '__all__') {
            chips[c.dataset.category] = c;
        }
    });
    // Remove all non-All chips
    Object.values(chips).forEach(c => c.remove());
    // Re-append in new order after All chip
    let refNode = allChip ? allChip.nextSibling : chipBar.firstChild;
    newOrder.forEach(cat => {
        if (chips[cat]) {
            chipBar.insertBefore(chips[cat], refNode);
        }
    });
}

function reorderSections(container, newOrder) {
    const sections = {};
    container.querySelectorAll('.work-view-section').forEach(s => {
        if (s.dataset.category) sections[s.dataset.category] = s;
    });
    // Re-append in new order
    newOrder.forEach(cat => {
        if (sections[cat]) {
            container.appendChild(sections[cat]);
        }
    });
}

// ========================
// Mobile Work View
// ========================

// Mobile category reorder via up/down arrow buttons (per-user, saves to userPrefs)
function mobileReorderCategory(category, direction, visibleCategories, container, workCategories, flatNumbers, flat) {
    const currentIdx = visibleCategories.indexOf(category);
    if (currentIdx < 0) return;
    const newIdx = currentIdx + direction;
    if (newIdx < 0 || newIdx >= visibleCategories.length) return;

    // Swap in the visible categories array
    const swapped = [...visibleCategories];
    [swapped[currentIdx], swapped[newIdx]] = [swapped[newIdx], swapped[currentIdx]];

    // Update userPrefs with the new full order (including non-visible categories at the end)
    const allCats = Object.keys(workCategories);
    const nonVisible = allCats.filter(c => !swapped.includes(c));
    const newOrder = [...swapped, ...nonVisible];

    if (typeof userPrefs !== 'undefined') {
        userPrefs.workCategoryOrder = newOrder;
        if (typeof saveUserPrefsDebounced === 'function') saveUserPrefsDebounced();
    }

    // Re-render the mobile flat content with the new order
    renderMobileFlatContent(container, workCategories, flatNumbers, flat);
}

async function renderWorkViewMobile(container) {
    const flatsPerFloor = currentBlockObj ? (currentBlockObj.flats_per_floor || FLATS_PER_FLOOR) : FLATS_PER_FLOOR;
    const flatNumbers = [];
    for (let i = 1; i <= flatsPerFloor; i++) {
        flatNumbers.push((currentFloor * 100) + i);
    }

    let rawCategories = (currentVenture && currentVenture.work_categories) ? currentVenture.work_categories : WORK_CATEGORIES;
    const sanitizedCategories = {};
    Object.entries(rawCategories || {}).forEach(([cat, items]) => {
        sanitizedCategories[cat] = Array.isArray(items) ? items : [];
    });
    const workCategories = ensureWorkCategories(sanitizedCategories);

    // Collect all unique flats across categories
    const allFlats = new Set();
    Object.keys(workCategories).forEach(cat => {
        const catFlats = CATEGORY_FLATS[cat] || flatNumbers;
        catFlats.forEach(f => allFlats.add(f));
    });
    const sortedFlats = Array.from(allFlats).sort((a, b) => a - b);

    // Default selected flat
    if (!mobileSelectedFlat || !sortedFlats.includes(mobileSelectedFlat)) {
        mobileSelectedFlat = sortedFlats[0];
    }

    // Preload cell data
    const requiredKeys = [];
    Object.entries(workCategories).forEach(([cat, items]) => {
        const catFlats = CATEGORY_FLATS[cat] || flatNumbers;
        items.forEach(itemObj => {
            catFlats.forEach(flat => {
                const cellId = cellKeyById(currentBlock, currentFloor, flat, itemObj.id);
                requiredKeys.push(cacheKey(cellId));
            });
        });
    });
    await ensureCellsInCache(requiredKeys);

    container.className = 'work-view-container mobile-work-view';
    container.dataset.flats = sortedFlats.join(',');

    // Single sticky nav bar: ◀ flat-number ◀ + Bulk button
    const navBar = document.createElement('div');
    navBar.className = 'mobile-flat-nav';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'mobile-flat-nav-btn';
    prevBtn.innerHTML = '&#9664;';
    prevBtn.disabled = sortedFlats.indexOf(mobileSelectedFlat) === 0;

    const flatDisplay = document.createElement('div');
    flatDisplay.className = 'mobile-flat-display';
    const flatIdx = sortedFlats.indexOf(mobileSelectedFlat);
    flatDisplay.innerHTML = `<span class="mobile-flat-number">${mobileSelectedFlat}</span><span class="mobile-flat-counter">${flatIdx + 1} / ${sortedFlats.length}</span>`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'mobile-flat-nav-btn';
    nextBtn.innerHTML = '&#9654;';
    nextBtn.disabled = flatIdx === sortedFlats.length - 1;

    // Bulk button integrated into nav bar
    const navBulk = document.createElement('button');
    navBulk.className = 'mst-bulk-btn';
    navBulk.textContent = 'Bulk';
    navBulk.id = 'mstBulkBtn';
    navBulk.addEventListener('click', () => document.getElementById('bulkSelectBtn').click());

    navBar.appendChild(prevBtn);
    navBar.appendChild(flatDisplay);
    navBar.appendChild(nextBtn);
    navBar.appendChild(navBulk);
    container.appendChild(navBar);

    // Flat chips (horizontal scroll, quick jump)
    const chipBar = document.createElement('div');
    chipBar.className = 'mobile-flat-chips';
    chipBar.id = 'mobileFlatChips';
    sortedFlats.forEach(flat => {
        const chip = document.createElement('button');
        chip.className = 'mobile-flat-chip' + (flat === mobileSelectedFlat ? ' active' : '');
        chip.textContent = flat;
        chip.dataset.flat = flat;
        chip.addEventListener('click', () => {
            if (flat === mobileSelectedFlat) return;
            mobileSelectedFlat = flat;
            updateMobileFlatNav(container, sortedFlats);
            renderMobileFlatContent(container, workCategories, flatNumbers, flat);
        });
        chipBar.appendChild(chip);
    });
    container.appendChild(chipBar);

    // Content area
    const contentArea = document.createElement('div');
    contentArea.className = 'mobile-flat-content';
    contentArea.id = 'mobileFlatContent';
    container.appendChild(contentArea);

    // Navigation handlers
    prevBtn.addEventListener('click', () => {
        const idx = sortedFlats.indexOf(mobileSelectedFlat);
        if (idx > 0) {
            mobileSelectedFlat = sortedFlats[idx - 1];
            updateMobileFlatNav(container, sortedFlats);
            renderMobileFlatContent(container, workCategories, flatNumbers, mobileSelectedFlat);
        }
    });
    nextBtn.addEventListener('click', () => {
        const idx = sortedFlats.indexOf(mobileSelectedFlat);
        if (idx < sortedFlats.length - 1) {
            mobileSelectedFlat = sortedFlats[idx + 1];
            updateMobileFlatNav(container, sortedFlats);
            renderMobileFlatContent(container, workCategories, flatNumbers, mobileSelectedFlat);
        }
    });

    // Swipe gesture support
    let touchStartX = 0;
    let touchEndX = 0;
    contentArea.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    contentArea.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchStartX - touchEndX;
        if (Math.abs(diff) < 60) return; // ignore small swipes
        if (diff > 0) {
            nextBtn.click(); // swipe left = next
        } else {
            prevBtn.click(); // swipe right = prev
        }
    }, { passive: true });

    renderMobileFlatContent(container, workCategories, flatNumbers, mobileSelectedFlat);

    if (window.updateTrackerStickyOffset) window.updateTrackerStickyOffset();
}

function updateMobileFlatNav(container, sortedFlats) {
    const idx = sortedFlats.indexOf(mobileSelectedFlat);
    const navBtns = container.querySelectorAll('.mobile-flat-nav-btn');
    const display = container.querySelector('.mobile-flat-display');
    if (display) {
        display.innerHTML = `<span class="mobile-flat-number">${mobileSelectedFlat}</span><span class="mobile-flat-counter">${idx + 1} / ${sortedFlats.length}</span>`;
    }
    if (navBtns.length === 2) {
        navBtns[0].disabled = idx === 0;
        navBtns[1].disabled = idx === sortedFlats.length - 1;
    }
    // Update chip active state and scroll into view
    container.querySelectorAll('.mobile-flat-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.flat == mobileSelectedFlat);
        if (c.dataset.flat == mobileSelectedFlat) {
            c.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    });
}

function renderMobileFlatContent(container, workCategories, flatNumbers, flat) {
    const contentArea = container.querySelector('#mobileFlatContent');
    if (!contentArea) return;
    contentArea.innerHTML = '';

    const categoryNames = Object.keys(workCategories);
    const sortedCategoryNames = sortWorkCategoryNames(categoryNames);
    // Filter to only categories that have content for this flat
    const visibleCategories = sortedCategoryNames.filter(category => {
        const items = workCategories[category];
        const catFlats = CATEGORY_FLATS[category] || flatNumbers;
        return catFlats.includes(flat) && items && items.length > 0;
    });
    let hasContent = false;

    visibleCategories.forEach((category, catIdx) => {
        const items = workCategories[category];
        hasContent = true;

        const section = document.createElement('div');
        section.className = 'mobile-category-section';
        section.dataset.category = category;

        // Category header with progress summary + up/down reorder buttons
        let doneCount = 0;
        items.forEach(itemObj => {
            const cellId = cellKeyById(currentBlock, currentFloor, flat, itemObj.id);
            const cellData = cellsCache[cacheKey(cellId)];
            if (cellData?.color === 'green') doneCount++;
        });
        const progressPct = Math.round((doneCount / items.length) * 100);

        const header = document.createElement('div');
        header.className = 'mobile-category-header';
        header.innerHTML = `<span class="mobile-cat-name">${getWorkCategoryDisplayName(category)}</span><span class="mobile-cat-progress">${doneCount}/${items.length} (${progressPct}%)</span>`;

        // Up/down reorder buttons for mobile (per-user, saves to userPrefs)
        if (visibleCategories.length > 1) {
            const reorderBtns = document.createElement('div');
            reorderBtns.className = 'mobile-reorder-btns';
            reorderBtns.style.cssText = 'display:flex;gap:4px;margin-left:auto;';

            const upBtn = document.createElement('button');
            upBtn.className = 'mobile-reorder-up';
            upBtn.innerHTML = '&#9650;';
            upBtn.style.cssText = 'background:none;border:1px solid #ccc;border-radius:4px;padding:2px 8px;font-size:0.7rem;cursor:pointer;color:#555;';
            upBtn.disabled = catIdx === 0;
            upBtn.style.opacity = catIdx === 0 ? '0.3' : '1';
            upBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                mobileReorderCategory(category, -1, visibleCategories, container, workCategories, flatNumbers, flat);
            });

            const downBtn = document.createElement('button');
            downBtn.className = 'mobile-reorder-down';
            downBtn.innerHTML = '&#9660;';
            downBtn.style.cssText = 'background:none;border:1px solid #ccc;border-radius:4px;padding:2px 8px;font-size:0.7rem;cursor:pointer;color:#555;';
            downBtn.disabled = catIdx === visibleCategories.length - 1;
            downBtn.style.opacity = catIdx === visibleCategories.length - 1 ? '0.3' : '1';
            downBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                mobileReorderCategory(category, 1, visibleCategories, container, workCategories, flatNumbers, flat);
            });

            reorderBtns.appendChild(upBtn);
            reorderBtns.appendChild(downBtn);
            header.appendChild(reorderBtns);
        }

        section.appendChild(header);

        // Progress bar
        const progressBar = document.createElement('div');
        progressBar.className = 'mobile-progress-bar';
        const progressFill = document.createElement('div');
        progressFill.className = 'mobile-progress-fill';
        progressFill.style.width = progressPct + '%';
        progressBar.appendChild(progressFill);
        section.appendChild(progressBar);

        items.forEach((itemObj, wi) => {
            const cellId = cellKeyById(currentBlock, currentFloor, flat, itemObj.id);
            const cellData = cellsCache[cacheKey(cellId)];
            const color = cellData?.color || 'red';

            const row = document.createElement('div');
            row.className = 'mobile-work-row';

            const sno = document.createElement('span');
            sno.className = 'mobile-sno';
            sno.textContent = wi + 1;
            row.appendChild(sno);

            const label = document.createElement('div');
            label.className = 'mobile-work-label';

            const labelText = document.createElement('span');
            labelText.textContent = itemObj.label;
            label.appendChild(labelText);

            const editBtn = document.createElement('button');
            editBtn.className = 'edit-btn mobile-work-edit-btn';
            editBtn.innerHTML = '&#9998;';
            editBtn.title = 'Edit description';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                startInlineEdit(label, itemObj.label, (newLabel) => renameWorkItem(category, itemObj.id, newLabel));
            });
            label.appendChild(editBtn);
            row.appendChild(label);

            const statusArea = document.createElement('div');
            statusArea.className = 'mobile-status-area';

            const btn = document.createElement('button');
            btn.className = 'cell-btn mobile-cell-btn ' + (color || 'red');
            btn.title = `${flat} - ${itemObj.label}`;
            btn.dataset.cellId = cacheKey(cellId);

            const statusLabel = document.createElement('span');
            statusLabel.className = 'mobile-status-label';
            statusLabel.textContent = color ? COLOR_LABELS[color] : 'Not set';

            const imgCount = (cellData?.remarkImages || []).length;
            const imgIndicator = createImageIndicator(imgCount);
            if (imgIndicator) btn.appendChild(imgIndicator);

            statusArea.appendChild(btn);
            statusArea.appendChild(statusLabel);
            row.appendChild(statusArea);

            const remarksBtn = document.createElement('button');
            remarksBtn.className = 'mobile-remarks-btn';
            const hasRemarks = cellData?.remarks || imgCount > 0;
            remarksBtn.innerHTML = '&#128221;';
            remarksBtn.title = 'Remarks & Photos';
            remarksBtn.style.opacity = hasRemarks ? '1' : '0.4';
            remarksBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openTimelineModal(cellId, itemObj.label, flat);
            });
            row.appendChild(remarksBtn);

            const historyBtn = document.createElement('button');
            historyBtn.className = 'mobile-history-btn';
            historyBtn.textContent = 'History';
            historyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openTimelineModal(cellId, itemObj.label, flat);
            });
            row.appendChild(historyBtn);

            section.appendChild(row);

            // Cell interactions
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (bulkMode) {
                    const ck = cacheKey(cellId);
                    if (bulkSelectedColor) {
                        bulkPaintCell(cellId, bulkSelectedColor, itemObj.label, flat);
                        // Update status label after paint
                        statusLabel.textContent = bulkSelectedColor ? COLOR_LABELS[bulkSelectedColor] : 'Not set';
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

            btn.addEventListener('touchstart', (e) => {
                if (bulkMode && bulkSelectedColor) {
                    if (e.cancelable) e.preventDefault();
                    bulkIsDragging = true;
                    bulkPaintCell(cellId, bulkSelectedColor, itemObj.label, flat);
                    statusLabel.textContent = bulkSelectedColor ? COLOR_LABELS[bulkSelectedColor] : 'Not set';
                }
            }, { passive: false });

            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                openTimelineModal(cellId, itemObj.label, flat);
            });
        });

        // Quick-add button
        const addBtn = document.createElement('button');
        addBtn.className = 'mobile-add-item-btn';
        addBtn.textContent = '+ Add Work Item';
        addBtn.addEventListener('click', () => openWorkAddDialog(category));
        section.appendChild(addBtn);

        contentArea.appendChild(section);
    });

    // Empty state
    if (!hasContent) {
        const empty = document.createElement('div');
        empty.className = 'mobile-empty-state';
        empty.textContent = 'No work items for flat ' + flat;
        contentArea.appendChild(empty);
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
        ctrl.querySelector('[title="Delete category"]').addEventListener('click', () => showConfirm('Delete Category', `Delete '${category}' and all its items?`, () => deleteWorkCategory(category), null, 'Delete', true));
        header.appendChild(ctrl);
    } else {
        header.textContent = getWorkCategoryDisplayName(category);
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
            controls.querySelector('[title="Delete"]').addEventListener('click', () => showConfirm('Delete Item', `Delete '${itemObj.label}' from ${category}?`, () => deleteWorkItem(category, itemObj.id), null, 'Delete', true));
            const upBtn = controls.querySelector('[title="Move up"]');
            const downBtn = controls.querySelector('[title="Move down"]');
            if (upBtn) upBtn.addEventListener('click', () => reorderWorkItem(category, itemObj.id, -1));
            if (downBtn) downBtn.addEventListener('click', () => reorderWorkItem(category, itemObj.id, 1));
        } else {
            tdWork.innerHTML = `<span class="item-label">${escapeHtml(itemObj.label)}</span>`;
            const editBtn = document.createElement('button');
            editBtn.className = 'edit-btn work-item-edit-btn';
            editBtn.title = 'Edit description';
            editBtn.innerHTML = '&#9998;';
            editBtn.style.marginLeft = '8px';
            editBtn.style.cursor = 'pointer';
            editBtn.addEventListener('click', () => {
                startInlineEdit(tdWork, itemObj.label, (newLabel) => renameWorkItem(category, itemObj.id, newLabel));
            });
            tdWork.appendChild(editBtn);
        }
        row.appendChild(tdWork);

        flats.forEach(flat => {
            const cellId = cellKeyById(currentBlock, currentFloor, flat, itemObj.id);
            const cellData = cellsCache[cacheKey(cellId)];
            const color = cellData?.color || null;

            const td = document.createElement('td');
            const wrapper = document.createElement('div');
            wrapper.className = 'cell-wrapper';

            const btn = document.createElement('button');
            btn.className = 'cell-btn ' + (color || 'red');
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
                            bulkPaintCell(cellId, bulkSelectedColor, itemObj.label, flat);
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
                // Drag-to-paint support in bulk mode
                btn.addEventListener('mousedown', (e) => {
                    if (bulkMode && bulkSelectedColor) {
                        e.preventDefault();
                        bulkIsDragging = true;
                        bulkPaintCell(cellId, bulkSelectedColor, itemObj.label, flat);
                    }
                });
                btn.addEventListener('mouseover', () => {
                    if (bulkMode && bulkIsDragging && bulkSelectedColor) {
                        bulkPaintCell(cellId, bulkSelectedColor, itemObj.label, flat);
                    }
                });
                // Touch support for mobile drag-paint
                btn.addEventListener('touchstart', (e) => {
                    if (bulkMode && bulkSelectedColor) {
                        if (e.cancelable) e.preventDefault();
                        bulkIsDragging = true;
                        bulkPaintCell(cellId, bulkSelectedColor, itemObj.label, flat);
                    }
                }, { passive: false });
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
            const cellId = cellKeyById(currentBlock, currentFloor, flat, itemObj.id);
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

    // Quick-add FAB in section header (non-edit mode)
    if (!editMode && header) {
        const fab = document.createElement('button');
        fab.className = 'work-add-fab';
        fab.textContent = '+';
        fab.title = 'Add Work Description';
        fab.addEventListener('click', () => openWorkAddDialog(category));
        header.appendChild(fab);
    }

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
    els.popupCurrentStatus.textContent = COLOR_LABELS[currentColor || 'red'];
    els.statusPopup.classList.add('show');
    loadCellUsageInPopup(cellId, workItem, flat);
}

async function loadCellUsageInPopup(cellId, workItem, flat) {
    if (!els.usageMaterialSelect) return;
    els.usageMaterialSelect.innerHTML = '<option value="">-- Material --</option>';
    if (els.usageQtyInput) els.usageQtyInput.value = '';
    if (els.usageWasteInput) els.usageWasteInput.value = '';
    if (els.usageReasonInput) els.usageReasonInput.value = '';
    if (els.usageMsg) { els.usageMsg.textContent = ''; els.usageMsg.style.color = '#c0392b'; }
    if (els.cellUsageList) els.cellUsageList.innerHTML = '<div style="color:#999;font-size:0.78rem;padding:4px;">Loading...</div>';

    const venture = currentVenture;
    if (!venture) return;

    try {
        const mats = await apiGet('/api/materials?venture_id=' + encodeURIComponent(venture.id)) || [];
        const globalMats = await apiGet('/api/materials?global=true') || [];
        const allMats = [...globalMats, ...mats.filter(m => !globalMats.some(g => g.id === m.id))];
        allMats.forEach(m => {
            els.usageMaterialSelect.innerHTML += `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.unit)})</option>`;
        });
    } catch (e) { /* ignore */ }

    // Load existing usage for this cell
    try {
        const data = await apiGet('/api/cell/' + encodeURIComponent(cellId) + '/material-usage');
        const usageRows = (data && data.usage) || [];
        const reversalRows = (data && data.reversals) || [];
        if (usageRows.length === 0) {
            if (els.cellUsageList) els.cellUsageList.innerHTML = '<div style="color:#999;font-size:0.78rem;padding:4px;">No usage logged.</div>';
            return;
        }
        let html = '';
        usageRows.forEach(u => {
            const reversed = parseFloat(u.reversed_qty || 0);
            const remaining = parseFloat(u.qty_used || 0) - reversed;
            const mat = allMats.find(m => m.id === u.material_id);
            const matName = mat ? mat.name : u.material_id;
            const reversalCount = reversalRows.filter(r => r.usage_id === u.id).length;
            const dateStr = u.entry_date ? new Date(u.entry_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';
            html += `<div style="padding:4px 0;font-size:0.78rem;border-bottom:1px solid #f0f0f0;">
                <strong>${escapeHtml(matName)}</strong> <span style="color:#999;">${dateStr}</span> —
                Used: ${u.qty_used || 0}${u.qty_wasted > 0 ? ', Wasted: ' + u.qty_wasted : ''}
                ${reversed > 0 ? ', Reversed: ' + reversed : ''}
                ${reversalCount > 0 ? ` (${reversalCount} reversal${reversalCount > 1 ? 's' : ''})` : ''}
                ${u.wastage_reason ? ', Reason: ' + escapeHtml(u.wastage_reason) : ''}
                ${remaining > 0 ? `<button class="btn-text reverse-usage-btn" data-uid="${u.id}" data-remaining="${remaining}" style="font-size:0.72rem;color:#c0392b;margin-left:4px;">Reverse</button>` : '<span style="color:#999;">(fully reversed)</span>'}
            </div>`;
        });
        if (els.cellUsageList) els.cellUsageList.innerHTML = html;
        if (els.cellUsageList) {
            els.cellUsageList.querySelectorAll('.reverse-usage-btn').forEach(btn => {
                btn.addEventListener('click', () => promptReverseUsage(btn.dataset.uid, parseFloat(btn.dataset.remaining)));
            });
        }
    } catch (e) {
        if (els.cellUsageList) els.cellUsageList.innerHTML = '<div style="color:#999;font-size:0.78rem;padding:4px;">No usage data.</div>';
    }
}

function promptReverseUsage(usageId, remainingQty) {
    const reason = prompt(`Enter quantity to reverse (max ${remainingQty}) and reason:\nFormat: qty|reason\nExample: 5|Wrong entry`);
    if (!reason) return;
    const parts = reason.split('|');
    const reverseQty = parseFloat(parts[0]);
    const reverseReason = parts.slice(1).join('|').trim();
    if (isNaN(reverseQty) || reverseQty <= 0 || reverseQty > remainingQty) {
        if (els.usageMsg) els.usageMsg.textContent = `Invalid quantity. Must be between 0 and ${remainingQty}.`;
        return;
    }
    apiPost('/api/cell/' + encodeURIComponent(selectedCellId) + '/reverse-usage', {
        usage_id: usageId,
        reverse_qty: reverseQty,
        reason: reverseReason
    }).then(() => {
        showToast('Usage reversed');
        loadCellUsageInPopup(selectedCellId, selectedWorkItem, selectedFlat);
    }).catch(err => {
        if (els.usageMsg) els.usageMsg.textContent = err.message || 'Failed to reverse usage.';
    });
}

async function promptDowngradeReversal(cellId, flat, workItem) {
    try {
        const data = await apiGet('/api/cell/' + encodeURIComponent(cellId) + '/material-usage');
        const usageRows = (data && data.usage) || [];
        const activeRows = usageRows.filter(u => {
            const reversed = parseFloat(u.reversed_qty || 0);
            return (parseFloat(u.qty_used || 0) - reversed) > 0;
        });
        if (activeRows.length === 0) return;

        // Build a modal overlay for reversal selection
        const overlay = document.createElement('div');
        overlay.className = 'modal show';
        overlay.style.zIndex = '10000';
        let rowsHtml = '';
        activeRows.forEach(u => {
            const remaining = parseFloat(u.qty_used || 0) - parseFloat(u.reversed_qty || 0);
            rowsHtml += `<tr>
                <td>${escapeHtml(u.material_id)}</td>
                <td>${remaining}</td>
                <td><input type="number" class="downgrade-reverse-qty" data-uid="${u.id}" data-max="${remaining}" value="${remaining}" min="0" max="${remaining}" step="0.01" style="width:70px;font-size:0.8rem;"></td>
            </tr>`;
        });
        overlay.innerHTML = `<div class="modal-content popup-small">
            <div class="modal-header">
                <h3>Reverse Material Usage?</h3>
                <button class="close-btn downgrade-skip-btn">&times;</button>
            </div>
            <div style="padding:16px;">
                <p style="font-size:0.85rem;color:#666;margin-bottom:12px;">
                    <strong>${escapeHtml(flat)} - ${escapeHtml(workItem)}</strong> was downgraded from Completed (green).
                    The following material usage was recorded for this cell. Adjust quantities to reverse and click "Reverse Selected".
                </p>
                <table class="tracker-table" style="font-size:0.82rem;">
                    <thead><tr><th>Material</th><th>Remaining</th><th>Reverse Qty</th></tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
                <div id="downgradeReversalMsg" style="font-size:0.82rem;color:#c0392b;min-height:16px;margin-top:8px;"></div>
                <div class="popup-actions" style="margin-top:16px;">
                    <button class="btn-secondary downgrade-skip-btn">Skip</button>
                    <button class="btn-primary downgrade-reverse-btn">Reverse Selected</button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(overlay);

        overlay.querySelectorAll('.downgrade-skip-btn').forEach(btn => {
            btn.addEventListener('click', () => overlay.remove());
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        overlay.querySelector('.downgrade-reverse-btn').addEventListener('click', async () => {
            const msgEl = overlay.querySelector('#downgradeReversalMsg');
            msgEl.textContent = '';
            const inputs = overlay.querySelectorAll('.downgrade-reverse-qty');
            let reversed = 0;
            for (const inp of inputs) {
                const qty = parseFloat(inp.value);
                const max = parseFloat(inp.dataset.max);
                if (isNaN(qty) || qty <= 0) continue;
                if (qty > max) {
                    msgEl.textContent = `Quantity for ${inp.dataset.uid} exceeds remaining (${max}).`;
                    return;
                }
                try {
                    await apiPost('/api/cell/' + encodeURIComponent(cellId) + '/reverse-usage', {
                        usage_id: inp.dataset.uid,
                        reverse_qty: qty,
                        reason: 'Cell downgraded from green'
                    });
                    reversed++;
                } catch (err) {
                    msgEl.textContent = err.message || 'Failed to reverse some entries.';
                    return;
                }
            }
            if (reversed > 0) {
                showToast(`${reversed} usage entr${reversed > 1 ? 'ies' : 'y'} reversed`);
            }
            overlay.remove();
        });
    } catch (e) {
        // Silently fail — don't block the color change
        console.error('Failed to load usage for downgrade reversal:', e);
    }
}

if (els.logUsageBtn) {
    els.logUsageBtn.addEventListener('click', async () => {
        if (!selectedCellId) return;
        const materialId = els.usageMaterialSelect.value;
        const qtyUsed = parseFloat(els.usageQtyInput.value) || 0;
        const qtyWasted = parseFloat(els.usageWasteInput.value) || 0;
        const wastageReason = els.usageReasonInput ? els.usageReasonInput.value.trim() : '';
        if (!materialId || (qtyUsed <= 0 && qtyWasted <= 0)) {
            if (els.usageMsg) els.usageMsg.textContent = 'Select a material and enter qty or waste.';
            return;
        }
        if (els.usageMsg) { els.usageMsg.textContent = ''; els.usageMsg.style.color = '#c0392b'; }
        const venture = currentVenture;
        if (!venture) return;
        const cellParts = selectedCellId.split('_');
        const block = cellParts[0] || '';
        const floor = cellParts.length > 2 ? cellParts[1] : '';
        try {
            await apiPost('/api/cell/' + encodeURIComponent(selectedCellId) + '/usage', {
                venture_id: venture.id,
                material_id: materialId,
                qty_used: qtyUsed,
                qty_wasted: qtyWasted,
                wastage_reason: wastageReason || null,
                block: block,
                floor: floor,
                flat: selectedFlat,
                work_item: selectedWorkItem,
                entry_date: new Date().toISOString().split('T')[0]
            });
            showToast('Usage logged');
            loadCellUsageInPopup(selectedCellId, selectedWorkItem, selectedFlat);
        } catch (err) {
            let msg = err.message || 'Failed to log usage.';
            try {
                const jsonMatch = msg.match(/\{.*\}/);
                if (jsonMatch) msg = JSON.parse(jsonMatch[0]).error || msg;
            } catch (e2) {}
            if (els.usageMsg) els.usageMsg.textContent = msg;
        }
    });
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
            await updateSuperStructureStatus(selectedCellId, color, selectedWorkItem);
        } else {
            await updateCellColor(selectedCellId, color, selectedWorkItem, selectedFlat);
        }
        closeStatusPopup();
    });
});

els.clearStatusBtn.addEventListener('click', async () => {
    if (!selectedCellId) return;
    // "Clear" now resets to red ("Yet to start") — the default state for all cells
    if (selectedCellId.startsWith('superstructure_')) {
        await updateSuperStructureStatus(selectedCellId, 'red', selectedWorkItem);
    } else {
        await updateCellColor(selectedCellId, 'red', selectedWorkItem, selectedFlat);
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
    // Revert any pending paint-mode changes
    if (bulkOriginalData.size > 0) {
        bulkOriginalData.forEach((oldData, ck) => {
            cellsCache[ck] = oldData;
            const cellBtn = document.querySelector(`[data-cell-id="${ck}"]`);
            if (cellBtn) cellBtn.className = 'cell-btn ' + (oldData?.color || 'red');
        });
    }
    bulkMode = false;
    bulkSelectedColor = null;
    bulkIsDragging = false;
    bulkSelected.clear();
    bulkPendingChanges.clear();
    bulkOriginalData.clear();
    document.getElementById('bulkSelectBtn').classList.remove('active');
    document.getElementById('bulkActionBar').style.display = 'none';
    const bulkSaveBtn = document.getElementById('bulkSaveBtn');
    if (bulkSaveBtn) bulkSaveBtn.style.display = 'none';
    // Sync mobile sticky toolbar bulk button
    const mstBulk = document.getElementById('mstBulkBtn');
    if (mstBulk) mstBulk.classList.remove('active');
    // Remove all bulk-selected highlights
    document.querySelectorAll('.cell-btn.bulk-selected').forEach(b => b.classList.remove('bulk-selected'));
    // Remove color button highlights
    document.querySelectorAll('.bulk-color-btn.selected').forEach(b => b.classList.remove('selected'));
}

// Global mouseup to stop drag-paint
document.addEventListener('mouseup', () => { bulkIsDragging = false; });
document.addEventListener('touchend', () => { bulkIsDragging = false; });
document.addEventListener('touchcancel', () => { bulkIsDragging = false; });

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
        // Sync mobile sticky toolbar bulk button
        const mstBulk = document.getElementById('mstBulkBtn');
        if (mstBulk) mstBulk.classList.add('active');
    } else {
        exitBulkMode();
    }
});

document.getElementById('bulkCancelBtn').addEventListener('click', exitBulkMode);

// Save button: commit all pending paint-mode changes
document.getElementById('bulkSaveBtn').addEventListener('click', async () => {
    if (bulkPendingChanges.size === 0) {
        exitBulkMode();
        return;
    }
    const batch = [];
    bulkPendingChanges.forEach((change, ck) => {
        batch.push({ id: ck, data: change.newData });
    });
    const count = batch.length;
    showToast(`Saving ${count} cells…`);
    try {
        inFlightSaves++;
        let allDowngraded = [];
        for (let i = 0; i < batch.length; i += 50) {
            const resp = await apiPost('/api/cells/batch', { cells: batch.slice(i, i + 50) });
            if (resp && resp.downgraded) {
                allDowngraded = allDowngraded.concat(resp.downgraded);
            }
        }
        showToast(`${count} cells saved`);
        if (allDowngraded.length > 0) {
            showToast(`${allDowngraded.length} cell(s) downgraded from green — check usage reversal`, true);
        }
    } catch (err) {
        console.error('Bulk save failed:', err);
        showToast('Bulk save failed — please retry', true);
    } finally {
        inFlightSaves--;
    }
    bulkPendingChanges.clear();
    bulkOriginalData.clear();
    exitBulkMode();
});

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
                const existing = (cellsCache[ck] && !cellsCache[ck]?.__notFound) ? cellsCache[ck] : null;
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
                // Ensure venture_id/block/floor are present for filtered queries
                if (currentVenture && currentVenture.id) data.venture_id = currentVenture.id;
                if (currentBlock) data.block = currentBlock;
                if (currentFloor !== null && currentFloor !== undefined) data.floor = String(currentFloor);
                cellsCache[ck] = data;
                // Update DOM instantly
                const cellBtn = document.querySelector(`[data-cell-id="${ck}"]`);
                if (cellBtn) cellBtn.className = 'cell-btn ' + (color || 'red');
                batch.push({ id: ck, data });
            });

            const count = batch.length;
            exitBulkMode();
            showToast(`Updating ${count} cells…`);

            // Send in chunks of 50
            try {
                inFlightSaves++;
                let allDowngraded = [];
                for (let i = 0; i < batch.length; i += 50) {
                    const resp = await apiPost('/api/cells/batch', { cells: batch.slice(i, i + 50) });
                    if (resp && resp.downgraded) {
                        allDowngraded = allDowngraded.concat(resp.downgraded);
                    }
                }
                showToast(`${count} cells updated`);
                if (allDowngraded.length > 0) {
                    showToast(`${allDowngraded.length} cell(s) downgraded from green — check usage reversal`, true);
                }
            } catch (err) {
                console.error('Bulk save failed:', err);
                showToast('Bulk save failed — please retry', true);
            } finally {
                inFlightSaves--;
            }
        } else {
            // Paint mode: set the active color so clicking cells applies it (deferred save)
            bulkSelectedColor = color;
            // Highlight the selected color button
            document.querySelectorAll('.bulk-color-btn.selected').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            const colorName = color ? COLOR_LABELS[color] : 'No status color';
            document.getElementById('bulkCount').textContent = `Paint mode: ${colorName} — click cells, then Save`;
            // Show Save button
            const bulkSaveBtn = document.getElementById('bulkSaveBtn');
            if (bulkSaveBtn) bulkSaveBtn.style.display = '';
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
// Super Structure View
// ========================
function renderSuperStructure() {
    const container = document.getElementById('superStructureContainer');
    container.style.display = '';
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
            controls.querySelector('[title="Delete"]').addEventListener('click', () => showConfirm('Delete Item', `Delete '${itemObj.label}'? Existing tracking data will be hidden but not lost.`, () => archiveSuperItem(itemObj.id), null, 'Delete', true));
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
        btn.className = 'cell-btn ' + (activeStatus || 'red');
        btn.title = `${itemObj.label} — ${COLOR_LABELS[activeStatus || 'red']}`;
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

async function updateSuperStructureStatus(cellId, status, workItem) {
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const ck = cacheKey(cellId);
    const existing = (cellsCache[ck] && !cellsCache[ck]?.__notFound) ? cellsCache[ck] : null;

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
        // Ensure venture_id/block are present for filtered queries (no floor for SS)
        if (currentVenture && currentVenture.id) data.venture_id = currentVenture.id;
        if (currentBlock) data.block = currentBlock;
        inFlightSaves++;
        try {
            await apiPost('/api/cell/' + encodeURIComponent(ck), data);
        } finally {
            inFlightSaves--;
        }
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
    // Ensure venture_id/block are present for filtered queries (no floor for SS)
    if (currentVenture && currentVenture.id) data.venture_id = currentVenture.id;
    if (currentBlock) data.block = currentBlock;
    inFlightSaves++;
    try {
        await apiPost('/api/cell/' + encodeURIComponent(ck), data);
    } finally {
        inFlightSaves--;
    }
    cellsCache[ck] = data;
    renderSuperStructure();
    showToast('Status updated');
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
    if (currentView === 'work') renderWorkView(true);
    else renderSuperStructure();
});

let confirmCallback = null;
function showConfirm(title, message, onConfirm, requireType, confirmLabel, confirmDanger) {
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
    const actionBtn = document.getElementById('confirmAction');
    actionBtn.textContent = confirmLabel || 'Confirm';
    if (confirmDanger) {
        actionBtn.style.background = '#c0392b';
    } else {
        actionBtn.style.background = '';
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
    try {
        await saveVenture(currentVenture);
        showToast('Changes saved');
    } catch (err) {
        showToast('Failed to save: ' + (err.message || err), true);
    }
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

// Work Item Editing (legacy flat_view_items)
async function renameFlatItem(itemId, newLabel) {
    const items = ensureItemIds(currentVenture.flat_view_items || workItems);
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const old = item.label;
    item.label = newLabel;
    currentVenture.flat_view_items = items;
    await logEdit('rename', 'flat_view', itemId, old, newLabel);
    await saveVentureConfig();
    renderWorkView(true);
}

async function addFlatItem(label) {
    const items = ensureItemIds(currentVenture.flat_view_items || workItems);
    const newId = `item_${slugId(label)}_${Date.now()}`;
    items.push({ id: newId, label });
    currentVenture.flat_view_items = items;
    await logEdit('add', 'flat_view', newId, null, label);
    await saveVentureConfig();
    renderWorkView(true);
}

async function archiveFlatItem(itemId) {
    if (!archivedItems['flat_view']) archivedItems['flat_view'] = [];
    archivedItems['flat_view'].push(itemId);
    currentVenture.archived = archivedItems;
    await logEdit('delete', 'flat_view', itemId, null, null);
    await saveVentureConfig();
    renderWorkView(true);
}

async function restoreFlatItem(itemId) {
    archivedItems['flat_view'] = (archivedItems['flat_view'] || []).filter(id => id !== itemId);
    currentVenture.archived = archivedItems;
    await logEdit('restore', 'flat_view', itemId, null, null);
    await saveVentureConfig();
    renderWorkView(true);
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
    renderWorkView();
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
    renderWorkView(true);
}

async function renameWorkItem(category, itemId, newLabel) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    const item = cats[category].find(i => i.id === itemId);
    if (!item) return;
    const old = item.label;
    item.label = newLabel;
    currentVenture.work_categories = cats;

    // Keep flat_view_items in sync so work view shows the same label
    if (currentVenture.flat_view_items && currentVenture.flat_view_items.length > 0) {
        currentVenture.flat_view_items = currentVenture.flat_view_items.map(fi => {
            if (typeof fi === 'string') return fi === old ? newLabel : fi;
            if (fi && fi.label === old) return { ...fi, label: newLabel };
            return fi;
        });
    }

    await logEdit('rename', 'work_item', itemId, old, newLabel);
    await saveVentureConfig();
    renderWorkView(true);
}

async function addWorkItem(category, label, applyAll) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    if (!cats[category]) {
        showToast('Category not found', true);
        return;
    }
    const existing = cats[category].find(i => i.label.toLowerCase() === label.toLowerCase());
    if (existing) {
        showToast(`'${label}' already exists in ${category}`, true);
        return;
    }
    const newId = `item_${slugId(category)}_${slugId(label)}_${Date.now()}`;
    cats[category].push({ id: newId, label });
    currentVenture.work_categories = cats;
    await logEdit('add', 'work_item', newId, null, label);
    await saveVentureConfig();

    if (applyAll) {
        try {
            const settings = { work_categories: cats };
            await apiPost('/api/ventures/apply-settings', { scope: 'all', settings });
            const fresh = await apiGet('/api/ventures');
            if (fresh) venturesList = fresh;
            showToast(`Added to ${category} in all ventures`);
        } catch (err) {
            showToast('Saved here, but failed to apply to all ventures: ' + (err.message || ''), true);
        }
    }
    renderWorkView(true);
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
    if (currentVenture.id) {
        try { await apiPost('/api/category', { venture_id: currentVenture.id, name: categoryName }); } catch (e) {}
    }
    renderWorkView(true);
}

async function deleteWorkCategory(categoryName) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    delete cats[categoryName];
    currentVenture.work_categories = cats;
    await logEdit('delete', 'work_category', categoryName, null, null);
    await saveVentureConfig();
    renderWorkView(true);
}

async function deleteWorkItem(category, itemId) {
    const cats = ensureWorkCategories(currentVenture.work_categories || WORK_CATEGORIES);
    cats[category] = cats[category].filter(i => i.id !== itemId);
    currentVenture.work_categories = cats;
    await logEdit('delete', 'work_item', itemId, null, null);
    await saveVentureConfig();
    renderWorkView(true);
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
    try {
        await apiDelete('/api/venture/' + encodeURIComponent(ventureId));
        venturesList = venturesList.filter(v => v.id !== ventureId);
        showToast('Venture deleted');
        renderVentureDashboard();
    } catch (err) {
        console.error('Failed to delete venture:', err);
        showToast('Delete failed — please retry', true);
    }
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
    const workCategories = ensureWorkCategories((currentVenture && currentVenture.work_categories) ? currentVenture.work_categories : WORK_CATEGORIES);
    const requiredKeys = [];

    floorsToCheck.forEach(floor => {
        const flatNumbers = [];
        for (let i = 1; i <= flatsPerFloor; i++) {
            flatNumbers.push((floor * 100) + i);
        }
        flatNumbers.forEach(flat => {
            Object.entries(workCategories).forEach(([category, items]) => {
                items.forEach(itemObj => {
                    requiredKeys.push(cacheKey(cellKeyById(currentBlock, floor, flat, itemObj.id)));
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
            // Work view items
            Object.entries(workCategories).forEach(([category, items]) => {
                items.forEach(itemObj => {
                    const cellId = cellKeyById(currentBlock, floor, flat, itemObj.id);
                    const cellData = cellsCache[cacheKey(cellId)];
                    const color = cellData?.color || 'red';
                    if (color !== 'green') {
                        rows.push({
                            floor: floors === 1 ? 'Ground' : `${floorLabels[floor - 1] || floor + 'th'}`,
                            flat: flat,
                            workItem: itemObj.label,
                            status: color,
                            statusLabel: COLOR_LABELS[color],
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

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Penguin OS - Pending Work Report</title>
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
            <h1>Penguin OS</h1>
            <p><strong>Pending Work Report</strong></p>
            <p>Venture: ${ventureName}${blockName ? ' | Block: ' + blockName : ''} | ${floorLabelText} — ${flatLabelText}</p>
        </div>
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

// Re-render on viewport resize crossing mobile/desktop threshold
(function() {
    var wasMobile = isMobileView();
    var resizeTimer = null;
    window.addEventListener('resize', function() {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            var isMob = isMobileView();
            if (isMob !== wasMobile) {
                wasMobile = isMob;
                if (currentView === 'work' && document.getElementById('trackerView') &&
                    document.getElementById('trackerView').style.display !== 'none') {
                    renderWorkView();
                }
            }
        }, 200);
    }, { passive: true });
})();
