function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

function renderWorkCategoriesSettings() {
    const list = document.getElementById('workCategoriesList');
    if (!list) return;
    list.innerHTML = '';
    const cats = ensureWorkCategories(currentVenture && currentVenture.work_categories ? currentVenture.work_categories : WORK_CATEGORIES);
    Object.keys(cats).forEach((category, index) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.index = index;

        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '≡';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'work-item-name';
        nameSpan.contentEditable = true;
        nameSpan.textContent = category;
        nameSpan.addEventListener('blur', () => {
            const newName = nameSpan.textContent.trim();
            if (newName && newName !== category) {
                renameWorkCategory(category, newName);
            }
        });
        nameSpan.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                nameSpan.blur();
            }
        });

        const remove = document.createElement('button');
        remove.className = 'remove-btn';
        remove.innerHTML = '&times;';
        remove.title = 'Remove category';
        remove.addEventListener('click', () => {
            showConfirm('Delete Category', `Delete '${category}' and all its items?`, () => deleteWorkCategory(category));
        });

        li.appendChild(handle);
        li.appendChild(nameSpan);
        li.appendChild(remove);
        list.appendChild(li);
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
    renderWorkCategoriesSettings();
    renderSuperItemsSettings();
    els.settingsModal.classList.add('show');
}

function renderSuperItemsSettings() {
    const list = document.getElementById('superItemsList');
    if (!list) return;
    list.innerHTML = '';

    let items = ensureItemIds(currentVenture && currentVenture.super_structure_items ? currentVenture.super_structure_items : SUPER_STRUCTURE_ITEMS);
    items.forEach((item, index) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.index = index;

        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '≡';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'work-item-name';
        nameSpan.contentEditable = true;
        nameSpan.textContent = item.label;
        nameSpan.addEventListener('blur', () => {
            const newLabel = nameSpan.textContent.trim();
            if (newLabel && newLabel !== item.label) {
                item.label = newLabel;
            }
        });
        nameSpan.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); nameSpan.blur(); }
        });

        const remove = document.createElement('button');
        remove.className = 'remove-btn';
        remove.innerHTML = '&times;';
        remove.title = 'Remove';
        remove.addEventListener('click', () => {
            items.splice(index, 1);
            renderSuperItemsSettings();
        });

        li.appendChild(handle);
        li.appendChild(nameSpan);
        li.appendChild(remove);
        list.appendChild(li);

        li.addEventListener('dragstart', () => li.classList.add('dragging'));
        li.addEventListener('dragend', () => {
            li.classList.remove('dragging');
            const newItems = [];
            list.querySelectorAll('li').forEach(row => {
                const span = row.querySelector('.work-item-name');
                newItems.push({ id: 'ss_' + slugId(span.textContent.trim()) + '_' + Date.now(), label: span.textContent.trim() });
            });
            items = newItems;
            renderSuperItemsSettings();
        });
        li.addEventListener('dragover', (e) => {
            e.preventDefault();
            const dragging = list.querySelector('.dragging');
            if (!dragging || dragging === li) return;
            const siblings = [...list.querySelectorAll('li:not(.dragging)')];
            const next = siblings.find(s => {
                const rect = s.getBoundingClientRect();
                return e.clientY <= rect.top + rect.height / 2;
            });
            list.insertBefore(dragging, next || null);
        });
    });
}

function closeSettingsModal() {
    els.settingsModal.classList.remove('show');
}

els.settingsBtn.addEventListener('click', openSettingsModal);
els.closeSettings.addEventListener('click', closeSettingsModal);
els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) closeSettingsModal();
});

// Manage Users (admin password reset)
async function openManageUsersModal() {
    if (els.manageUsersMsg) els.manageUsersMsg.textContent = '';
    if (els.manageUsersPassword) els.manageUsersPassword.value = '';
    if (els.manageUsersConfirmPassword) els.manageUsersConfirmPassword.value = '';
    if (els.manageUsersSelect) {
        els.manageUsersSelect.innerHTML = '<option value="">Loading users...</option>';
        try {
            const users = await apiGet('/api/users');
            els.manageUsersSelect.innerHTML = '<option value="">Select a user</option>' +
                (users || []).map(u => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.email)} (${escapeHtml(u.role)})</option>`).join('');
        } catch (err) {
            els.manageUsersSelect.innerHTML = '<option value="">Failed to load users</option>';
        }
    }
    if (els.manageUsersModal) els.manageUsersModal.classList.add('show');
}

function closeManageUsersModal() {
    if (els.manageUsersModal) els.manageUsersModal.classList.remove('show');
}

if (els.manageUsersBtn) {
    els.manageUsersBtn.addEventListener('click', openManageUsersModal);
}
if (els.closeManageUsers) {
    els.closeManageUsers.addEventListener('click', closeManageUsersModal);
}
if (els.manageUsersCancel) {
    els.manageUsersCancel.addEventListener('click', closeManageUsersModal);
}
if (els.manageUsersModal) {
    els.manageUsersModal.addEventListener('click', (e) => {
        if (e.target === els.manageUsersModal) closeManageUsersModal();
    });
}
if (els.manageUsersSave) {
    els.manageUsersSave.addEventListener('click', async () => {
        const email = els.manageUsersSelect ? els.manageUsersSelect.value : '';
        const password = els.manageUsersPassword ? els.manageUsersPassword.value : '';
        const confirm = els.manageUsersConfirmPassword ? els.manageUsersConfirmPassword.value : '';
        if (!email) {
            if (els.manageUsersMsg) els.manageUsersMsg.textContent = 'Please select a user.';
            return;
        }
        if (password.length < 6) {
            if (els.manageUsersMsg) els.manageUsersMsg.textContent = 'Password must be at least 6 characters.';
            return;
        }
        if (password !== confirm) {
            if (els.manageUsersMsg) els.manageUsersMsg.textContent = 'Passwords do not match.';
            return;
        }
        try {
            const res = await apiPost('/api/users/change-password', { email, new_password: password });
            if (res && res.success) {
                if (els.manageUsersMsg) {
                    els.manageUsersMsg.style.color = '#27ae60';
                    els.manageUsersMsg.textContent = 'Password updated successfully.';
                }
                if (els.manageUsersPassword) els.manageUsersPassword.value = '';
                if (els.manageUsersConfirmPassword) els.manageUsersConfirmPassword.value = '';
                setTimeout(closeManageUsersModal, 1200);
            } else {
                if (els.manageUsersMsg) {
                    els.manageUsersMsg.style.color = '#c0392b';
                    els.manageUsersMsg.textContent = res.error || 'Failed to update password.';
                }
            }
        } catch (err) {
            if (els.manageUsersMsg) {
                els.manageUsersMsg.style.color = '#c0392b';
                els.manageUsersMsg.textContent = err.message || 'Failed to update password.';
            }
        }
    });
}

els.addWorkItemBtn.addEventListener('click', () => {
    workItems.push('New Work Item');
    openSettingsModal();
});

const addSuperItemBtn = document.getElementById('addSuperItemBtn');
if (addSuperItemBtn) {
    addSuperItemBtn.addEventListener('click', () => {
        const items = ensureItemIds(currentVenture && currentVenture.super_structure_items ? currentVenture.super_structure_items : SUPER_STRUCTURE_ITEMS);
        items.push({ id: 'ss_new_item_' + Date.now(), label: 'New Super Structure Item' });
        currentVenture.super_structure_items = items;
        renderSuperItemsSettings();
    });
}

if (els.addBlockBtn) {
    els.addBlockBtn.addEventListener('click', () => {
        if (!currentVenture) return;
        const nextId = String.fromCharCode(65 + (currentVenture.blocks.length || 0));
        currentVenture.blocks.push({ id: nextId, name: `${nextId} Block`, floors: 5, flats_per_floor: 6 });
        renderBlocksSettings();
    });
}

const settingsCategoryInput = document.getElementById('addWorkCategoryInput');
const settingsCategoryBtn = document.getElementById('addWorkCategoryBtn');
if (settingsCategoryBtn && settingsCategoryInput) {
    const submitCategory = () => {
        const val = settingsCategoryInput.value.trim();
        if (val) {
            addWorkCategory(val);
            settingsCategoryInput.value = '';
            setTimeout(renderWorkCategoriesSettings, 50);
        }
    };
    settingsCategoryBtn.addEventListener('click', submitCategory);
    settingsCategoryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitCategory();
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
    // Save work categories changes (rename/delete already save inline; this captures any pending state)
    if (currentVenture) {
        await saveVentureConfig();
    }
    // Save venture blocks changes
    if (currentVenture) {
        await saveVentureConfig();
        // Refresh block tabs if visible
        renderBlockTabs();
    }
    // Save super structure items from DOM
    if (currentVenture) {
        const superList = document.getElementById('superItemsList');
        if (superList) {
            const superItems = [];
            superList.querySelectorAll('li').forEach(row => {
                const span = row.querySelector('.work-item-name');
                const label = span.textContent.trim();
                if (label) superItems.push({ id: 'ss_' + slugId(label) + '_' + Date.now(), label });
            });
            currentVenture.super_structure_items = superItems;
            await saveVentureConfig();
        }
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
    hideAllMainPanels();
    document.getElementById('venturesDashboard').style.display = '';

    // KPI summary cards
    const kpiRow = document.getElementById('ventureKpiRow');
    if (kpiRow) {
        kpiRow.innerHTML = '';
        const totalBlocks = venturesList.reduce((s, v) => s + (v.blocks ? v.blocks.length : 0), 0);
        const totalUnits = venturesList.reduce((s, v) => s + (v.blocks ? v.blocks.reduce((bs, b) => bs + (b.floors || 1) * (b.flats_per_floor || 1), 0) : 0), 0);
        const totalWorkItems = venturesList.reduce((s, v) => s + (v.flat_view_items ? v.flat_view_items.length : 0), 0);

        const kpis = [
            { icon: 'AV', iconClass: 'blue', label: 'Active Ventures', value: venturesList.length, sub: totalBlocks + ' blocks total' },
            { icon: 'TU', iconClass: 'green', label: 'Total Units', value: totalUnits.toLocaleString(), sub: 'across all ventures' },
            { icon: 'WI', iconClass: 'amber', label: 'Work Items', value: totalWorkItems, sub: 'tracking categories' },
            { icon: 'BL', iconClass: 'dark', label: 'Blocks', value: totalBlocks, sub: 'under construction' },
        ];
        kpis.forEach(k => {
            const card = document.createElement('div');
            card.className = 'kpi-card';
            card.innerHTML = `
                <div class="kpi-icon ${k.iconClass}">${k.icon}</div>
                <div class="kpi-label">${k.label}</div>
                <div class="kpi-value">${k.value}</div>
                <div class="kpi-sub">${k.sub}</div>
            `;
            kpiRow.appendChild(card);
        });
    }

    const grid = document.getElementById('ventureCards');
    grid.innerHTML = '';

    venturesList.forEach(venture => {
        const card = document.createElement('div');
        card.className = 'venture-card';

        // Compute progress from cellsCache if available
        let completed = 0, total = 0;
        if (venture.blocks) {
            venture.blocks.forEach(b => {
                for (let f = 1; f <= (b.floors || 1); f++) {
                    for (let flat = 1; flat <= (b.flats_per_floor || 1); flat++) {
                        const flatNum = ((f - 1) * (b.flats_per_floor || 1) + flat).toString().padStart(3, '0');
                        const cellId = `${venture.id}|${b.id}|${f}|${flatNum}`;
                        const cell = cellsCache[cellId];
                        total++;
                        if (cell && cell.color === 'green') completed++;
                    }
                }
            });
        }
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

        const body = document.createElement('div');
        body.className = 'vc-body';

        const title = document.createElement('h3');
        title.textContent = venture.name;
        body.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'vc-meta';
        const blockCount = venture.blocks ? venture.blocks.length : 0;
        const unitCount = venture.blocks ? venture.blocks.reduce((s, b) => s + (b.floors || 1) * (b.flats_per_floor || 1), 0) : 0;
        meta.innerHTML = `<span class="vc-badge blue">${blockCount} blocks</span><span class="vc-badge green">${unitCount} units</span>`;
        body.appendChild(meta);

        const blocksDiv = document.createElement('div');
        blocksDiv.className = 'vc-blocks';
        blocksDiv.textContent = venture.blocks ? venture.blocks.map(b => b.name || b.id).join(', ') : '';
        body.appendChild(blocksDiv);

        // Progress bar
        const progress = document.createElement('div');
        progress.className = 'vc-progress';
        progress.innerHTML = `
            <div class="vc-progress-bar"><div class="vc-progress-fill" style="width:${pct}%"></div></div>
            <div class="vc-progress-text"><span>Progress</span><span>${pct}%</span></div>
        `;
        body.appendChild(progress);

        card.appendChild(body);

        const cardEdit = document.createElement('div');
        cardEdit.className = 'edit-controls';
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
    // Quick Reports panel removed; main nav buttons are the primary access.
    return;
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
                requiredKeys.push(cacheKey(cellKeyById(currentBlock, homeQuickReportFloor, flat, itemObj.id)));
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
                const cellId = cellKeyById(currentBlock, homeQuickReportFloor, flat, itemObj.id);
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

    // Work categories report
    const categorySummary = {};
    workRows.forEach(row => {
        if (!categorySummary[row.category]) {
            categorySummary[row.category] = { red: 0, yellow: 0, blue: 0, green: 0, none: 0, total: 0 };
        }
        categorySummary[row.category][row.color]++;
        categorySummary[row.category].total++;
    });

    const detailsHeading = document.createElement('h4');
    detailsHeading.style.margin = '16px 0 8px';
    detailsHeading.style.color = '#1a2a6c';
    detailsHeading.textContent = 'Work Categories Report';
    container.appendChild(detailsHeading);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    const table = document.createElement('table');
    table.className = 'tracker-table pending-table';
    table.innerHTML = '<thead><tr><th>Category</th><th>Total</th><th>Completed</th><th>In Progress</th><th>Patch Work</th><th>Yet to Start</th><th>Not Started</th><th>Completion %</th></tr></thead>';
    const tbody = document.createElement('tbody');
    const categories = Object.keys(categorySummary).sort();
    if (categories.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;padding:24px;">No work categories found</td></tr>';
    } else {
        categories.forEach(cat => {
            const summary = categorySummary[cat];
            const completedPct = summary.total > 0 ? ((summary.green / summary.total) * 100).toFixed(1) : '0.0';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHtml(cat)}</strong></td>
                <td>${summary.total}</td>
                <td><span class="dot" style="background:${getColorHex('green')};"></span> ${summary.green}</td>
                <td><span class="dot" style="background:${getColorHex('yellow')};"></span> ${summary.yellow}</td>
                <td><span class="dot" style="background:${getColorHex('blue')};"></span> ${summary.blue}</td>
                <td><span class="dot" style="background:${getColorHex('red')};"></span> ${summary.red}</td>
                <td><span class="dot" style="background:#ccc;"></span> ${summary.none}</td>
                <td><strong>${completedPct}%</strong></td>
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

    hideAllMainPanels();
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

    // Render admin/manager widgets if venture is open
    const leakageWidget = document.getElementById('materialLeakageWidget');
    if (leakageWidget && currentUserPermissions.viewMaterialLeakage && currentVenture.id) {
        leakageWidget.style.display = '';
        renderMaterialLeakageWidget(leakageWidget, currentVenture.id);
    } else if (leakageWidget) {
        leakageWidget.style.display = 'none';
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
    const lw = document.getElementById('materialLeakageWidget');
    if (lw) lw.style.display = 'none';
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
// Admin Panel Functions
// ========================

function hideAllMainPanels() {
    ['venturesDashboard', 'invoicesPanel', 'poPanel', 'reportsPanel', 'payrollPanel', 'inventoryPanel',
     'instantReportsPanel', 'inventoryAuditPanel',
     'expenditurePanel', 'designGeneratorPanel', 'stockPurchasesPanel', 'trackerView'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const bc = document.getElementById('breadcrumbBar');
    if (bc) bc.style.display = 'none';
}

function openInstantReportsPanel() {
    hideAllMainPanels();
    document.getElementById('instantReportsPanel').style.display = '';
    renderInstantReports();
    navigateTo('#/instant-reports');
}

function closeInstantReportsPanel() {
    renderVentureDashboard();
    navigateTo('#/ventures');
}

function openInventoryAuditPanel() {
    hideAllMainPanels();
    document.getElementById('inventoryAuditPanel').style.display = '';
    renderInventoryAudit();
    navigateTo('#/inventory-audit');
}

function closeInventoryAuditPanel() {
    renderVentureDashboard();
    navigateTo('#/ventures');
}


function openReportsPanel() {
    hideAllMainPanels();
    document.getElementById('reportsPanel').style.display = '';
    renderReportsPanel();
    navigateTo('#/reports');
}

function closeReportsPanel() {
    renderVentureDashboard();
    navigateTo('#/ventures');
}

function openExpenditurePanel() {
    hideAllMainPanels();
    document.getElementById('expenditurePanel').style.display = '';
    renderExpenditureView();
    navigateTo('#/expenditure');
}

function closeExpenditurePanel() {
    renderVentureDashboard();
    navigateTo('#/ventures');
}

function openDesignGeneratorPanel() {
    hideAllMainPanels();
    document.getElementById('designGeneratorPanel').style.display = '';
    renderDesignGeneratorHistory();
    navigateTo('#/design-generator');
}

function closeDesignGeneratorPanel() {
    stopDesignPolling();
    renderVentureDashboard();
    navigateTo('#/ventures');
}

function openStockPurchasesPanel() {
    hideAllMainPanels();
    document.getElementById('stockPurchasesPanel').style.display = '';
    renderStockPurchases();
    navigateTo('#/stock-purchases');
}

function closeStockPurchasesPanel() {
    renderVentureDashboard();
    navigateTo('#/ventures');
}

// Bootstrap — must be last
init();
