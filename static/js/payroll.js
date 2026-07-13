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
    hideAllMainPanels();
    document.getElementById('payrollPanel').style.display = '';
    restorePanelState('payroll');
    payrollPanelMode = true;
    renderPayrollView();
    navigateTo('#/payroll');
}

function closePayrollPanel() {
    selectedPayrollVenture = null;
    payrollPanelMode = false;
    renderVentureDashboard();
    navigateTo('#/ventures');
}

var _ppb = document.getElementById('openPayrollBtn'); if (_ppb) _ppb.addEventListener('click', openPayrollPanel);
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
    const isPanel = payrollPanelMode;
    if (isPanel && !selectedPayrollVenture && venturesList.length > 0) {
        selectedPayrollVenture = venturesList[0];
    }
    const venture = payrollActiveVenture();
    const isAllMode = isPanel && !selectedPayrollVenture;
    const container = document.getElementById(isPanel ? 'payrollPanelContent' : 'payrollViewContainer');
    if (!container) return;

    // Preserve selected month on re-render; default to current month
    const existingMonthInput = document.getElementById('payrollMonthSelect');
    const currentMonth = existingMonthInput && existingMonthInput.value
        ? existingMonthInput.value
        : new Date().toISOString().slice(0, 7);

    container.innerHTML = '';

    if (!venture && !isAllMode) {
        container.innerHTML = '<div style="padding:24px;color:#999;">No venture selected.</div>';
        return;
    }

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

    // Release Payroll button (admin only)
    if (currentUserPermissions.releasePayroll && !isAllMode) {
        const releaseGroup = document.createElement('div');
        releaseGroup.className = 'pending-filter-group';
        releaseGroup.style.alignSelf = 'flex-end';
        releaseGroup.innerHTML = `<button id="payrollReleaseBtn" class="btn-primary" style="padding:8px 16px;">🔓 Release Payroll</button>`;
        headerBar.appendChild(releaseGroup);
    }

    container.appendChild(headerBar);

    // Load payroll data for the month
    console.log('[Payroll Load] key:', payrollSettingKey(currentMonth, venture));
    payrollData = await loadPayrollData(currentMonth, venture);
    console.log('[Payroll Load] result employees:', (payrollData.employees || []).length);

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
                    <td data-label="S.No">${idx + 1}</td>
                    <td data-label="Venture">${escapeHtml(emp.ventureName || '')}</td>
                    <td data-label="Name">${escapeHtml(emp.name)}</td>
                    <td data-label="Category">${escapeHtml(emp.category || '')}</td>
                    <td data-label="Base">${(parseFloat(emp.base) || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td data-label="Advance">${(parseFloat(emp.advance) || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td data-label="Net Pay">${netPay.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                `;
            } else {
                tr.innerHTML = `
                    <td data-label="S.No">${idx + 1}</td>
                    <td data-label="Name">${escapeHtml(emp.name)}</td>
                    <td data-label="Category">${escapeHtml(emp.category || '')}</td>
                    <td data-label="Base">${(parseFloat(emp.base) || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td data-label="Advance">${(parseFloat(emp.advance) || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td data-label="Net Pay">${netPay.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td data-label="Actions" style="text-align:center;">
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

    const releaseBtn = container.querySelector('#payrollReleaseBtn');
    if (releaseBtn) {
        releaseBtn.addEventListener('click', async () => {
            const monthSel = container.querySelector('#payrollMonthSelect');
            const month = monthSel ? monthSel.value : new Date().toISOString().slice(0, 7);
            showConfirm('Release Payroll', `Release payroll for ${month}?`, async () => {
                try {
                    const payrolls = await apiGet(`/api/payroll?venture_id=${encodeURIComponent(venture.id)}&month=${month}`);
                    if (!payrolls || payrolls.length === 0) {
                        showToast('No payroll entries found for this month', true);
                        return;
                    }
                    let released = 0;
                    let failed = 0;
                    for (const p of payrolls) {
                        if (p.status === 'pending') {
                            try {
                                await apiPost(`/api/payroll/${p.id}/release`, {});
                                released++;
                            } catch (err) {
                                failed++;
                            }
                        }
                    }
                    if (failed > 0) {
                        showToast(`Released ${released}, ${failed} failed`, true);
                    } else {
                        showToast(`Released ${released} payroll ${released === 1 ? 'entry' : 'entries'}`);
                    }
                    renderPayrollView();
                } catch (err) {
                    showToast('Failed to release payroll: ' + err.message, true);
                }
            });
        });
    }

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
                    showToast('Employee deleted');
                    try {
                        await savePayrollData(payrollMonthKey(), payrollData);
                        await renderPayrollView();
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
    try {
        const month = payrollMonthKey();
        const venture = payrollActiveVenture();
        console.log('[Payroll Save] key:', payrollSettingKey(month, venture), 'employees:', payrollData.employees.length);
        await savePayrollData(month, payrollData);
        console.log('[Payroll Save] API success');
        await renderPayrollView();
        const loadedCount = (payrollData.employees || []).length;
        console.log('[Payroll Render] loaded employees:', loadedCount);
        if (loadedCount === 0 && payrollData.employees.length === 0) {
            showToast('Employee saved but list is empty — check console', true);
        } else {
            showToast('Employee saved');
        }
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
