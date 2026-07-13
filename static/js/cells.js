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
        const params = new URLSearchParams();
        if (currentVenture && currentVenture.id) params.set('venture_id', currentVenture.id);
        if (currentBlock) params.set('block', currentBlock);
        if (currentFloor !== null && currentFloor !== undefined) params.set('floor', String(currentFloor));
        const qs = params.toString();
        const allCells = await apiGet(`/api/cells${qs ? '?' + qs : ''}`);
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
    document.getElementById('flatViewContainer').style.display = '';
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

    // Show skeleton placeholders while fetching
    const skeletonRowCount = Math.min(activeItems.length, 8);
    for (let s = 0; s < skeletonRowCount; s++) {
        const skRow = document.createElement('tr');
        const skWork = document.createElement('td');
        skWork.className = 'work-cell';
        const skLine = document.createElement('div');
        skLine.className = 'skeleton skeleton-line';
        skLine.style.width = '60%';
        skWork.appendChild(skLine);
        skRow.appendChild(skWork);
        for (let f = 0; f < flatNumbers.length; f++) {
            const skTd = document.createElement('td');
            const skCell = document.createElement('div');
            skCell.className = 'skeleton skeleton-cell';
            skTd.appendChild(skCell);
            skRow.appendChild(skTd);
        }
        const skRemarks = document.createElement('td');
        skRemarks.className = 'remarks-col';
        const skRemLine = document.createElement('div');
        skRemLine.className = 'skeleton skeleton-line';
        skRemLine.style.width = '80%';
        skRemarks.appendChild(skRemLine);
        skRow.appendChild(skRemarks);
        els.gridBody.appendChild(skRow);
    }

    await ensureCellsInCache(requiredKeys);

    // Clear skeleton before rendering real content
    els.gridBody.innerHTML = '';

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
    container.style.display = '';
    container.innerHTML = '';

    const flatsPerFloor = currentBlockObj ? (currentBlockObj.flats_per_floor || FLATS_PER_FLOOR) : FLATS_PER_FLOOR;
    const flatNumbers = [];
    for (let i = 1; i <= flatsPerFloor; i++) {
        flatNumbers.push((currentFloor * 100) + i);
    }

    const workCategories = ensureWorkCategories((currentVenture && currentVenture.work_categories) ? currentVenture.work_categories : WORK_CATEGORIES);
    const categoryNames = Object.keys(workCategories);

    // Category chip bar (non-edit mode only)
    if (!editMode && categoryNames.length > 1) {
        const chipBar = document.createElement('div');
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

    Object.entries(workCategories).forEach(([cat, items]) => {
        const catFlats = CATEGORY_FLATS[cat] || flatNumbers;
        queueKeys(cat, items, catFlats);
    });
    await ensureCellsInCache(requiredKeys);

    // Render all category sections
    Object.entries(workCategories).forEach(([category, items]) => {
        const catFlats = CATEGORY_FLATS[category] || flatNumbers;
        const sectionEl = createSectionTable(category, items, catFlats);
        sectionEl.dataset.category = category;
        container.appendChild(sectionEl);
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
            controls.querySelector('[title="Delete"]').addEventListener('click', () => showConfirm('Delete Item', `Delete '${itemObj.label}' from ${category}?`, () => deleteWorkItem(category, itemObj.id)));
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

    // Keep flat_view_items in sync so flat view shows the same label
    if (currentVenture.flat_view_items && currentVenture.flat_view_items.length > 0) {
        currentVenture.flat_view_items = currentVenture.flat_view_items.map(fi => {
            if (typeof fi === 'string') return fi === old ? newLabel : fi;
            if (fi && fi.label === old) return { ...fi, label: newLabel };
            return fi;
        });
    }

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
    if (currentVenture.id) {
        try { await apiPost('/api/category', { venture_id: currentVenture.id, name: categoryName }); } catch (e) {}
    }
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
                    const cellId = cellKeyById(currentBlock, floor, flat, itemObj.id);
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
