// ========================
// Attendance View (replaces Payroll)
// Fields: name, role, base salary, present days, absent days, outstanding amount
// Uses normalized `attendance` table via /api/attendance
// Supports "All Ventures" mode: selectedAttendanceVenture=null means all ventures
// ========================
let attendanceData = [];
let selectedAttendanceVenture = null;  // null = "All Ventures", object = specific venture
let attendancePanelMode = false;
let attendanceEditingRowId = null;

// Backward-compat alias for any legacy callers
function openPayrollPanel() { return openAttendancePanel(); }

// Backward-compat stubs for old payroll modal functions (no longer used -
// renderHomePayroll in features.js is dead code, but these prevent
// ReferenceErrors if that code is ever reached)
function openPayrollEmpModal(existing) {
    console.warn('openPayrollEmpModal is deprecated - use openAttendanceEmpModal instead');
    if (typeof openAttendanceEmpModal === 'function') openAttendanceEmpModal(existing);
}
function openPayrollHistoryModal() {
    console.warn('openPayrollHistoryModal is deprecated - payroll history is no longer available');
}

function openAttendancePanel() {
    hideAllMainPanels();
    const panel = document.getElementById('payrollPanel');
    if (panel) panel.style.display = '';
    restorePanelState('payroll');
    attendancePanelMode = true;
    // Default to "All Ventures" (null) when opening the panel
    if (!selectedAttendanceVenture) {
        selectedAttendanceVenture = null;
    }
    renderAttendanceView();
    navigateTo('#/attendance');
}

function closeAttendancePanel() {
    selectedAttendanceVenture = null;
    attendancePanelMode = false;
    renderVentureDashboard();
    navigateTo('#/ventures');
}

document.getElementById('backFromPayroll').addEventListener('click', closeAttendancePanel);

function attendanceMonthKey() {
    const monthInput = document.getElementById('attendanceMonthSelect') || document.getElementById('payrollMonthSelect');
    return monthInput ? monthInput.value : new Date().toISOString().slice(0, 7);
}

function attendanceActiveVenture() {
    if (attendancePanelMode) return selectedAttendanceVenture;
    return currentVenture;
}

function attendanceIsAllVentures() {
    return attendancePanelMode && selectedAttendanceVenture === null;
}

function daysInMonth(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(y, m, 0).getDate();
}

function calcOutstanding(baseSalary, absentDays, monthStr) {
    const totalDays = daysInMonth(monthStr);
    const dailyRate = (parseFloat(baseSalary) || 0) / totalDays;
    return (parseFloat(baseSalary) || 0) - (absentDays * dailyRate);
}

async function loadAttendanceData(month, venture) {
    try {
        let url;
        if (attendanceIsAllVentures()) {
            // "All Ventures" mode - backend filters to allowed ventures
            url = `/api/attendance?venture_id=__all__&month=${encodeURIComponent(month)}`;
        } else {
            const v = venture || attendanceActiveVenture();
            if (!v) return [];
            url = `/api/attendance?venture_id=${encodeURIComponent(v.id)}&month=${encodeURIComponent(month)}`;
        }
        const data = await apiGet(url);
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('Error loading attendance:', e);
        // Show user-friendly error for missing table
        if (e.message && (e.message.includes('PGRST205') || e.message.includes('does not exist'))) {
            showToast('Attendance table not found. Run migration 019 in Supabase SQL Editor.', true);
        }
        return [];
    }
}

async function saveAttendanceRow(rowData) {
    return apiPost('/api/attendance', rowData);
}

async function deleteAttendanceRow(rowId) {
    return apiDelete('/api/attendance/' + encodeURIComponent(rowId));
}

async function renderAttendanceView() {
    const isPanel = attendancePanelMode;
    const allVentures = attendanceIsAllVentures();
    const venture = attendanceActiveVenture();
    const container = document.getElementById(isPanel ? 'payrollPanelContent' : 'payrollViewContainer');
    if (!container) return;

    const currentMonth = attendanceMonthKey();

    container.innerHTML = '';

    // In non-panel mode, a venture is always required
    if (!isPanel && !venture) {
        container.innerHTML = '<div style="padding:24px;color:#999;">No venture selected.</div>';
        return;
    }

    // Build venture name lookup for "All Ventures" display
    const ventureNameLookup = {};
    venturesList.forEach(v => { ventureNameLookup[v.id] = v.name; });

    // Header bar
    const headerBar = document.createElement('div');
    headerBar.className = 'pending-filter-bar';

    // Venture selector (panel mode) - includes "All Ventures" option
    if (isPanel) {
        const ventureGroup = document.createElement('div');
        ventureGroup.className = 'pending-filter-group';
        let ventureOptions = '<option value="__all__"' + (allVentures ? ' selected' : '') + '>All Ventures</option>';
        venturesList.forEach(v => {
            const sel = (!allVentures && selectedAttendanceVenture && selectedAttendanceVenture.id === v.id) ? ' selected' : '';
            ventureOptions += `<option value="${v.id}"${sel}>${escapeHtml(v.name)}</option>`;
        });
        ventureGroup.innerHTML = `<label>Venture</label><select id="attendanceVentureSelect">${ventureOptions}</select>`;
        headerBar.appendChild(ventureGroup);
    } else {
        const ventureGroup = document.createElement('div');
        ventureGroup.className = 'pending-filter-group';
        ventureGroup.innerHTML = `<label>Venture</label><div class="pending-readonly">${escapeHtml(venture.name)}</div>`;
        headerBar.appendChild(ventureGroup);
    }

    // Month selector
    const monthGroup = document.createElement('div');
    monthGroup.className = 'pending-filter-group';
    monthGroup.innerHTML = `<label>Month</label><input type="month" id="attendanceMonthSelect" value="${currentMonth}">`;
    headerBar.appendChild(monthGroup);

    // Date range filter
    const totalDays = daysInMonth(currentMonth);
    const rangeGroup = document.createElement('div');
    rangeGroup.className = 'pending-filter-group';
    rangeGroup.style.flexDirection = 'row';
    rangeGroup.style.alignItems = 'flex-end';
    rangeGroup.style.gap = '4px';
    rangeGroup.innerHTML = `<label style="font-size:0.8rem;font-weight:600;color:#555;">From</label><input type="date" id="attendanceDateFrom" value="${currentMonth}-01" style="padding:6px 8px;border:1px solid #ccc;border-radius:6px;font-size:0.85rem;"><label style="font-size:0.8rem;font-weight:600;color:#555;">To</label><input type="date" id="attendanceDateTo" value="${currentMonth}-${String(totalDays).padStart(2,'0')}" style="padding:6px 8px;border:1px solid #ccc;border-radius:6px;font-size:0.85rem;">`;
    headerBar.appendChild(rangeGroup);

    // Add employee button (disabled in "All Ventures" mode - requires specific venture)
    const addGroup = document.createElement('div');
    addGroup.className = 'pending-filter-group';
    addGroup.style.alignSelf = 'flex-end';
    addGroup.innerHTML = `<button id="attendanceAddEmpBtn" class="btn-primary" style="padding:8px 16px;">+ Add Employee</button>`;
    headerBar.appendChild(addGroup);

    // Export CSV button
    const exportGroup = document.createElement('div');
    exportGroup.className = 'pending-filter-group';
    exportGroup.style.alignSelf = 'flex-end';
    exportGroup.innerHTML = `<button id="attendanceExportCSV" class="btn-secondary" style="padding:8px 16px;">Export CSV</button>`;
    headerBar.appendChild(exportGroup);

    container.appendChild(headerBar);

    // Load attendance data
    attendanceData = await loadAttendanceData(currentMonth, venture);

    // Summary bar (computed from date range)
    const summaryBar = document.createElement('div');
    summaryBar.className = 'pending-summary';
    summaryBar.id = 'attendanceSummaryBar';
    container.appendChild(summaryBar);
    updateAttendanceSummary();

    // Employee table
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'grid-container';
    const table = document.createElement('table');
    table.className = 'tracker-table pending-table';

    const thead = document.createElement('thead');
    // Show "Venture" column only in "All Ventures" mode
    const showVentureCol = allVentures;
    if (showVentureCol) {
        thead.innerHTML = '<tr><th>S.No</th><th>Venture</th><th>Name</th><th>Role</th><th>Base Salary (&#8377;)</th><th>Present Days</th><th>Absent Days</th><th>Outstanding (&#8377;)</th><th>Actions</th></tr>';
    } else {
        thead.innerHTML = '<tr><th>S.No</th><th>Name</th><th>Role</th><th>Base Salary (&#8377;)</th><th>Present Days</th><th>Absent Days</th><th>Outstanding (&#8377;)</th><th>Actions</th></tr>';
    }
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const colspan = showVentureCol ? 9 : 8;
    if (!attendanceData.length) {
        const emptyRow = document.createElement('tr');
        const emptyMsg = allVentures
            ? 'No attendance records found for any venture in this month.'
            : 'No employees added yet. Click "+ Add Employee" to get started.';
        emptyRow.innerHTML = `<td colspan="${colspan}" style="text-align:center;color:#999;padding:24px;">${emptyMsg}</td>`;
        tbody.appendChild(emptyRow);
    } else {
        attendanceData.forEach((emp, idx) => {
            const outstanding = calcOutstanding(emp.base_salary, parseInt(emp.absent_days) || 0, currentMonth);
            const vName = emp.venture_id === '__all__' ? 'All Ventures' : escapeHtml(ventureNameLookup[emp.venture_id] || emp.venture_id || '');
            const ventureCell = showVentureCol ? `<td data-label="Venture">${vName}</td>` : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td data-label="S.No">${idx + 1}</td>
                ${ventureCell}
                <td data-label="Name">${escapeHtml(emp.employee_name)}</td>
                <td data-label="Role">${escapeHtml(emp.role || '')}</td>
                <td data-label="Base Salary">${(parseFloat(emp.base_salary) || 0).toLocaleString('en-IN', {maximumFractionDigits:0})}</td>
                <td data-label="Present Days">
                    <div style="display:flex;align-items:center;gap:4px;">
                        <button class="att-quick-btn att-present-minus" data-rowid="${emp.id}" style="width:24px;height:24px;border:1px solid #ccc;border-radius:4px;background:#f5f5f5;cursor:pointer;font-size:14px;line-height:1;padding:0;" title="Decrease present">&minus;</button>
                        <span class="att-present-val" style="min-width:24px;text-align:center;font-weight:600;">${parseInt(emp.present_days) || 0}</span>
                        <button class="att-quick-btn att-present-plus" data-rowid="${emp.id}" style="width:24px;height:24px;border:1px solid #27ae60;border-radius:4px;background:#27ae60;color:#fff;cursor:pointer;font-size:14px;line-height:1;padding:0;" title="Mark present today">+</button>
                    </div>
                </td>
                <td data-label="Absent Days">
                    <div style="display:flex;align-items:center;gap:4px;">
                        <button class="att-quick-btn att-absent-minus" data-rowid="${emp.id}" style="width:24px;height:24px;border:1px solid #ccc;border-radius:4px;background:#f5f5f5;cursor:pointer;font-size:14px;line-height:1;padding:0;" title="Decrease absent">&minus;</button>
                        <span class="att-absent-val" style="min-width:24px;text-align:center;font-weight:600;">${parseInt(emp.absent_days) || 0}</span>
                        <button class="att-quick-btn att-absent-plus" data-rowid="${emp.id}" style="width:24px;height:24px;border:1px solid #e74c3c;border-radius:4px;background:#e74c3c;color:#fff;cursor:pointer;font-size:14px;line-height:1;padding:0;" title="Mark absent today">+</button>
                    </div>
                </td>
                <td data-label="Outstanding">${outstanding.toLocaleString('en-IN', {maximumFractionDigits:0})}</td>
                <td data-label="Actions" style="text-align:center;">
                    <div class="payroll-actions">
                        <button class="btn-text att-mark-btn" data-rowid="${emp.id}" title="Daily Marking">Mark</button>
                        <button class="btn-text att-edit-btn" data-rowid="${emp.id}" title="Edit">&#9998;</button>
                        <button class="btn-text att-del-btn" data-rowid="${emp.id}" style="color:#c0392b;" title="Delete">Delete</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);

    // Wire events
    const monthSelect = container.querySelector('#attendanceMonthSelect');
    if (monthSelect) {
        monthSelect.addEventListener('change', () => renderAttendanceView());
    }

    const dateFrom = container.querySelector('#attendanceDateFrom');
    const dateTo = container.querySelector('#attendanceDateTo');
    if (dateFrom) dateFrom.addEventListener('change', () => { updateAttendanceSummary(); updateTableDateRange(); });
    if (dateTo) dateTo.addEventListener('change', () => { updateAttendanceSummary(); updateTableDateRange(); });

    if (isPanel) {
        const ventureSelect = container.querySelector('#attendanceVentureSelect');
        if (ventureSelect) {
            ventureSelect.addEventListener('change', (e) => {
                if (e.target.value === '__all__') {
                    selectedAttendanceVenture = null;
                } else {
                    selectedAttendanceVenture = venturesList.find(v => v.id === e.target.value) || null;
                }
                renderAttendanceView();
            });
        }
    }

    const addBtn = container.querySelector('#attendanceAddEmpBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            attendanceEditingRowId = null;
            openAttendanceEmpModal(null);
        });
    }

    container.querySelector('#attendanceExportCSV').addEventListener('click', exportAttendanceCSV);

    container.querySelectorAll('.att-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const emp = attendanceData.find(e => e.id === btn.dataset.rowid);
            if (emp) {
                attendanceEditingRowId = emp.id;
                openAttendanceEmpModal(emp);
            }
        });
    });

    container.querySelectorAll('.att-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const emp = attendanceData.find(e => e.id === btn.dataset.rowid);
            if (!emp) return;
            showConfirm('Delete Employee', `Delete '${emp.employee_name}' from attendance?`, async () => {
                try {
                    await deleteAttendanceRow(emp.id);
                    showToast('Employee deleted');
                    renderAttendanceView();
                } catch (err) {
                    showToast('Failed to delete: ' + (err.message || err), true);
                }
            }, null, 'Delete');
        });
    });

    container.querySelectorAll('.att-mark-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const emp = attendanceData.find(e => e.id === btn.dataset.rowid);
            if (emp) openDailyMarkingModal(emp);
        });
    });

    // Quick +/- buttons for present/absent days
    container.querySelectorAll('.att-present-plus, .att-present-minus, .att-absent-plus, .att-absent-minus').forEach(btn => {
        btn.addEventListener('click', async () => {
            const emp = attendanceData.find(e => e.id === btn.dataset.rowid);
            if (!emp) return;
            const month = attendanceMonthKey();
            const totalDays = daysInMonth(month);
            let present = parseInt(emp.present_days) || 0;
            let absent = parseInt(emp.absent_days) || 0;
            const marking = { ...(emp.daily_marking || {}) };

            // Find next unmarked day for '+' buttons, or last marked day for '-' buttons
            if (btn.classList.contains('att-present-plus')) {
                const day = _findNextUnmarkedDay(marking, totalDays);
                if (day) { marking[day] = 'present'; present++; }
                else { showToast('All days already marked', true); return; }
            } else if (btn.classList.contains('att-absent-plus')) {
                const day = _findNextUnmarkedDay(marking, totalDays);
                if (day) { marking[day] = 'absent'; absent++; }
                else { showToast('All days already marked', true); return; }
            } else if (btn.classList.contains('att-present-minus')) {
                const day = _findLastMarkedDay(marking, 'present', totalDays);
                if (day) { delete marking[day]; present--; }
                else { return; }
            } else if (btn.classList.contains('att-absent-minus')) {
                const day = _findLastMarkedDay(marking, 'absent', totalDays);
                if (day) { delete marking[day]; absent--; }
                else { return; }
            }

            // Update the displayed values immediately (no full re-render)
            const row = btn.closest('tr');
            if (row) {
                const pVal = row.querySelector('.att-present-val');
                const aVal = row.querySelector('.att-absent-val');
                const oVal = row.querySelector('[data-label="Outstanding"]');
                if (pVal) pVal.textContent = present;
                if (aVal) aVal.textContent = absent;
                if (oVal) oVal.textContent = calcOutstanding(emp.base_salary, absent, month).toLocaleString('en-IN', {maximumFractionDigits:0});
            }

            // Update in-memory data immediately
            emp.present_days = present;
            emp.absent_days = absent;
            emp.daily_marking = marking;

            // Update summary bar without re-rendering
            updateAttendanceSummary();

            // Save to backend in background (no re-render on success)
            saveAttendanceRow({
                id: emp.id,
                venture_id: emp.venture_id,
                employee_name: emp.employee_name,
                role: emp.role || '',
                base_salary: emp.base_salary,
                month: month,
                present_days: present,
                absent_days: absent,
                daily_marking: marking,
            }).catch(err => {
                showToast('Failed to save: ' + (err.message || err), true);
                // Revert UI on failure
                if (row) {
                    const pVal = row.querySelector('.att-present-val');
                    const aVal = row.querySelector('.att-absent-val');
                    if (pVal) pVal.textContent = parseInt(emp.present_days) || 0;
                    if (aVal) aVal.textContent = parseInt(emp.absent_days) || 0;
                }
                updateAttendanceSummary();
            });
        });
    });
}

function _findNextUnmarkedDay(marking, totalDays) {
    const month = attendanceMonthKey();
    for (let d = 1; d <= totalDays; d++) {
        const dateStr = month + '-' + String(d).padStart(2, '0');
        if (!marking[dateStr]) return dateStr;
    }
    return null;
}

function _findLastMarkedDay(marking, status, totalDays) {
    const month = attendanceMonthKey();
    for (let d = totalDays; d >= 1; d--) {
        const dateStr = month + '-' + String(d).padStart(2, '0');
        if (marking[dateStr] === status) return dateStr;
    }
    return null;
}

function _getDateRange() {
    const fromEl = document.getElementById('attendanceDateFrom');
    const toEl = document.getElementById('attendanceDateTo');
    const from = fromEl ? fromEl.value : null;
    const to = toEl ? toEl.value : null;
    return { from, to };
}

function _countInRange(marking, status, from, to) {
    if (!marking) return 0;
    let count = 0;
    for (const [dateStr, val] of Object.entries(marking)) {
        if (val === status && (!from || dateStr >= from) && (!to || dateStr <= to)) {
            count++;
        }
    }
    return count;
}

function _daysBetween(from, to) {
    if (!from || !to) return 30;
    const d1 = new Date(from + 'T00:00:00');
    const d2 = new Date(to + 'T00:00:00');
    return Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
}

function updateAttendanceSummary() {
    const bar = document.getElementById('attendanceSummaryBar');
    if (!bar) return;
    const { from, to } = _getDateRange();
    const allVentures = attendanceIsAllVentures();
    const venture = attendanceActiveVenture();
    const month = attendanceMonthKey();
    const totalDays = daysInMonth(month);
    const rangeDays = _daysBetween(from, to);

    let totalBase = 0, totalPresent = 0, totalAbsent = 0, totalOutstanding = 0;
    attendanceData.forEach(emp => {
        const base = parseFloat(emp.base_salary) || 0;
        const present = _countInRange(emp.daily_marking, 'present', from, to);
        const absent = _countInRange(emp.daily_marking, 'absent', from, to);
        totalBase += base;
        totalPresent += present;
        totalAbsent += absent;
        const dailyRate = rangeDays > 0 ? base / rangeDays : 0;
        totalOutstanding += base - (absent * dailyRate);
    });
    const ventureLabel = allVentures ? 'All Ventures' : escapeHtml(venture ? venture.name : '');
    bar.innerHTML = `
        <strong>${attendanceData.length}</strong> employees (${ventureLabel}) |
        Total Base: <strong>&#8377;${totalBase.toLocaleString('en-IN', {maximumFractionDigits:0})}</strong> |
        Present: <strong>${totalPresent}</strong> |
        Absent: <strong>${totalAbsent}</strong> |
        Outstanding: <strong>&#8377;${totalOutstanding.toLocaleString('en-IN', {maximumFractionDigits:0})}</strong>
    `;
}

function updateTableDateRange() {
    const { from, to } = _getDateRange();
    const rangeDays = _daysBetween(from, to);
    const container = document.getElementById(attendancePanelMode ? 'payrollPanelContent' : 'payrollViewContainer');
    if (!container) return;
    attendanceData.forEach(emp => {
        const row = container.querySelector(`[data-rowid="${emp.id}"]`);
        if (!row) return;
        const tr = row.closest('tr');
        if (!tr) return;
        const present = _countInRange(emp.daily_marking, 'present', from, to);
        const absent = _countInRange(emp.daily_marking, 'absent', from, to);
        const pVal = tr.querySelector('.att-present-val');
        const aVal = tr.querySelector('.att-absent-val');
        const oVal = tr.querySelector('[data-label="Outstanding"]');
        if (pVal) pVal.textContent = present;
        if (aVal) aVal.textContent = absent;
        if (oVal) {
            const dailyRate = rangeDays > 0 ? (parseFloat(emp.base_salary) || 0) / rangeDays : 0;
            const outstanding = (parseFloat(emp.base_salary) || 0) - (absent * dailyRate);
            oVal.textContent = outstanding.toLocaleString('en-IN', {maximumFractionDigits:0});
        }
    });
}

// ========================
// Add/Edit Employee Modal
// ========================
function openAttendanceEmpModal(existing) {
    const isEdit = !!existing;
    let venture = attendanceActiveVenture();
    // In "All Ventures" mode, derive the venture from the existing employee's venture_id
    if (!venture && isEdit && existing && existing.venture_id) {
        venture = venturesList.find(v => v.id === existing.venture_id) || null;
    }
    const needsVentureSelect = !venture && !isEdit;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.className = 'modal-content';
    modal.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:480px;width:90%;max-height:90vh;overflow-y:auto;';

    let ventureSelectHtml = '';
    if (needsVentureSelect) {
        let opts = venturesList.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
        ventureSelectHtml = `<div>
            <label style="display:block;font-size:0.8rem;font-weight:600;color:#555;margin-bottom:4px;">Venture <span style="color:#e74c3c;">*</span></label>
            <select id="attEmpVenture" style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:6px;">
                <option value="">-- Select Venture --</option>
                <option value="__all__">All Ventures</option>
                ${opts}
            </select>
        </div>`;
    }

    modal.innerHTML = `
        <h3 style="margin:0 0 16px;">${isEdit ? 'Edit Employee' : 'Add Employee'}</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
            ${ventureSelectHtml}
            <div>
                <label style="display:block;font-size:0.8rem;font-weight:600;color:#555;margin-bottom:4px;">Name</label>
                <input type="text" id="attEmpName" value="${isEdit ? escapeHtml(existing.employee_name) : ''}" style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:6px;" placeholder="Employee name">
            </div>
            <div>
                <label style="display:block;font-size:0.8rem;font-weight:600;color:#555;margin-bottom:4px;">Role</label>
                <input type="text" id="attEmpRole" value="${isEdit ? escapeHtml(existing.role || '') : ''}" style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:6px;" placeholder="e.g. Mason, Helper, Painter">
            </div>
            <div>
                <label style="display:block;font-size:0.8rem;font-weight:600;color:#555;margin-bottom:4px;">Base Salary (&#8377;)</label>
                <input type="number" id="attEmpBase" value="${isEdit ? (existing.base_salary || 0) : ''}" style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:6px;" placeholder="Monthly base salary" min="0">
            </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;">
            <button id="attEmpCancel" class="btn-secondary">Cancel</button>
            <button id="attEmpSave" class="btn-primary">${isEdit ? 'Update' : 'Add'}</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    modal.querySelector('#attEmpCancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    modal.querySelector('#attEmpSave').addEventListener('click', async () => {
        const name = modal.querySelector('#attEmpName').value.trim();
        const role = modal.querySelector('#attEmpRole').value.trim();
        const baseSalary = parseFloat(modal.querySelector('#attEmpBase').value) || 0;
        if (!name) { showToast('Name is required', true); return; }

        const month = attendanceMonthKey();
        const baseRowData = {
            employee_name: name,
            role: role,
            base_salary: baseSalary,
            month: month,
            present_days: isEdit ? (existing.present_days || 0) : 0,
            absent_days: isEdit ? (existing.absent_days || 0) : 0,
            daily_marking: isEdit ? (existing.daily_marking || {}) : {},
        };

        try {
            if (isEdit) {
                baseRowData.id = existing.id;
                baseRowData.venture_id = existing.venture_id;
                await saveAttendanceRow(baseRowData);
                showToast('Employee updated');
            } else {
                let saveVentureId;
                if (needsVentureSelect) {
                    const sel = modal.querySelector('#attEmpVenture').value;
                    if (!sel) { showToast('Please select a venture', true); return; }
                    saveVentureId = sel;
                } else {
                    saveVentureId = venture.id;
                }
                await saveAttendanceRow({ ...baseRowData, venture_id: saveVentureId });
                showToast(saveVentureId === '__all__' ? 'Employee added to All Ventures' : 'Employee added');
            }
            close();
            renderAttendanceView();
        } catch (err) {
            showToast('Failed to save: ' + (err.message || err), true);
        }
    });
}

// ========================
// Daily Marking Modal (calendar grid)
// ========================
function openDailyMarkingModal(emp) {
    const month = attendanceMonthKey();
    const [y, m] = month.split('-').map(Number);
    const totalDays = daysInMonth(month);
    const marking = emp.daily_marking || {};

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.className = 'modal-content';
    modal.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:600px;width:90%;max-height:90vh;overflow-y:auto;';

    let calendarHtml = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin:16px 0;">';
    for (let d = 1; d <= totalDays; d++) {
        const dateStr = `${month}-${String(d).padStart(2, '0')}`;
        const status = marking[dateStr] || '';
        const bg = status === 'present' ? '#27ae60' : status === 'absent' ? '#e74c3c' : '#f0f0f0';
        const color = status ? '#fff' : '#333';
        calendarHtml += `<div class="att-day-cell" data-date="${dateStr}" style="padding:8px 4px;text-align:center;border-radius:4px;cursor:pointer;background:${bg};color:${color};font-size:0.85rem;font-weight:600;">${d}</div>`;
    }
    calendarHtml += '</div>';

    modal.innerHTML = `
        <h3 style="margin:0 0 8px;">Daily Marking — ${escapeHtml(emp.employee_name)}</h3>
        <div style="font-size:0.85rem;color:#666;margin-bottom:8px;">Click a day to toggle: None → Present (green) → Absent (red) → None</div>
        <div style="display:flex;gap:16px;font-size:0.8rem;margin-bottom:8px;">
            <span><span style="display:inline-block;width:12px;height:12px;background:#27ae60;border-radius:3px;vertical-align:middle;"></span> Present</span>
            <span><span style="display:inline-block;width:12px;height:12px;background:#e74c3c;border-radius:3px;vertical-align:middle;"></span> Absent</span>
            <span><span style="display:inline-block;width:12px;height:12px;background:#f0f0f0;border-radius:3px;vertical-align:middle;border:1px solid #ccc;"></span> Not marked</span>
        </div>
        ${calendarHtml}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
            <button id="attMarkCancel" class="btn-secondary">Cancel</button>
            <button id="attMarkSave" class="btn-primary">Save</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Track marking changes locally
    const localMarking = { ...marking };

    modal.querySelectorAll('.att-day-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            const date = cell.dataset.date;
            const current = localMarking[date] || '';
            const next = current === '' ? 'present' : current === 'present' ? 'absent' : '';
            if (next) {
                localMarking[date] = next;
            } else {
                delete localMarking[date];
            }
            // Update cell appearance
            const bg = next === 'present' ? '#27ae60' : next === 'absent' ? '#e74c3c' : '#f0f0f0';
            const color = next ? '#fff' : '#333';
            cell.style.background = bg;
            cell.style.color = color;
        });
    });

    const close = () => overlay.remove();
    modal.querySelector('#attMarkCancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    modal.querySelector('#attMarkSave').addEventListener('click', async () => {
        // Count present/absent from marking
        let present = 0, absent = 0;
        Object.values(localMarking).forEach(v => {
            if (v === 'present') present++;
            if (v === 'absent') absent++;
        });

        try {
            await saveAttendanceRow({
                id: emp.id,
                venture_id: emp.venture_id,
                employee_name: emp.employee_name,
                role: emp.role || '',
                base_salary: emp.base_salary,
                month: month,
                present_days: present,
                absent_days: absent,
                daily_marking: localMarking,
            });
            showToast('Daily marking saved');
            close();
            renderAttendanceView();
        } catch (err) {
            showToast('Failed to save marking: ' + (err.message || err), true);
        }
    });
}

// ========================
// Export CSV
// ========================
function exportAttendanceCSV() {
    const month = attendanceMonthKey();
    const allVentures = attendanceIsAllVentures();
    const venture = attendanceActiveVenture();

    // Build venture name lookup
    const ventureNameLookup = {};
    venturesList.forEach(v => { ventureNameLookup[v.id] = v.name; });

    let headers, rows;
    if (allVentures) {
        headers = ['S.No', 'Venture', 'Name', 'Role', 'Base Salary', 'Present Days', 'Absent Days', 'Outstanding'];
        rows = attendanceData.map((emp, idx) => {
            const outstanding = calcOutstanding(emp.base_salary, parseInt(emp.absent_days) || 0, month);
            const vName = ventureNameLookup[emp.venture_id] || emp.venture_id || '';
            return [idx + 1, vName, emp.employee_name, emp.role || '', emp.base_salary || 0, emp.present_days || 0, emp.absent_days || 0, outstanding.toFixed(0)];
        });
    } else {
        headers = ['S.No', 'Name', 'Role', 'Base Salary', 'Present Days', 'Absent Days', 'Outstanding'];
        rows = attendanceData.map((emp, idx) => {
            const outstanding = calcOutstanding(emp.base_salary, parseInt(emp.absent_days) || 0, month);
            return [idx + 1, emp.employee_name, emp.role || '', emp.base_salary || 0, emp.present_days || 0, emp.absent_days || 0, outstanding.toFixed(0)];
        });
    }

    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = allVentures ? `attendance_all_ventures_${month}.csv` : `attendance_${venture.id}_${month}.csv`;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
