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
        li.dataset.category = category;
        li.style.flexDirection = 'column';
        li.style.alignItems = 'stretch';

        // --- Category header row (drag to reorder categories) ---
        const catRow = document.createElement('div');
        catRow.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;';

        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '≡';

        const toggle = document.createElement('span');
        toggle.className = 'work-cat-toggle';
        toggle.textContent = '\u25B6';
        toggle.style.cssText = 'cursor:pointer;font-size:0.7rem;color:#999;user-select:none;width:14px;';

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
            showConfirm('Delete Category', `Delete '${category}' and all its items?`, () => deleteWorkCategory(category), null, 'Delete', true);
        });

        catRow.appendChild(handle);
        catRow.appendChild(toggle);
        catRow.appendChild(nameSpan);
        catRow.appendChild(remove);
        li.appendChild(catRow);

        // --- Items sub-list (collapsible, drag to reorder items) ---
        const items = cats[category] || [];
        const subList = document.createElement('ul');
        subList.className = 'work-cat-items-list';
        subList.style.cssText = 'display:none;list-style:none;margin:4px 0 4px 28px;padding:0;width:calc(100% - 28px);';

        items.forEach((item, itemIdx) => {
            const itemLi = document.createElement('li');
            itemLi.draggable = true;
            itemLi.dataset.itemId = item.id;
            itemLi.dataset.itemIndex = itemIdx;
            itemLi.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #f0f2f5;background:#f9fafb;cursor:grab;';

            const itemHandle = document.createElement('span');
            itemHandle.className = 'drag-handle';
            itemHandle.textContent = '≡';
            itemHandle.style.fontSize = '0.85rem';

            const itemName = document.createElement('span');
            itemName.className = 'work-item-name';
            itemName.contentEditable = true;
            itemName.textContent = item.label;
            itemName.style.fontSize = '0.82rem';
            itemName.addEventListener('blur', () => {
                const newLabel = itemName.textContent.trim();
                if (newLabel && newLabel !== item.label) {
                    renameWorkItem(category, item.id, newLabel);
                }
            });
            itemName.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); itemName.blur(); }
            });

            const itemRemove = document.createElement('button');
            itemRemove.className = 'remove-btn';
            itemRemove.innerHTML = '&times;';
            itemRemove.title = 'Remove item';
            itemRemove.style.fontSize = '0.8rem';
            itemRemove.addEventListener('click', () => {
                deleteWorkItemFromSettings(category, item.id);
            });

            itemLi.appendChild(itemHandle);
            itemLi.appendChild(itemName);
            itemLi.appendChild(itemRemove);
            subList.appendChild(itemLi);

            // Drag-and-drop for items within this category
            itemLi.addEventListener('dragstart', () => itemLi.classList.add('dragging'));
            itemLi.addEventListener('dragend', () => {
                itemLi.classList.remove('dragging');
                syncWorkCategoryItemsFromDOM(category, subList);
            });
            itemLi.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragging = subList.querySelector('.dragging');
                if (!dragging || dragging === itemLi) return;
                const siblings = [...subList.querySelectorAll('li:not(.dragging)')];
                const next = siblings.find(s => {
                    const rect = s.getBoundingClientRect();
                    return e.clientY <= rect.top + rect.height / 2;
                });
                subList.insertBefore(dragging, next || null);
            });
        });

        // "Add item" row at the bottom of the sub-list
        const addItemRow = document.createElement('div');
        addItemRow.style.cssText = 'display:flex;gap:6px;padding:6px 10px;align-items:center;';
        const addItemInput = document.createElement('input');
        addItemInput.type = 'text';
        addItemInput.placeholder = '+ Add work description...';
        addItemInput.style.cssText = 'flex:1;padding:4px 8px;font-size:0.8rem;border:1px solid #ddd;border-radius:4px;';
        const addItemBtn = document.createElement('button');
        addItemBtn.textContent = 'Add';
        addItemBtn.className = 'btn-secondary';
        addItemBtn.style.cssText = 'padding:4px 10px;font-size:0.78rem;';
        const doAdd = () => {
            const val = addItemInput.value.trim();
            if (val) {
                addWorkItemToCategory(category, val);
                addItemInput.value = '';
            }
        };
        addItemBtn.addEventListener('click', doAdd);
        addItemInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
        addItemRow.appendChild(addItemInput);
        addItemRow.appendChild(addItemBtn);
        subList.appendChild(addItemRow);

        li.appendChild(subList);

        // Toggle expand/collapse
        toggle.addEventListener('click', () => {
            const isExpanded = subList.style.display !== 'none';
            subList.style.display = isExpanded ? 'none' : '';
            toggle.textContent = isExpanded ? '\u25B6' : '\u25BC';
        });

        // Prevent category drag from triggering when interacting with items
        subList.addEventListener('dragstart', (e) => e.stopPropagation());

        list.appendChild(li);
    });
}

// Sync reordered items from DOM into currentVenture.work_categories
function syncWorkCategoryItemsFromDOM(category, subList) {
    const cats = ensureWorkCategories(currentVenture && currentVenture.work_categories ? currentVenture.work_categories : WORK_CATEGORIES);
    if (!cats[category]) return;
    const newItems = [];
    subList.querySelectorAll('li').forEach(row => {
        const nameSpan = row.querySelector('.work-item-name');
        const label = nameSpan ? nameSpan.textContent.trim() : '';
        if (!label) return;
        const itemId = row.dataset.itemId;
        if (itemId) {
            newItems.push({ id: itemId, label });
        } else {
            newItems.push({ id: `item_${slugId(category)}_${slugId(label)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label });
        }
    });
    cats[category] = newItems;
    if (currentVenture) {
        currentVenture.work_categories = cats;
        saveVentureConfig();
    }
}

// Add a new work item to a category
async function addWorkItemToCategory(category, label) {
    const cats = ensureWorkCategories(currentVenture && currentVenture.work_categories ? currentVenture.work_categories : WORK_CATEGORIES);
    const resolvedCategory = _resolveCategoryKey(cats, category);
    if (!resolvedCategory) {
        showToast('Category not found: ' + category, true);
        return;
    }
    const existing = cats[resolvedCategory].find(i => i.label.toLowerCase() === label.toLowerCase());
    if (existing) {
        showToast(`'${label}' already exists in ${resolvedCategory}`, true);
        return;
    }
    const newItem = { id: `item_${slugId(resolvedCategory)}_${slugId(label)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label };
    cats[resolvedCategory].push(newItem);
    if (currentVenture) {
        currentVenture.work_categories = cats;
    }
    await saveVentureConfig();
    renderWorkCategoriesSettings();
    // Re-expand the category that was being edited
    setTimeout(() => {
        const list = document.getElementById('workCategoriesList');
        if (list) {
            const catLi = [...list.querySelectorAll('li')].find(li => li.dataset.category === resolvedCategory || li.dataset.category === category);
            if (catLi) {
                const toggle = catLi.querySelector('.work-cat-toggle');
                if (toggle && toggle.textContent === '\u25B6') toggle.click();
            }
        }
    }, 10);
}

// Delete a work item from a category (settings modal version)
async function deleteWorkItemFromSettings(category, itemId) {
    const cats = ensureWorkCategories(currentVenture && currentVenture.work_categories ? currentVenture.work_categories : WORK_CATEGORIES);
    const resolvedCategory = _resolveCategoryKey(cats, category);
    if (!resolvedCategory) return;
    cats[resolvedCategory] = cats[resolvedCategory].filter(i => i.id !== itemId);
    if (currentVenture) {
        currentVenture.work_categories = cats;
    }
    await saveVentureConfig();
    renderWorkCategoriesSettings();
    // Re-expand the category
    setTimeout(() => {
        const list = document.getElementById('workCategoriesList');
        if (list) {
            const catLi = [...list.querySelectorAll('li')].find(li => li.dataset.category === resolvedCategory || li.dataset.category === category);
            if (catLi) {
                const toggle = catLi.querySelector('.work-cat-toggle');
                if (toggle && toggle.textContent === '\u25B6') toggle.click();
            }
        }
    }, 10);
}

function openSettingsModal() {
    els.workItemsList.innerHTML = '';
    const items = ensureItemIds(workItems);
    workItems = items;
    items.forEach((item, index) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.index = index;
        li.dataset.id = item.id;

        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '≡';

        const input = document.createElement('span');
        input.className = 'work-item-name';
        input.contentEditable = true;
        input.textContent = item.label;
        input.addEventListener('blur', () => {
            const newLabel = input.textContent.trim() || item.label;
            const idx = workItems.findIndex(w => (typeof w === 'object' ? w.id : null) === item.id);
            if (idx >= 0) {
                workItems[idx] = { id: item.id, label: newLabel };
            }
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
            workItems = workItems.filter(w => (typeof w === 'object' ? w.id : null) !== item.id);
            openSettingsModal();
        });

        li.appendChild(handle);
        li.appendChild(input);
        li.appendChild(remove);
        els.workItemsList.appendChild(li);

        // Drag and drop
        li.addEventListener('dragstart', () => li.classList.add('dragging'));
        li.addEventListener('dragend', () => {
            li.classList.remove('dragging');
            const newItems = [];
            els.workItemsList.querySelectorAll('li').forEach(row => {
                const nameSpan = row.querySelector('.work-item-name');
                const label = nameSpan.textContent.trim();
                const rowId = row.dataset.id;
                if (rowId) {
                    newItems.push({ id: rowId, label });
                } else {
                    newItems.push({ id: `item_${slugId(label)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label });
                }
            });
            workItems = newItems.filter(w => w.label.length > 0);
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
    if (currentVenture) currentVenture.super_structure_items = items;
    items.forEach((item, index) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.index = index;
        li.dataset.id = item.id;

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
                if (currentVenture) currentVenture.super_structure_items = items;
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
            items = items.filter(it => it.id !== item.id);
            if (currentVenture) currentVenture.super_structure_items = items;
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
                const label = span.textContent.trim();
                if (!label) return;
                const rowId = row.dataset.id;
                if (rowId) {
                    newItems.push({ id: rowId, label });
                } else {
                    newItems.push({ id: `ss_${slugId(label)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label });
                }
            });
            items = newItems;
            if (currentVenture) currentVenture.super_structure_items = items;
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

// ========================
// User Management (expanded)
// ========================
let _editingUserId = null;
let _allVenturesForAssignment = [];
let _userVentureAssignments = [];

async function loadUsersList() {
    if (!els.userListContainer) return;
    try {
        const users = await apiGet('/api/users');
        if (!users || users.length === 0) {
            els.userListContainer.innerHTML = '<div style="padding:12px;color:#999;font-size:0.85rem;">No users found.</div>';
            return;
        }
        let html = '<table class="tracker-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Active</th><th>Ventures</th><th></th></tr></thead><tbody>';
        for (const u of users) {
            let ventures = 'All';
            try {
                const assigned = await apiGet('/api/users/' + u.id + '/ventures');
                if (assigned && assigned.length > 0) {
                    ventures = assigned.map(v => escapeHtml(v)).join(', ');
                }
            } catch (e) { /* ignore */ }
            const activeBadge = u.active
                ? '<span style="color:#27ae60;font-weight:600;">Yes</span>'
                : '<span style="color:#e74c3c;font-weight:600;">No</span>';
            html += `<tr>
                <td>${escapeHtml(u.email)}</td>
                <td>${escapeHtml(u.full_name || '-')}</td>
                <td>${escapeHtml(u.role)}</td>
                <td>${activeBadge}</td>
                <td style="font-size:0.8rem;">${ventures}</td>
                <td>
                    <button class="btn-text edit-user-btn" data-uid="${u.id}" style="font-size:0.78rem;">Edit</button>
                    <button class="btn-text deactivate-user-btn" data-uid="${u.id}" data-email="${escapeHtml(u.email)}" style="font-size:0.78rem;color:#c0392b;">${u.active ? 'Deactivate' : 'Activate'}</button>
                </td>
            </tr>`;
        }
        html += '</tbody></table>';
        els.userListContainer.innerHTML = html;
        els.userListContainer.querySelectorAll('.edit-user-btn').forEach(btn => {
            btn.addEventListener('click', () => editUser(btn.dataset.uid));
        });
        els.userListContainer.querySelectorAll('.deactivate-user-btn').forEach(btn => {
            btn.addEventListener('click', () => toggleUserActive(btn.dataset.uid, btn.dataset.email));
        });
    } catch (err) {
        els.userListContainer.innerHTML = '<div style="padding:12px;color:#c0392b;font-size:0.85rem;">Failed to load users.</div>';
    }
}

async function loadVenturesForAssignment() {
    try {
        _allVenturesForAssignment = await apiGet('/api/ventures/with-names') || [];
    } catch (e) {
        _allVenturesForAssignment = [];
    }
}

function renderVentureCheckboxes(selectedIds) {
    if (!els.ventureCheckboxList) return;
    let html = '';
    _allVenturesForAssignment.forEach(v => {
        const checked = selectedIds.includes(v.id) ? 'checked' : '';
        html += `<label style="display:block;padding:4px 0;font-size:0.85rem;"><input type="checkbox" value="${escapeHtml(v.id)}" ${checked} style="margin-right:6px;">${escapeHtml(v.name || v.id)}</label>`;
    });
    if (!_allVenturesForAssignment.length) {
        html = '<div style="color:#999;font-size:0.8rem;padding:4px;">No ventures available.</div>';
    }
    els.ventureCheckboxList.innerHTML = html;
}

async function editUser(userId) {
    const users = await apiGet('/api/users');
    const user = (users || []).find(u => u.id === userId);
    if (!user) return;
    _editingUserId = userId;
    els.userFormTitle.textContent = 'Edit User: ' + user.email;
    els.newUserEmail.value = user.email;
    els.newUserEmail.disabled = true;
    els.newUserFullName.value = user.full_name || '';
    els.newUserRole.value = user.role;
    els.newUserPassword.value = '';
    els.newUserPassword.disabled = true;
    els.newUserPassword.placeholder = 'Use Change Password section below';
    els.ventureAssignmentSection.style.display = '';
    els.changePasswordSection.style.display = '';
    els.manageUsersSave.textContent = 'Update User';
    try {
        _userVentureAssignments = await apiGet('/api/users/' + userId + '/ventures') || [];
    } catch (e) {
        _userVentureAssignments = [];
    }
    renderVentureCheckboxes(_userVentureAssignments);
    if (els.manageUsersMsg) { els.manageUsersMsg.textContent = ''; els.manageUsersMsg.style.color = '#c0392b'; }
}

function resetUserForm() {
    _editingUserId = null;
    els.userFormTitle.textContent = 'Create New User';
    els.newUserEmail.value = '';
    els.newUserEmail.disabled = false;
    els.newUserFullName.value = '';
    els.newUserPassword.value = '';
    els.newUserPassword.disabled = false;
    els.newUserPassword.placeholder = 'Min 6 characters';
    els.newUserRole.value = 'supervisor';
    els.ventureAssignmentSection.style.display = 'none';
    els.changePasswordSection.style.display = 'none';
    els.manageUsersSave.textContent = 'Save User';
    if (els.manageUsersPassword) els.manageUsersPassword.value = '';
    if (els.manageUsersConfirmPassword) els.manageUsersConfirmPassword.value = '';
    if (els.manageUsersMsg) { els.manageUsersMsg.textContent = ''; els.manageUsersMsg.style.color = '#c0392b'; }
}

async function toggleUserActive(userId, email) {
    const users = await apiGet('/api/users');
    const user = (users || []).find(u => u.id === userId);
    if (!user) return;
    if (user.active) {
        showConfirm('Deactivate User', `Deactivate ${email}? They will be logged out within 60 seconds.`, async () => {
            try {
                await apiPost('/api/users/' + userId, { active: false });
                showToast('User deactivated');
                loadUsersList();
            } catch (err) {
                showToast(err.message || 'Failed to deactivate', true);
            }
        }, null, 'Deactivate');
    } else {
        try {
            await apiPost('/api/users/' + userId, { active: true });
            showToast('User activated');
            loadUsersList();
        } catch (err) {
            showToast(err.message || 'Failed to activate', true);
        }
    }
}

async function openManageUsersModal() {
    resetUserForm();
    await loadVenturesForAssignment();
    await loadUsersList();
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
        if (els.manageUsersMsg) { els.manageUsersMsg.textContent = ''; els.manageUsersMsg.style.color = '#c0392b'; }
        const email = els.newUserEmail.value.trim();
        const fullName = els.newUserFullName.value.trim();
        const role = els.newUserRole.value;
        const password = els.newUserPassword.value;
        const changePwd = els.manageUsersPassword ? els.manageUsersPassword.value : '';
        const confirmPwd = els.manageUsersConfirmPassword ? els.manageUsersConfirmPassword.value : '';

        if (_editingUserId) {
            // Update existing user
            try {
                await apiPost('/api/users/' + _editingUserId, { full_name: fullName, role: role });
                // Venture assignments
                const checkedIds = Array.from(els.ventureCheckboxList.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
                await apiPost('/api/users/' + _editingUserId + '/ventures', { venture_ids: checkedIds });
                // Change password if provided
                if (changePwd) {
                    if (changePwd.length < 6) {
                        if (els.manageUsersMsg) els.manageUsersMsg.textContent = 'Password must be at least 6 characters.';
                        return;
                    }
                    if (changePwd !== confirmPwd) {
                        if (els.manageUsersMsg) els.manageUsersMsg.textContent = 'Passwords do not match.';
                        return;
                    }
                    await apiPost('/api/users/change-password', { email: email, new_password: changePwd });
                }
                if (els.manageUsersMsg) {
                    els.manageUsersMsg.style.color = '#27ae60';
                    els.manageUsersMsg.textContent = 'User updated successfully.';
                }
                setTimeout(() => { closeManageUsersModal(); loadUsersList(); }, 1000);
            } catch (err) {
                if (els.manageUsersMsg) els.manageUsersMsg.textContent = err.message || 'Failed to update user.';
            }
        } else {
            // Create new user
            if (!email) {
                if (els.manageUsersMsg) els.manageUsersMsg.textContent = 'Email is required.';
                return;
            }
            if (password.length < 6) {
                if (els.manageUsersMsg) els.manageUsersMsg.textContent = 'Password must be at least 6 characters.';
                return;
            }
            try {
                await apiPost('/api/users/create', { email, password, full_name: fullName, role });
                if (els.manageUsersMsg) {
                    els.manageUsersMsg.style.color = '#27ae60';
                    els.manageUsersMsg.textContent = 'User created successfully.';
                }
                setTimeout(() => { resetUserForm(); loadUsersList(); }, 1000);
            } catch (err) {
                if (els.manageUsersMsg) els.manageUsersMsg.textContent = err.message || 'Failed to create user.';
            }
        }
    });
}

els.addWorkItemBtn.addEventListener('click', () => {
    workItems.push({ id: `item_new_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label: 'New Work Item' });
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

// ========================
// Apply Changes Dialog
// ========================
let _pendingSettings = null;

function collectSettingsFromModal() {
    const settings = {};

    // Work Items — preserve existing IDs from DOM
    const newItems = [];
    els.workItemsList.querySelectorAll('li').forEach(row => {
        const nameSpan = row.querySelector('.work-item-name');
        const label = nameSpan.textContent.trim();
        if (!label) return;
        const rowId = row.dataset.id;
        if (rowId) {
            newItems.push({ id: rowId, label });
        } else {
            newItems.push({ id: `item_${slugId(label)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label });
        }
    });
    settings.flat_view_items = newItems;

    // Super Structure Items — preserve existing IDs from DOM
    const superList = document.getElementById('superItemsList');
    if (superList) {
        const superItems = [];
        superList.querySelectorAll('li').forEach(row => {
            const span = row.querySelector('.work-item-name');
            const label = span.textContent.trim();
            if (!label) return;
            const rowId = row.dataset.id;
            if (rowId) {
                superItems.push({ id: rowId, label });
            } else {
                superItems.push({ id: `ss_${slugId(label)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label });
            }
        });
        settings.super_structure_items = superItems;
    }

    // Work Categories — collect from DOM to capture category reorders AND item reorders
    const catList = document.getElementById('workCategoriesList');
    if (catList) {
        const orderedCats = {};
        const cats = ensureWorkCategories(currentVenture && currentVenture.work_categories ? currentVenture.work_categories : WORK_CATEGORIES);
        catList.querySelectorAll('li').forEach(row => {
            const nameSpan = row.querySelector('.work-item-name');
            const catName = nameSpan.textContent.trim();
            if (!catName) return;
            // Collect items from the sub-list in DOM order
            const subList = row.querySelector('.work-cat-items-list');
            if (subList && cats[catName]) {
                const orderedItems = [];
                subList.querySelectorAll('li').forEach(itemRow => {
                    const itemSpan = itemRow.querySelector('.work-item-name');
                    const label = itemSpan ? itemSpan.textContent.trim() : '';
                    if (!label) return;
                    const itemId = itemRow.dataset.itemId;
                    if (itemId) {
                        orderedItems.push({ id: itemId, label });
                    } else {
                        orderedItems.push({ id: `item_${slugId(catName)}_${slugId(label)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label });
                    }
                });
                orderedCats[catName] = orderedItems.length > 0 ? orderedItems : cats[catName];
            } else if (cats[catName]) {
                orderedCats[catName] = cats[catName];
            }
        });
        // Include any categories that might have been added but not yet rendered
        Object.keys(cats).forEach(k => {
            if (!orderedCats[k]) orderedCats[k] = cats[k];
        });
        settings.work_categories = orderedCats;
    } else if (currentVenture && currentVenture.work_categories) {
        settings.work_categories = currentVenture.work_categories;
    }

    // Blocks
    if (currentVenture && currentVenture.blocks) {
        settings.blocks = currentVenture.blocks;
    }

    return settings;
}

function populateApplyVentureSelect() {
    if (!els.applyVentureSelect) return;
    els.applyVentureSelect.innerHTML = '';
    (venturesList || []).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name || v.id;
        if (currentVenture && v.id === currentVenture.id) opt.selected = true;
        els.applyVentureSelect.appendChild(opt);
    });
}

function openApplyChangesModal() {
    _pendingSettings = collectSettingsFromModal();
    populateApplyVentureSelect();

    // Reset to default: selected venture
    const selectedRadio = document.querySelector('input[name="applyScope"][value="selected"]');
    if (selectedRadio) selectedRadio.checked = true;
    if (els.applyVenturePicker) els.applyVenturePicker.style.display = '';
    if (els.applyAllWarning) els.applyAllWarning.style.display = 'none';
    if (els.applyChangesMsg) { els.applyChangesMsg.textContent = ''; els.applyChangesMsg.style.color = '#c0392b'; }
    if (els.applyVentureSearch) els.applyVentureSearch.value = '';

    if (els.applyChangesModal) els.applyChangesModal.classList.add('show');
}

function closeApplyChangesModal() {
    if (els.applyChangesModal) els.applyChangesModal.classList.remove('show');
    _pendingSettings = null;
}

els.saveSettingsBtn.addEventListener('click', () => {
    // Sync work items from DOM into workItems and currentVenture — preserve IDs
    const newItems = [];
    els.workItemsList.querySelectorAll('li').forEach(row => {
        const nameSpan = row.querySelector('.work-item-name');
        const label = nameSpan.textContent.trim();
        if (!label) return;
        const rowId = row.dataset.id;
        if (rowId) {
            newItems.push({ id: rowId, label });
        } else {
            newItems.push({ id: `item_${slugId(label)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label });
        }
    });
    workItems = newItems;
    if (currentVenture) {
        currentVenture.flat_view_items = workItems;
    }
    // Sync super structure items from DOM into currentVenture — preserve IDs
    if (currentVenture) {
        const superList = document.getElementById('superItemsList');
        if (superList) {
            const superItems = [];
            superList.querySelectorAll('li').forEach(row => {
                const span = row.querySelector('.work-item-name');
                const label = span.textContent.trim();
                if (!label) return;
                const rowId = row.dataset.id;
                if (rowId) {
                    superItems.push({ id: rowId, label });
                } else {
                    superItems.push({ id: `ss_${slugId(label)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label });
                }
            });
            currentVenture.super_structure_items = superItems;
        }
    }
    // Open the Apply Changes dialog instead of saving immediately
    openApplyChangesModal();
});

// Radio toggle: show/hide venture picker and warning
document.querySelectorAll('input[name="applyScope"]').forEach(radio => {
    radio.addEventListener('change', () => {
        const isAll = radio.value === 'all';
        if (els.applyVenturePicker) els.applyVenturePicker.style.display = isAll ? 'none' : '';
        if (els.applyAllWarning) els.applyAllWarning.style.display = isAll ? 'block' : 'none';
    });
});

// Search filter for venture select
if (els.applyVentureSearch) {
    els.applyVentureSearch.addEventListener('input', () => {
        const q = els.applyVentureSearch.value.toLowerCase();
        [...els.applyVentureSelect.options].forEach(opt => {
            opt.style.display = opt.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    });
}

// Confirm button: apply settings
if (els.applyChangesConfirm) {
    els.applyChangesConfirm.addEventListener('click', async () => {
        if (!_pendingSettings) return;
        const scopeRadio = document.querySelector('input[name="applyScope"]:checked');
        const scope = scopeRadio ? scopeRadio.value : 'selected';

        if (scope === 'all') {
            // Confirmation for global change — require typed confirmation
            showConfirm('Apply to ALL Ventures',
                'This will overwrite configuration for ALL ventures. This cannot be undone. Type APPLY TO ALL to confirm.',
                async () => {
                    await doApplySettings('all', null);
                }, 'APPLY TO ALL', 'Apply to All', true);
        } else {
            const ventureId = els.applyVentureSelect ? els.applyVentureSelect.value : '';
            if (!ventureId) {
                if (els.applyChangesMsg) els.applyChangesMsg.textContent = 'Please select a venture.';
                return;
            }
            await doApplySettings('selected', ventureId);
        }
    });
}

async function doApplySettings(scope, ventureId) {
    if (els.applyChangesMsg) { els.applyChangesMsg.textContent = 'Applying...'; els.applyChangesMsg.style.color = '#666'; }
    try {
        const body = { scope, settings: _pendingSettings };
        if (scope === 'selected') body.venture_id = ventureId;
        const res = await apiPost('/api/ventures/apply-settings', body);
        if (res && res.success) {
            if (els.applyChangesMsg) {
                els.applyChangesMsg.style.color = '#27ae60';
                els.applyChangesMsg.textContent = `Changes applied to ${res.updated || 1} venture(s).`;
            }
            // Update local cache
            if (scope === 'all') {
                // Reload ventures list
                const fresh = await apiGet('/api/ventures');
                if (fresh) venturesList = fresh;
            } else {
                // Update the specific venture in local list
                const idx = venturesList.findIndex(v => v.id === ventureId);
                if (idx >= 0) {
                    for (const key in _pendingSettings) {
                        venturesList[idx][key] = _pendingSettings[key];
                    }
                }
            }
            // If currentVenture was affected, update it too
            if (currentVenture) {
                const updated = venturesList.find(v => v.id === currentVenture.id);
                if (updated) {
                    currentVenture = updated;
                    // Re-sync workItems from updated venture data
                    if (currentVenture.flat_view_items) {
                        workItems = [...currentVenture.flat_view_items];
                    }
                }
            }
            setTimeout(() => {
                closeApplyChangesModal();
                closeSettingsModal();
                if (currentView === 'work') {
                    renderWorkView();
                } else if (currentView === 'super') {
                    renderSuperStructure();
                } else {
                    currentView = 'work';
                    renderWorkView();
                }
                renderBlockTabs();
            }, 800);
        } else {
            if (els.applyChangesMsg) {
                els.applyChangesMsg.style.color = '#c0392b';
                els.applyChangesMsg.textContent = (res && res.error) || 'Failed to apply changes.';
            }
        }
    } catch (err) {
        if (els.applyChangesMsg) {
            els.applyChangesMsg.style.color = '#c0392b';
            els.applyChangesMsg.textContent = err.message || 'Failed to apply changes.';
        }
    }
}

// Close/cancel handlers
if (els.closeApplyChanges) {
    els.closeApplyChanges.addEventListener('click', closeApplyChangesModal);
}
if (els.applyChangesCancel) {
    els.applyChangesCancel.addEventListener('click', closeApplyChangesModal);
}
if (els.applyChangesModal) {
    els.applyChangesModal.addEventListener('click', (e) => {
        if (e.target === els.applyChangesModal) closeApplyChangesModal();
    });
}

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
            if (currentView === 'work') {
                renderWorkView();
            } else if (currentView === 'super') {
                renderSuperStructure();
            } else {
                currentView = 'work';
                renderWorkView();
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
            if (currentView === 'work') {
                renderWorkView();
            } else if (currentView === 'super') {
                renderSuperStructure();
            } else {
                currentView = 'work';
                renderWorkView();
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
            currentView = 'work';
        }
        if (currentView === 'work') {
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

        const kpiIcons = {
            ventures: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4 8 4v14M9 21v-6h6v6M9 11h.01M15 11h.01"/></svg>',
            units: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>',
            work: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
            blocks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'
        };

        const kpis = [
            { svg: kpiIcons.ventures, iconClass: 'blue', label: 'Active Ventures', value: venturesList.length, sub: totalBlocks + ' blocks total' },
            { svg: kpiIcons.units, iconClass: 'green', label: 'Total Units', value: totalUnits.toLocaleString(), sub: 'across all ventures' },
            { svg: kpiIcons.work, iconClass: 'amber', label: 'Work Items', value: totalWorkItems, sub: 'tracking categories' },
            { svg: kpiIcons.blocks, iconClass: 'dark', label: 'Blocks', value: totalBlocks, sub: 'under construction' },
        ];
        kpis.forEach(k => {
            const card = document.createElement('div');
            card.className = 'kpi-card';
            card.innerHTML = `
                <div class="kpi-icon ${k.iconClass}">${k.svg}</div>
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
            const workCategories = venture.work_categories ? ensureWorkCategories(venture.work_categories) : null;
            venture.blocks.forEach(b => {
                for (let f = 1; f <= (b.floors || 1); f++) {
                    for (let flat = 1; flat <= (b.flats_per_floor || 1); flat++) {
                        const flatNum = (f * 100) + flat;
                        if (workCategories) {
                            Object.entries(workCategories).forEach(([_, items]) => {
                                items.forEach(itemObj => {
                                    const ck = `${venture.id}_${cellKeyById(b.id, f, flatNum, itemObj.id)}`;
                                    const cell = cellsCache[ck];
                                    total++;
                                    if (cell && cell.color === 'green') completed++;
                                });
                            });
                        }
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
            showConfirm('Delete Venture', `This will delete ALL data for ${venture.name}. Type venture name to confirm.`, () => deleteVenture(venture.id), venture.name, 'Delete', true);
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
                category: 'Work View',
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

// ========================
// Overview Page (cross-venture summary)
// ========================
let _overviewRendering = false;
async function renderOverviewPage() {
    if (_overviewRendering) return;
    _overviewRendering = true;
    hideAllMainPanels();
    const page = document.getElementById('overviewPage');
    if (!page) { _overviewRendering = false; return; }
    page.style.display = '';
    if (typeof setActiveNav === 'function') setActiveNav('sidebarOverview');

    // Show skeleton, hide content
    const skeleton = document.getElementById('overviewSkeleton');
    const content = document.getElementById('overviewContent');
    if (skeleton) skeleton.style.display = '';
    if (content) content.style.display = 'none';

    // Preload all cells across all ventures
    try {
        const allCells = await apiGet('/api/cells');
        if (allCells) {
            Object.assign(cellsCache, allCells);
            if (typeof _allCellsBulkLoaded !== 'undefined') _allCellsBulkLoaded = true;
        }
    } catch (e) {
        console.error('Failed to preload cells for overview:', e);
    }

    let totalCells = 0;
    const statusCounts = { red: 0, yellow: 0, blue: 0, green: 0, none: 0 };
    const totalBlocks = venturesList.reduce((s, v) => s + (v.blocks ? v.blocks.length : 0), 0);
    const totalUnits = venturesList.reduce((s, v) => s + (v.blocks ? v.blocks.reduce((bs, b) => bs + (b.floors || 1) * (b.flats_per_floor || 1), 0) : 0), 0);
    const totalWorkItems = venturesList.reduce((s, v) => {
        const cats = v.work_categories ? ensureWorkCategories(v.work_categories) : null;
        return s + (cats ? Object.values(cats).reduce((cs, items) => cs + items.length, 0) : 0);
    }, 0);
    const ventureProgress = [];

    venturesList.forEach(venture => {
        if (!venture.blocks) return;
        let vCompleted = 0, vTotal = 0;
        const vStatusCounts = { red: 0, yellow: 0, blue: 0, green: 0, none: 0 };
        const workCategories = venture.work_categories ? ensureWorkCategories(venture.work_categories) : null;

        venture.blocks.forEach(b => {
            for (let f = 1; f <= (b.floors || 1); f++) {
                for (let flat = 1; flat <= (b.flats_per_floor || 1); flat++) {
                    const flatNum = (f * 100) + flat;
                    if (workCategories) {
                        Object.entries(workCategories).forEach(([_, items]) => {
                            items.forEach(itemObj => {
                                const ck = `${venture.id}_${cellKeyById(b.id, f, flatNum, itemObj.id)}`;
                                const cell = cellsCache[ck];
                                const color = cell?.color || 'none';
                                statusCounts[color]++; vStatusCounts[color]++; totalCells++; vTotal++;
                                if (color === 'green') vCompleted++;
                            });
                        });
                    }
                }
            }
        });

        ventureProgress.push({
            name: venture.name,
            id: venture.id,
            pct: vTotal > 0 ? Math.round((vCompleted / vTotal) * 100) : 0,
            total: vTotal,
            completed: vCompleted,
            pending: vTotal - vCompleted
        });
    });

    const kpiIcons = {
        ventures: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4 8 4v14M9 21v-6h6v6M9 11h.01M15 11h.01"/></svg>',
        units: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>',
        work: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
        cells: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
        completed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    };

    // All data is ready — hide skeleton, show content
    if (skeleton) skeleton.style.display = 'none';
    if (content) content.style.display = '';

    const kpiRow = document.getElementById('overviewKpiRow');
    if (kpiRow) kpiRow.innerHTML = '';

    const kpis = [
        { svg: kpiIcons.ventures, c: 'blue', label: 'Active Ventures', value: venturesList.length, sub: totalBlocks + ' blocks' },
        { svg: kpiIcons.units, c: 'green', label: 'Total Units', value: totalUnits.toLocaleString(), sub: 'all ventures' },
        { svg: kpiIcons.work, c: 'amber', label: 'Work Items', value: totalWorkItems, sub: 'categories' },
        { svg: kpiIcons.cells, c: 'dark', label: 'Total Cells', value: totalCells.toLocaleString(), sub: 'tracked' },
        { svg: kpiIcons.completed, c: 'green', label: 'Completed', value: statusCounts.green.toLocaleString(), sub: `${totalCells ? Math.round((statusCounts.green / totalCells) * 100) : 0}% overall` },
        { svg: kpiIcons.pending, c: 'red', label: 'Yet to Start', value: statusCounts.red.toLocaleString(), sub: `${totalCells ? Math.round((statusCounts.red / totalCells) * 100) : 0}% overall` }
    ];
    kpis.forEach(k => {
        const card = document.createElement('div');
        card.className = 'overview-kpi-card';
        card.innerHTML = `<div class="ok-icon ${k.c}">${k.svg}</div><div class="ok-body"><div class="ok-label">${k.label}</div><div class="ok-value">${k.value}</div><div class="ok-sub">${k.sub}</div></div>`;
        kpiRow.appendChild(card);
    });

    const statusInfo = [
        { key: 'green', label: 'Completed', color: getColorHex('green') },
        { key: 'yellow', label: 'In Progress', color: getColorHex('yellow') },
        { key: 'blue', label: 'Patch Work', color: getColorHex('blue') },
        { key: 'red', label: 'Yet to Start', color: getColorHex('red') },
        { key: 'none', label: 'Not Started', color: '#ccc' }
    ];
    const pieData = statusInfo.filter(info => statusCounts[info.key] > 0);
    const hasPieData = totalCells > 0 && pieData.length > 0;

    // Build legend HTML with counts and percentages
    const pieLegendHtml = pieData.map(i => {
        const count = statusCounts[i.key];
        const pctVal = totalCells ? ((count / totalCells) * 100).toFixed(1) : '0.0';
        return `<div class="overview-legend-item" data-status="${i.key}" style="cursor:pointer;">
            <span class="overview-legend-dot" style="background:${i.color};"></span>
            <span class="overview-legend-label">${i.label}</span>
            <span class="overview-legend-count">${count}</span>
            <span class="overview-legend-pct">${pctVal}%</span>
        </div>`;
    }).join('');

    if (window.overviewPieChart && typeof window.overviewPieChart.destroy === 'function') { window.overviewPieChart.destroy(); }
    window.overviewPieChart = null;
    const pieCtx = document.getElementById('overviewPieChart');
    const pieEmpty = document.getElementById('overviewPieEmpty');
    if (pieCtx) {
        if (hasPieData) {
            pieCtx.style.display = '';
            if (pieEmpty) pieEmpty.style.display = 'none';
            window.overviewPieChart = new Chart(pieCtx, {
                type: 'doughnut',
                data: {
                    labels: pieData.map(i => i.label),
                    datasets: [{ data: pieData.map(i => statusCounts[i.key]), backgroundColor: pieData.map(i => i.color), borderWidth: 2, borderColor: '#fff', hoverOffset: 8 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '55%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: ctx => {
                                    const pct = totalCells ? ((ctx.parsed / totalCells) * 100).toFixed(1) : '0.0';
                                    return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                                }
                            }
                        }
                    },
                    onClick: (e, elements) => {
                        if (elements.length > 0) {
                            const idx = elements[0].index;
                            const statusKey = pieData[idx].key;
                            // Navigate to ventures dashboard for visual filtering
                            if (typeof renderVentureDashboard === 'function') renderVentureDashboard();
                        }
                    },
                    onHover: (e, elements) => {
                        e.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
                    }
                }
            });
            // Insert custom legend inside the chart card, below the wrap
            const chartCard = pieCtx.closest('.overview-chart-card');
            let legendEl = chartCard ? chartCard.querySelector('.overview-pie-legend') : null;
            if (!legendEl && chartCard) {
                legendEl = document.createElement('div');
                legendEl.className = 'overview-pie-legend';
                chartCard.appendChild(legendEl);
            }
            legendEl.innerHTML = pieLegendHtml;
            // Click legend item to go to dashboard
            legendEl.querySelectorAll('.overview-legend-item').forEach(item => {
                item.addEventListener('click', () => {
                    if (typeof renderVentureDashboard === 'function') renderVentureDashboard();
                });
            });
            // Show donut center overlay with total cells
            const donutCenter = document.getElementById('overviewDonutCenter');
            if (donutCenter) {
                donutCenter.innerHTML = `<div class="odc-value">${totalCells.toLocaleString()}</div><div class="odc-label">Total Cells</div>`;
                donutCenter.classList.add('show');
            }
        } else {
            pieCtx.style.display = 'none';
            if (pieEmpty) pieEmpty.style.display = '';
            const chartCard = pieCtx.closest('.overview-chart-card');
            const legendEl = chartCard ? chartCard.querySelector('.overview-pie-legend') : null;
            if (legendEl) legendEl.innerHTML = '';
            const donutCenter = document.getElementById('overviewDonutCenter');
            if (donutCenter) donutCenter.classList.remove('show');
        }
    }

    if (window.overviewBarChart && typeof window.overviewBarChart.destroy === 'function') { window.overviewBarChart.destroy(); }
    window.overviewBarChart = null;
    const barCtx = document.getElementById('overviewBarChart');
    const barEmpty = document.getElementById('overviewBarEmpty');
    if (barCtx) {
        if (ventureProgress.length > 0) {
            barCtx.style.display = '';
            if (barEmpty) barEmpty.style.display = 'none';
            window.overviewBarChart = new Chart(barCtx, {
                type: 'bar',
                data: {
                    labels: ventureProgress.map(v => v.name),
                    datasets: [{ label: 'Completion %', data: ventureProgress.map(v => v.pct), backgroundColor: '#f47521', borderRadius: 6, barThickness: 'flex', maxBarThickness: 32 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } },
                    plugins: { legend: { display: false }, tooltip: { 
                        callbacks: { 
                            label: ctx => {
                                const v = ventureProgress[ctx.dataIndex];
                                return [
                                    `Completion: ${v.pct}%`,
                                    `Completed: ${v.completed} / ${v.total}`,
                                    `Pending: ${v.pending}`
                                ];
                            }
                        }
                    } },
                    onClick: (e, elements) => {
                        if (elements.length > 0) {
                            const v = ventureProgress[elements[0].index];
                            if (v && v.id) {
                                const venture = venturesList.find(vent => vent.id === v.id);
                                if (venture && typeof openVenture === 'function') {
                                    openVenture(venture);
                                    navigateTo(buildTrackerRoute());
                                }
                            }
                        }
                    },
                    onHover: (e, elements) => {
                        e.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
                    }
                }
            });
        } else {
            barCtx.style.display = 'none';
            if (barEmpty) barEmpty.style.display = '';
        }
    }

    const vList = document.getElementById('overviewVentures');
    if (vList) {
        vList.innerHTML = '<h3>Venture Completion</h3>';
    }
    const list = document.createElement('div');
    list.className = 'overview-vlist';
    if (ventureProgress.length === 0) {
        list.innerHTML = '<div class="overview-vrow overview-vrow-empty"><span>No ventures available</span></div>';
    } else {
        ventureProgress.forEach(v => {
            const statusLabel = v.pct >= 75 ? 'On Track' : v.pct >= 40 ? 'At Risk' : 'Behind';
            const statusClass = v.pct >= 75 ? 'ov-status-good' : v.pct >= 40 ? 'ov-status-warn' : 'ov-status-bad';
            const barColor = v.pct >= 75 ? '#2ecc71' : v.pct >= 40 ? '#f1c40f' : '#e74c3c';
            const row = document.createElement('div');
            row.className = 'overview-vrow';
            row.style.cursor = 'pointer';
            row.innerHTML = `
                <div class="ov-row-header">
                    <span class="ov-name">${escapeHtml(v.name)}</span>
                    <div class="ov-header-right">
                        <span class="ov-status-badge ${statusClass}">${statusLabel}</span>
                        <span class="ov-pct" style="color:${barColor};">${v.pct}%</span>
                    </div>
                </div>
                <div class="ov-bar"><div class="ov-bar-fill" style="width:${v.pct}%;background:${barColor};"></div></div>
                <div class="ov-row-stats">
                    <span class="ov-stat ov-stat-total">Total: <strong>${v.total}</strong></span>
                    <span class="ov-stat ov-stat-green">Completed: <strong>${v.completed}</strong></span>
                    <span class="ov-stat ov-stat-red">Pending: <strong>${v.pending}</strong></span>
                </div>
            `;
            row.addEventListener('click', () => {
                const venture = venturesList.find(vent => vent.id === v.id);
                if (venture && typeof openVenture === 'function') {
                    openVenture(venture);
                    navigateTo(buildTrackerRoute());
                }
            });
            list.appendChild(row);
        });
    }
    if (vList) vList.appendChild(list);

    const waBtn = document.getElementById('shareDailyReportBtn');
    if (waBtn) {
        const canShareReport = currentUserRole === 'admin' || currentUserRole === 'manager';
        waBtn.style.display = canShareReport ? '' : 'none';
        if (canShareReport && !waBtn._bound) {
            waBtn.addEventListener('click', shareDailyReport);
            waBtn._bound = true;
        }
    }

    _overviewRendering = false;
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
    // Clear cell cache when switching ventures to ensure fresh data from DB
    if (currentVenture && currentVenture.id !== venture.id) {
        cellsCache = {};
    }
    currentVenture = venture;

    const requestedBlock = opts.block || (opts.blockId);
    currentBlockObj = requestedBlock
        ? (venture.blocks.find(b => b.id === requestedBlock) || venture.blocks[0])
        : venture.blocks[0];
    currentBlock = currentBlockObj.id;

    currentFloor = opts.floor ? parseInt(opts.floor) : 1;
    currentView = ['work', 'super'].includes(opts.view) ? opts.view : 'work';

    editMode = false;
    archivedItems = venture.archived || {};

    workItems = ensureItemIds([]);

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
    try {
        if (currentView === 'work') {
            await renderWorkView();
        } else if (currentView === 'super') {
            await renderSuperStructure();
        } else {
            currentView = 'work';
            await renderWorkView();
        }
    } catch (err) {
        console.error('Failed to render tracker view:', err);
        showToast('Failed to load work view — please refresh', true);
    }

    // Update sticky header offset after view renders
    if (window.updateTrackerStickyOffset) window.updateTrackerStickyOffset();
}

function exitToDashboard() {
    currentVenture = null;
    currentBlockObj = null;
    currentBlock = 'A';
    currentFloor = 1;
    cellsCache = {};
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
    const existing = venturesList.find(v => v.blocks && v.blocks.length > 0);
    if (existing) {
        wizardData = {
            blocks: [],
            workCategories: JSON.parse(JSON.stringify(existing.work_categories || WORK_CATEGORIES)),
            superItems: JSON.parse(JSON.stringify(existing.super_structure_items || SUPER_STRUCTURE_ITEMS))
        };
    } else {
        wizardData = {
            blocks: [],
            workCategories: JSON.parse(JSON.stringify(WORK_CATEGORIES)),
            superItems: [...SUPER_STRUCTURE_ITEMS]
        };
    }
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
                const label = typeof item === 'object' ? (item.label || '') : item;
                html += `<div class="wizard-item-row">
                    <input type="text" value="${label}" data-cat="${cat}" data-index="${i}">
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
            const label = typeof item === 'object' ? (item.label || '') : item;
            html += `<div class="wizard-item-row">
                <input type="text" value="${label}" data-index="${i}">
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
    const ventureId = generateId();
    const ts = Date.now();
    const superItems = wizardData.superItems.map((item, i) => {
        if (typeof item === 'object' && item.id) return item;
        const label = typeof item === 'string' ? item : (item && item.label) || 'Untitled';
        return { id: `ss_${slugId(label)}_${ts}_${i}`, label };
    });
    const workCats = {};
    Object.entries(wizardData.workCategories).forEach(([cat, items]) => {
        workCats[cat] = items.map((item, i) => {
            if (typeof item === 'object' && item.id) return item;
            const label = typeof item === 'string' ? item : (item && item.label) || 'Untitled';
            return { id: `item_${slugId(cat)}_${slugId(label)}_${ts}_${i}`, label };
        });
    });
    const newVenture = {
        id: ventureId,
        name: wizardData.name,
        created_by: currentUser,
        created_at: new Date().toISOString(),
        blocks: wizardData.blocks,
        work_categories: workCats,
        super_structure_items: superItems,
        archived: {}
    };
    venturesList.push(newVenture);
    try {
        await saveVenture(newVenture);
        showToast('Venture created successfully');
    } catch (err) {
        venturesList = venturesList.filter(v => v.id !== ventureId);
        showToast('Failed to create venture: ' + (err.message || err), true);
        return;
    }
    closeWizard();
    await loadVentures();
    renderVentureDashboard();
}

// ========================
// Admin Panel Functions
// ========================

function hideAllMainPanels() {
    ['venturesDashboard', 'overviewPage', 'invoicesPanel', 'poPanel', 'reportsPanel', 'payrollPanel', 'inventoryPanel',
     'ventureAnalysisPanel',
     'instantReportsPanel', 'inventoryAuditPanel',
     'expenditurePanel', 'designGeneratorPanel', 'contractorPaymentsPanel',
     'dayBookPanel', 'vendorDirPanel', 'trackerView'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const bc = document.getElementById('breadcrumbBar');
    if (bc) bc.style.display = 'none';
}

function openInstantReportsPanel() {
    hideAllMainPanels();
    document.getElementById('instantReportsPanel').style.display = '';
    if (typeof renderInstantReports === 'function') renderInstantReports();
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

function openDayBookPanel() {
    hideAllMainPanels();
    var panel = document.getElementById('dayBookPanel');
    if (panel) panel.style.display = '';
    renderDayBookView();
    navigateTo('#/day-book');
}

function closeDayBookPanel() {
    renderVentureDashboard();
    navigateTo('#/ventures');
}

function openVendorDirPanel() {
    hideAllMainPanels();
    var panel = document.getElementById('vendorDirPanel');
    if (panel) panel.style.display = '';
    if (typeof renderVendorDirectoryView === 'function') renderVendorDirectoryView();
    navigateTo('#/vendors');
}

function closeVendorDirPanel() {
    renderVentureDashboard();
    navigateTo('#/ventures');
}

function openInventoryRegisterPanel() {
    hideAllMainPanels();
    var panel = document.getElementById('inventoryPanel');
    if (panel) panel.style.display = '';
    if (typeof selectedInventoryVenture !== 'undefined' && !selectedInventoryVenture) {
        selectedInventoryVenture = { id: 'WAREHOUSE', name: 'Central Warehouse' };
    }
    if (typeof renderInventoryView === 'function') renderInventoryView();
    else if (typeof renderInventoryRegisterView === 'function') renderInventoryRegisterView();
    navigateTo('#/inventory');
}

function closeInventoryRegisterPanel() {
    if (typeof selectedInventoryVenture !== 'undefined') selectedInventoryVenture = null;
    renderVentureDashboard();
    navigateTo('#/ventures');
}

// Bootstrap — must be last
init();
