// ========================
// Reports Panel Renderer
// ========================

function renderReportsPanel() {
    const container = document.getElementById('reportsPanelContent');
    if (!container) return;
    container.innerHTML = '';

    const v = currentVenture;
    if (!v) {
        container.innerHTML = '<div style="padding:24px;color:#888;">Please select a venture from the dashboard.</div>';
        return;
    }

    if (!currentBlockObj || !v.blocks.find(b => b.id === currentBlockObj.id)) {
        currentBlockObj = v.blocks && v.blocks[0] ? v.blocks[0] : { id: 'A', floors: 5 };
    }
    currentBlock = currentBlockObj.id;
    homeQuickReportFloor = currentFloor || 1;
    homeQuickReportFlat = 'all';

    const header = document.createElement('div');
    header.className = 'pending-filter-bar';
    header.style.marginBottom = '16px';
    header.innerHTML = `
        <div class="pending-filter-group"><label>Venture</label><div class="pending-readonly">${escapeHtml(v.name)}</div></div>
        <div class="pending-filter-group"><label>Block</label><select id="reportBlockSelect" class="pending-filter-group-select"></select></div>
        <div class="pending-filter-group"><label>Floor</label><select id="reportFloorSelect" class="pending-filter-group-select"></select></div>
        <div class="pending-filter-group"><label>Flat</label><select id="reportFlatSelect" class="pending-filter-group-select"></select></div>
    `;
    container.appendChild(header);

    populateReportBlockSelect();
    populateReportFloorSelect();
    populateReportFlatSelect();

    document.getElementById('reportBlockSelect').addEventListener('change', () => {
        currentBlockObj = v.blocks.find(b => b.id === document.getElementById('reportBlockSelect').value) || v.blocks[0];
        currentBlock = currentBlockObj.id;
        homeQuickReportFloor = 1;
        homeQuickReportFlat = 'all';
        populateReportFloorSelect();
        populateReportFlatSelect();
        regenerateReports();
    });

    document.getElementById('reportFloorSelect').addEventListener('change', () => {
        homeQuickReportFloor = parseInt(document.getElementById('reportFloorSelect').value) || 1;
        homeQuickReportFlat = 'all';
        populateReportFlatSelect();
        regenerateReports();
    });

    document.getElementById('reportFlatSelect').addEventListener('change', () => {
        homeQuickReportFlat = document.getElementById('reportFlatSelect').value;
        regenerateReports();
    });

    const reportContainer = document.createElement('div');
    reportContainer.id = 'reportsChartContainer';
    reportContainer.className = 'grid-container';
    container.appendChild(reportContainer);

    renderHomeReports(reportContainer);
}

function populateReportBlockSelect() {
    const select = document.getElementById('reportBlockSelect');
    if (!select || !currentVenture) return;
    select.innerHTML = '';
    currentVenture.blocks.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name || b.id;
        select.appendChild(opt);
    });
    select.value = currentBlockObj.id;
}

function populateReportFloorSelect() {
    const select = document.getElementById('reportFloorSelect');
    if (!select || !currentBlockObj) return;
    const floors = currentBlockObj.floors || 5;
    const floorLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
    select.innerHTML = '';
    for (let i = 1; i <= floors; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = floorLabels[i - 1] || `${i}th`;
        select.appendChild(opt);
    }
    select.value = String(homeQuickReportFloor);
}

function populateReportFlatSelect() {
    const select = document.getElementById('reportFlatSelect');
    if (!select || !currentBlockObj) return;
    const flatsPerFloor = currentBlockObj.flats_per_floor || FLATS_PER_FLOOR;
    select.innerHTML = '<option value="all">All Flats</option>';
    for (let i = 1; i <= flatsPerFloor; i++) {
        const flatNum = (homeQuickReportFloor * 100) + i;
        const opt = document.createElement('option');
        opt.value = flatNum;
        opt.textContent = flatNum;
        select.appendChild(opt);
    }
    select.value = String(homeQuickReportFlat);
}

function regenerateReports() {
    const container = document.getElementById('reportsChartContainer');
    if (!container) return;
    container.innerHTML = '';
    renderHomeReports(container);
}

// ========================
// Instant Reports Renderer (Enhanced)
// ========================

let _irPieChart = null;
let _irBarChart = null;
let _irLastData = null;
let _irLastFilters = null;

async function renderInstantReports() {
    const container = document.getElementById('instantReportsContent');
    if (!container) return;
    container.innerHTML = '';

    // --- Filter Bar ---
    const filterBar = document.createElement('div');
    filterBar.className = 'ir-filter-bar';

    const ventureOpts = venturesList.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
    filterBar.innerHTML = `
        <div class="ir-filter-group">
            <label>Venture <span class="ir-req">*</span></label>
            <select id="irVentureSelect" class="ir-filter-select">${ventureOpts}</select>
        </div>
        <div class="ir-filter-group">
            <label>Block</label>
            <select id="irBlockSelect" class="ir-filter-select"><option value="">All Blocks</option></select>
        </div>
        <div class="ir-filter-group">
            <label>Floor</label>
            <select id="irFloorSelect" class="ir-filter-select"><option value="">All Floors</option></select>
        </div>
        <div class="ir-filter-group">
            <label>Flat / Unit</label>
            <select id="irFlatSelect" class="ir-filter-select"><option value="">All Flats</option></select>
        </div>
        <div class="ir-filter-group">
            <label>Category</label>
            <select id="irCategorySelect" class="ir-filter-select"><option value="">All Categories</option></select>
        </div>
        <div class="ir-filter-group">
            <label>Date From</label>
            <input type="date" id="irDateFrom" class="ir-filter-input">
        </div>
        <div class="ir-filter-group">
            <label>Date To</label>
            <input type="date" id="irDateTo" class="ir-filter-input">
        </div>
        <div class="ir-filter-actions">
            <button id="irGenerateBtn" class="btn-primary">Generate Report</button>
            <button id="irResetBtn" class="btn-secondary">Reset</button>
        </div>
    `;
    container.appendChild(filterBar);

    // --- Export Bar ---
    const exportBar = document.createElement('div');
    exportBar.className = 'ir-export-bar';
    exportBar.innerHTML = `
        <button id="irExportPdfBtn" class="btn-secondary ir-export-btn" disabled>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V9M6 18H4.5A1.5 1.5 0 0 1 3 16.5v-6A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H18M6 14h12v7H6z"/></svg>
            PDF
        </button>
        <button id="irExportExcelBtn" class="btn-secondary ir-export-btn" disabled>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13l2 2-2 2M12 17h4"/></svg>
            Excel
        </button>
        <button id="irPrintBtn" class="btn-secondary ir-export-btn" disabled>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4.5A1.5 1.5 0 0 1 3 16.5v-6A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H18M6 14h12v8H6z"/></svg>
            Print
        </button>
    `;
    container.appendChild(exportBar);

    // --- Output Area ---
    const outputDiv = document.createElement('div');
    outputDiv.id = 'irOutput';
    outputDiv.className = 'ir-output';
    container.appendChild(outputDiv);

    // --- Populate block/floor/flat/category selects based on venture ---
    function populateBlockSelect(venture) {
        const blockSelect = document.getElementById('irBlockSelect');
        if (!blockSelect) return;
        blockSelect.innerHTML = '<option value="">All Blocks</option>';
        if (venture && venture.blocks) {
            venture.blocks.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.name || b.id;
                blockSelect.appendChild(opt);
            });
        }
    }

    function populateFloorSelect(venture, blockId) {
        const floorSelect = document.getElementById('irFloorSelect');
        if (!floorSelect) return;
        floorSelect.innerHTML = '<option value="">All Floors</option>';
        if (venture && venture.blocks) {
            const block = venture.blocks.find(b => b.id === blockId);
            if (block) {
                const floors = block.floors || 5;
                const labels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
                for (let i = 1; i <= floors; i++) {
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.textContent = labels[i - 1] || `${i}th`;
                    floorSelect.appendChild(opt);
                }
            }
        }
    }

    function populateFlatSelect(venture, blockId, floor) {
        const flatSelect = document.getElementById('irFlatSelect');
        if (!flatSelect) return;
        flatSelect.innerHTML = '<option value="">All Flats</option>';
        if (venture && venture.blocks && blockId && floor) {
            const block = venture.blocks.find(b => b.id === blockId);
            if (block) {
                const flatsPerFloor = block.flats_per_floor || FLATS_PER_FLOOR;
                for (let i = 1; i <= flatsPerFloor; i++) {
                    const flatNum = (parseInt(floor) * 100) + i;
                    const opt = document.createElement('option');
                    opt.value = flatNum;
                    opt.textContent = flatNum;
                    flatSelect.appendChild(opt);
                }
            }
        }
    }

    function populateCategorySelect(venture) {
        const catSelect = document.getElementById('irCategorySelect');
        if (!catSelect) return;
        catSelect.innerHTML = '<option value="">All Categories</option>';
        const cats = ensureWorkCategories(venture && venture.work_categories ? venture.work_categories : WORK_CATEGORIES);
        Object.keys(cats).forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            catSelect.appendChild(opt);
        });
    }

    // --- Event wiring ---
    const ventureSelect = document.getElementById('irVentureSelect');
    const blockSelect = document.getElementById('irBlockSelect');
    const floorSelect = document.getElementById('irFloorSelect');
    const flatSelect = document.getElementById('irFlatSelect');
    const catSelect = document.getElementById('irCategorySelect');
    const dateFrom = document.getElementById('irDateFrom');
    const dateTo = document.getElementById('irDateTo');
    const generateBtn = document.getElementById('irGenerateBtn');
    const resetBtn = document.getElementById('irResetBtn');

    ventureSelect.addEventListener('change', () => {
        const v = venturesList.find(vent => vent.id === ventureSelect.value);
        populateBlockSelect(v);
        populateFloorSelect(v, '');
        populateFlatSelect(v, '', '');
        populateCategorySelect(v);
        flatSelect.innerHTML = '<option value="">All Flats</option>';
        generateReport();
    });

    blockSelect.addEventListener('change', () => {
        const v = venturesList.find(vent => vent.id === ventureSelect.value);
        populateFloorSelect(v, blockSelect.value);
        populateFlatSelect(v, blockSelect.value, '');
        generateReport();
    });

    floorSelect.addEventListener('change', () => {
        const v = venturesList.find(vent => vent.id === ventureSelect.value);
        populateFlatSelect(v, blockSelect.value, floorSelect.value);
        generateReport();
    });

    flatSelect.addEventListener('change', generateReport);
    catSelect.addEventListener('change', generateReport);
    dateFrom.addEventListener('change', generateReport);
    dateTo.addEventListener('change', generateReport);

    generateBtn.addEventListener('click', generateReport);

    resetBtn.addEventListener('click', () => {
        blockSelect.value = '';
        floorSelect.value = '';
        flatSelect.value = '';
        catSelect.value = '';
        dateFrom.value = '';
        dateTo.value = '';
        const v = venturesList.find(vent => vent.id === ventureSelect.value);
        populateBlockSelect(v);
        populateFloorSelect(v, '');
        populateFlatSelect(v, '', '');
        populateCategorySelect(v);
        generateReport();
    });

    // --- Export buttons ---
    document.getElementById('irExportPdfBtn').addEventListener('click', () => {
        printInstantReport();
    });
    document.getElementById('irPrintBtn').addEventListener('click', () => {
        printInstantReport();
    });
    document.getElementById('irExportExcelBtn').addEventListener('click', exportInstantReportExcel);

    // --- Generate report ---
    async function generateReport() {
        const vid = ventureSelect.value;
        if (!vid) {
            outputDiv.innerHTML = '<div class="ir-empty">Please select a venture to generate a report.</div>';
            return;
        }

        const params = new URLSearchParams();
        params.set('venture_id', vid);
        if (blockSelect.value) params.set('block', blockSelect.value);
        if (floorSelect.value) params.set('floor', floorSelect.value);
        if (flatSelect.value) params.set('flat', flatSelect.value);
        if (catSelect.value) params.set('category', catSelect.value);
        if (dateFrom.value) params.set('date_from', dateFrom.value);
        if (dateTo.value) params.set('date_to', dateTo.value);

        outputDiv.innerHTML = '<div class="ir-loading"><div class="ir-spinner"></div>Generating report...</div>';

        try {
            const data = await apiGet(`/api/reports/instant?${params.toString()}`);
            _irLastData = data;
            _irLastFilters = {
                venture: venturesList.find(v => v.id === vid)?.name || vid,
                block: blockSelect.value || 'All',
                floor: floorSelect.value || 'All',
                flat: flatSelect.value || 'All',
                category: catSelect.value || 'All',
                dateFrom: dateFrom.value || '',
                dateTo: dateTo.value || ''
            };
            renderInstantReportOutput(outputDiv, data);
            // Enable export buttons
            document.getElementById('irExportPdfBtn').disabled = false;
            document.getElementById('irExportExcelBtn').disabled = false;
            document.getElementById('irPrintBtn').disabled = false;
        } catch (err) {
            outputDiv.innerHTML = `<div class="ir-error">Error: ${escapeHtml(err.message)}</div>`;
        }
    }

    // Auto-generate on load if ventures exist
    if (venturesList.length > 0) {
        const v = venturesList[0];
        ventureSelect.value = v.id;
        populateBlockSelect(v);
        populateCategorySelect(v);
        generateReport();
    } else {
        outputDiv.innerHTML = '<div class="ir-empty">No ventures available.</div>';
    }
}

function renderInstantReportOutput(container, data) {
    const s = data.summary;
    const sc = data.status_counts;
    const total = s.total_cells || 0;

    const pct = (val) => total ? ((val / total) * 100).toFixed(1) : '0.0';

    let html = '';

    // --- Progress Cards ---
    html += '<div class="ir-cards-row">';
    const cards = [
        { label: 'Total Work Items', value: s.total_work_items, icon: '📋', color: 'dark' },
        { label: 'Total Cells', value: total, icon: '🔲', color: 'blue' },
        { label: 'Completed', value: s.completed, pct: pct(s.completed), icon: '✅', color: 'green' },
        { label: 'In Progress', value: s.in_progress, pct: pct(s.in_progress), icon: '🔄', color: 'yellow' },
        { label: 'Yet to Start', value: s.yet_to_start, pct: pct(s.yet_to_start), icon: '⏳', color: 'red' },
        { label: 'Patch Work', value: s.patch_work, pct: pct(s.patch_work), icon: '🔧', color: 'blue' },
        { label: 'Pending', value: s.pending, icon: '⏸', color: 'amber' },
        { label: 'Completion %', value: s.completion_pct + '%', icon: '📊', color: 'green' },
    ];
    cards.forEach(c => {
        html += `<div class="ir-card ir-card-${c.color}">
            <div class="ir-card-icon">${c.icon}</div>
            <div class="ir-card-body">
                <div class="ir-card-label">${c.label}</div>
                <div class="ir-card-value">${c.value}</div>
                ${c.pct !== undefined ? `<div class="ir-card-sub">${c.pct}%</div>` : ''}
            </div>
        </div>`;
    });
    html += '</div>';

    // --- Charts Row ---
    html += '<div class="ir-charts-row">';
    html += '<div class="ir-chart-card"><div class="ir-chart-title">Work Status Distribution</div><div class="ir-chart-wrap"><canvas id="irPieChart"></canvas></div></div>';
    html += '<div class="ir-chart-card"><div class="ir-chart-title">Category-wise Completion</div><div class="ir-chart-wrap"><canvas id="irBarChart"></canvas></div></div>';
    html += '</div>';

    // --- Category Summary Cards ---
    if (data.category_summary && data.category_summary.length > 0) {
        html += '<div class="ir-section"><h3 class="ir-section-title">Category-wise Summary</h3>';
        html += '<div class="ir-cat-cards">';
        data.category_summary.forEach(c => {
            const catTotal = c.total || 0;
            const catPct = c.pct || 0;
            html += `<div class="ir-cat-card">
                <div class="ir-cat-header">
                    <h4 class="ir-cat-name">${escapeHtml(c.category)}</h4>
                    <span class="ir-cat-pct-badge" style="background:${catPct >= 75 ? '#2ecc71' : catPct >= 40 ? '#f1c40f' : '#e74c3c'};">${catPct}%</span>
                </div>
                <div class="ir-cat-progress-bar"><div class="ir-cat-progress-fill" style="width:${catPct}%;background:${catPct >= 75 ? '#2ecc71' : catPct >= 40 ? '#f1c40f' : '#e74c3c'};"></div></div>
                <div class="ir-cat-stats">
                    <div class="ir-cat-stat-row">
                        <span class="ir-cat-stat-label">Total Work Items</span>
                        <span class="ir-cat-stat-value">${catTotal}</span>
                    </div>
                    <div class="ir-cat-stat-row">
                        <span class="ir-cat-stat-label"><span class="ir-cat-dot" style="background:#2ecc71;"></span>Completed</span>
                        <span class="ir-cat-stat-value ir-cat-val-green">${c.completed} &#x1F7E2;</span>
                    </div>
                    <div class="ir-cat-stat-row">
                        <span class="ir-cat-stat-label"><span class="ir-cat-dot" style="background:#f1c40f;"></span>In Progress</span>
                        <span class="ir-cat-stat-value ir-cat-val-yellow">${c.in_progress} &#x1F7E1;</span>
                    </div>
                    <div class="ir-cat-stat-row">
                        <span class="ir-cat-stat-label"><span class="ir-cat-dot" style="background:#3498db;"></span>Patch Work</span>
                        <span class="ir-cat-stat-value ir-cat-val-blue">${c.patch_work} &#x1F535;</span>
                    </div>
                    <div class="ir-cat-stat-row">
                        <span class="ir-cat-stat-label"><span class="ir-cat-dot" style="background:#e74c3c;"></span>Yet to Start</span>
                        <span class="ir-cat-stat-value ir-cat-val-red">${c.yet_to_start} &#x1F534;</span>
                    </div>
                    <div class="ir-cat-stat-row">
                        <span class="ir-cat-stat-label"><span class="ir-cat-dot" style="background:#ccc;"></span>Not Started</span>
                        <span class="ir-cat-stat-value">${c.not_started}</span>
                    </div>
                </div>
            </div>`;
        });
        html += '</div></div>';
    }

    // --- Work View Hierarchy (Category -> Work Descriptions) ---
    if (data.work_view_hierarchy && data.work_view_hierarchy.length > 0) {
        html += '<div class="ir-section"><h3 class="ir-section-title">Work View Hierarchy</h3>';
        data.work_view_hierarchy.forEach(cat => {
            const catPct = cat.pct || 0;
            const catBarColor = catPct >= 75 ? '#2ecc71' : catPct >= 40 ? '#f1c40f' : '#e74c3c';
            html += `<div class="ir-wv-category">
                <div class="ir-wv-cat-header">
                    <h4 class="ir-wv-cat-name">${escapeHtml(cat.category)}</h4>
                    <span class="ir-wv-cat-pct-badge" style="background:${catBarColor};">${catPct}%</span>
                </div>
                <div class="ir-wv-cat-progress-bar"><div class="ir-wv-cat-progress-fill" style="width:${catPct}%;background:${catBarColor};"></div></div>
                <div class="ir-wv-items">`;
            (cat.items || []).forEach(w => {
                const wiPct = w.pct || 0;
                const barColor = wiPct >= 75 ? '#2ecc71' : wiPct >= 40 ? '#f1c40f' : '#e74c3c';
                html += `<div class="ir-wv-item-card">
                    <div class="ir-wv-item-header">
                        <span class="ir-wv-item-name">${escapeHtml(w.work_item)}</span>
                        <span class="ir-wv-item-pct-badge" style="background:${barColor};">${wiPct}%</span>
                    </div>
                    <div class="ir-wv-item-progress-bar"><div class="ir-wv-item-progress-fill" style="width:${wiPct}%;background:${barColor};"></div></div>
                    <div class="ir-wv-item-stats">
                        <span class="ir-wv-item-stat"><span class="ir-wv-dot" style="background:#2ecc71;"></span>${w.completed}</span>
                        <span class="ir-wv-item-stat"><span class="ir-wv-dot" style="background:#f1c40f;"></span>${w.in_progress}</span>
                        <span class="ir-wv-item-stat"><span class="ir-wv-dot" style="background:#3498db;"></span>${w.patch_work}</span>
                        <span class="ir-wv-item-stat"><span class="ir-wv-dot" style="background:#e74c3c;"></span>${w.yet_to_start}</span>
                        <span class="ir-wv-item-stat ir-wv-item-total">Total: ${w.total}</span>
                    </div>
                </div>`;
            });
            html += '</div></div>';
        });
        html += '</div>';
    }

    // --- Block Summary ---
    if (data.block_summary && data.block_summary.length > 0) {
        html += '<div class="ir-section"><h3 class="ir-section-title">Block-wise Summary</h3>';
        html += '<div class="ir-cat-cards">';
        data.block_summary.forEach(b => {
            const bPct = b.pct || 0;
            const barColor = bPct >= 75 ? '#2ecc71' : bPct >= 40 ? '#f1c40f' : '#e74c3c';
            html += `<div class="ir-cat-card">
                <div class="ir-cat-header">
                    <h4 class="ir-cat-name">Block ${escapeHtml(b.block)}</h4>
                    <span class="ir-cat-pct-badge" style="background:${barColor};">${bPct}%</span>
                </div>
                <div class="ir-cat-progress-bar"><div class="ir-cat-progress-fill" style="width:${bPct}%;background:${barColor};"></div></div>
                <div class="ir-cat-stats">
                    <div class="ir-cat-stat-row"><span class="ir-cat-stat-label">Total Cells</span><span class="ir-cat-stat-value">${b.total}</span></div>
                    <div class="ir-cat-stat-row"><span class="ir-cat-stat-label"><span class="ir-cat-dot" style="background:#2ecc71;"></span>Completed</span><span class="ir-cat-stat-value ir-cat-val-green">${b.completed}</span></div>
                    <div class="ir-cat-stat-row"><span class="ir-cat-stat-label"><span class="ir-cat-dot" style="background:#f1c40f;"></span>In Progress</span><span class="ir-cat-stat-value ir-cat-val-yellow">${b.in_progress}</span></div>
                    <div class="ir-cat-stat-row"><span class="ir-cat-stat-label"><span class="ir-cat-dot" style="background:#3498db;"></span>Patch Work</span><span class="ir-cat-stat-value ir-cat-val-blue">${b.patch_work}</span></div>
                    <div class="ir-cat-stat-row"><span class="ir-cat-stat-label"><span class="ir-cat-dot" style="background:#e74c3c;"></span>Yet to Start</span><span class="ir-cat-stat-value ir-cat-val-red">${b.yet_to_start}</span></div>
                </div>
            </div>`;
        });
        html += '</div></div>';
    }

    // --- Floor Summary ---
    if (data.floor_summary && data.floor_summary.length > 0) {
        html += '<div class="ir-section"><h3 class="ir-section-title">Floor-wise Summary</h3>';
        html += '<table class="cp-detail-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
        html += '<thead><tr style="border-bottom:2px solid #eee;"><th style="text-align:left;padding:8px;">Block</th><th style="text-align:left;padding:8px;">Floor</th><th style="text-align:right;padding:8px;">Total</th><th style="text-align:right;padding:8px;">Completed</th><th style="text-align:right;padding:8px;">In Progress</th><th style="text-align:right;padding:8px;">Patch Work</th><th style="text-align:right;padding:8px;">Yet to Start</th><th style="text-align:right;padding:8px;">%</th></tr></thead><tbody>';
        data.floor_summary.forEach(f => {
            const fPct = f.pct || 0;
            const pctColor = fPct >= 75 ? '#2ecc71' : fPct >= 40 ? '#f1c40f' : '#e74c3c';
            html += `<tr style="border-bottom:1px solid #f0f0f0;">
                <td style="padding:8px;">${escapeHtml(f.block)}</td>
                <td style="padding:8px;">${escapeHtml(String(f.floor))}</td>
                <td style="text-align:right;padding:8px;">${f.total}</td>
                <td style="text-align:right;padding:8px;color:#2ecc71;">${f.completed}</td>
                <td style="text-align:right;padding:8px;color:#f1c40f;">${f.in_progress}</td>
                <td style="text-align:right;padding:8px;color:#3498db;">${f.patch_work}</td>
                <td style="text-align:right;padding:8px;color:#e74c3c;">${f.yet_to_start}</td>
                <td style="text-align:right;padding:8px;font-weight:600;color:${pctColor};">${fPct}%</td>
            </tr>`;
        });
        html += '</tbody></table></div>';
    }

    if (total === 0) {
        html = '<div class="ir-empty">No data found for the selected filters.</div>';
    }

    container.innerHTML = html;

    // --- Render Charts ---
    if (total > 0) {
        renderInstantReportCharts(data);
    }
}

function renderInstantReportCharts(data) {
    // Destroy existing charts
    if (_irPieChart) { _irPieChart.destroy(); _irPieChart = null; }
    if (_irBarChart) { _irBarChart.destroy(); _irBarChart = null; }

    const pieCanvas = document.getElementById('irPieChart');
    const barCanvas = document.getElementById('irBarChart');
    if (!pieCanvas || !barCanvas) return;

    const sc = data.status_counts;
    const pieData = {
        labels: ['Completed', 'In Progress', 'Yet to Start', 'Patch Work', 'Not Started'],
        datasets: [{
            data: [sc.green || 0, sc.yellow || 0, sc.red || 0, sc.blue || 0, sc.none || 0],
            backgroundColor: ['#2ecc71', '#f1c40f', '#e74c3c', '#3498db', '#bdc3c7'],
            borderWidth: 2,
            borderColor: '#fff'
        }]
    };

    _irPieChart = new Chart(pieCanvas, {
        type: 'pie',
        data: pieData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                            return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    // Bar chart: category-wise completion
    const cats = data.category_summary || [];
    if (cats.length > 0) {
        _irBarChart = new Chart(barCanvas, {
            type: 'bar',
            data: {
                labels: cats.map(c => c.category),
                datasets: [
                    { label: 'Completed', data: cats.map(c => c.completed), backgroundColor: '#2ecc71' },
                    { label: 'In Progress', data: cats.map(c => c.in_progress), backgroundColor: '#f1c40f' },
                    { label: 'Yet to Start', data: cats.map(c => c.yet_to_start), backgroundColor: '#e74c3c' },
                    { label: 'Patch Work', data: cats.map(c => c.patch_work), backgroundColor: '#3498db' },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true, ticks: { font: { size: 10 } } },
                    y: { stacked: true, beginAtZero: true }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8 } }
                }
            }
        });
    }
}

function printInstantReport() {
    const output = document.getElementById('irOutput');
    if (!output || !_irLastData) return;

    // Remove any existing print container
    const oldPrint = document.getElementById('irPrintContainer');
    if (oldPrint) oldPrint.remove();

    const filters = _irLastFilters || {};
    const data = _irLastData;
    const s = data.summary;

    // Build print header
    const now = new Date();
    const timestamp = now.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });

    const printDiv = document.createElement('div');
    printDiv.id = 'irPrintContainer';
    printDiv.className = 'ir-print-container';

    let headerHtml = `
        <div class="ir-print-header">
            <h1>Instant Progress Report</h1>
            <div class="ir-print-meta">
                <div><strong>Venture:</strong> ${escapeHtml(filters.venture || '')}</div>
                <div><strong>Block:</strong> ${escapeHtml(filters.block || 'All')}</div>
                <div><strong>Floor:</strong> ${escapeHtml(filters.floor || 'All')}</div>
                <div><strong>Flat:</strong> ${escapeHtml(filters.flat || 'All')}</div>
                <div><strong>Category:</strong> ${escapeHtml(filters.category || 'All')}</div>
                ${filters.dateFrom ? `<div><strong>From:</strong> ${filters.dateFrom}</div>` : ''}
                ${filters.dateTo ? `<div><strong>To:</strong> ${filters.dateTo}</div>` : ''}
                <div><strong>Generated:</strong> ${timestamp}</div>
            </div>
            <div class="ir-print-summary">
                <table class="ir-print-summary-table">
                    <tr>
                        <td><strong>Total Work Items</strong><br>${s.total_work_items}</td>
                        <td><strong>Total Cells</strong><br>${s.total_cells}</td>
                        <td><strong>Completed</strong><br>${s.completed}</td>
                        <td><strong>In Progress</strong><br>${s.in_progress}</td>
                        <td><strong>Yet to Start</strong><br>${s.yet_to_start}</td>
                        <td><strong>Patch Work</strong><br>${s.patch_work}</td>
                        <td><strong>Pending</strong><br>${s.pending}</td>
                        <td><strong>Completion</strong><br>${s.completion_pct}%</td>
                    </tr>
                </table>
            </div>
        </div>
    `;

    // Clone the output content
    const contentClone = output.cloneNode(true);
    contentClone.className = 'ir-print-content';

    // Convert chart canvases to static images for reliable PDF printing.
    // Use Chart.js's toBase64Image() which correctly captures the chart bitmap,
    // rather than canvas.toDataURL() which can fail on cloned/resized canvases.
    const chartImages = {};
    if (_irPieChart && typeof _irPieChart.toBase64Image === 'function') {
        try { chartImages['irPieChart'] = _irPieChart.toBase64Image('image/png', 1); } catch (e) { console.warn('Pie chart capture failed:', e); }
    }
    if (_irBarChart && typeof _irBarChart.toBase64Image === 'function') {
        try { chartImages['irBarChart'] = _irBarChart.toBase64Image('image/png', 1); } catch (e) { console.warn('Bar chart capture failed:', e); }
    }

    // Replace each canvas in the clone with a static <img> of the captured chart
    contentClone.querySelectorAll('canvas').forEach(cv => {
        const imgSrc = chartImages[cv.id];
        if (imgSrc) {
            const img = document.createElement('img');
            img.src = imgSrc;
            img.className = 'ir-print-chart-img';
            img.style.cssText = 'max-width:100%;height:auto;display:block;margin:0 auto;';
            cv.replaceWith(img);
        } else {
            // Fallback: try toDataURL on the original canvas
            const origCanvas = document.getElementById(cv.id);
            if (origCanvas) {
                try {
                    const img = document.createElement('img');
                    img.src = origCanvas.toDataURL('image/png');
                    img.className = 'ir-print-chart-img';
                    img.style.cssText = 'max-width:100%;height:auto;display:block;margin:0 auto;';
                    cv.replaceWith(img);
                } catch (e) {
                    console.warn('Canvas fallback failed for', cv.id, e);
                    // Last resort: remove the empty canvas to avoid blank box
                    cv.remove();
                }
            } else {
                cv.remove();
            }
        }
    });

    // Keep: .ir-cards-row (progress cards), .ir-charts-row (pie + bar charts), .ir-section (Category-wise + Work View Hierarchy)
    const sectionsToKeep = new Set();
    // Keep chart and card rows
    contentClone.querySelectorAll('.ir-cards-row, .ir-charts-row').forEach(el => sectionsToKeep.add(el));
    // Keep Category-wise and Work View Hierarchy sections
    const allSections = contentClone.querySelectorAll('.ir-section');
    allSections.forEach(sec => {
        const title = sec.querySelector('.ir-section-title');
        if (title && (title.textContent.includes('Category-wise') || title.textContent.includes('Work View Hierarchy'))) {
            sectionsToKeep.add(sec);
        }
    });
    // Remove all children except the kept sections
    Array.from(contentClone.children).forEach(child => {
        if (!sectionsToKeep.has(child)) {
            child.remove();
        }
    });

    printDiv.innerHTML = headerHtml;
    printDiv.appendChild(contentClone);

    // Append to body (hidden on screen, visible only in print)
    document.body.appendChild(printDiv);

    // Clean up after print dialog closes (use afterprint event + timeout fallback)
    const cleanup = () => {
        printDiv.remove();
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Fallback cleanup in case afterprint doesn't fire
    setTimeout(cleanup, 5000);

    // Trigger print (small delay to ensure images are rendered)
    setTimeout(() => window.print(), 100);
}

function exportInstantReportExcel() {
    if (!_irLastData) return;
    const data = _irLastData;
    const filters = _irLastFilters || {};

    if (typeof XLSX === 'undefined') {
        showToast('Excel library not loaded. Please refresh the page.', true);
        return;
    }

    const wb = XLSX.utils.book_new();

    // Summary sheet
    const summaryRows = [
        ['Instant Report Summary'],
        ['Generated', new Date().toLocaleString('en-IN')],
        ['Venture', filters.venture || ''],
        ['Block', filters.block || 'All'],
        ['Floor', filters.floor || 'All'],
        ['Flat', filters.flat || 'All'],
        ['Category', filters.category || 'All'],
        ['Date From', filters.dateFrom || ''],
        ['Date To', filters.dateTo || ''],
        [],
        ['Metric', 'Count', 'Percentage'],
        ['Total Work Items', data.summary.total_work_items, ''],
        ['Total Cells', data.summary.total_cells, ''],
        ['Completed', data.summary.completed, data.summary.total_cells ? ((data.summary.completed / data.summary.total_cells) * 100).toFixed(1) + '%' : '0%'],
        ['In Progress', data.summary.in_progress, data.summary.total_cells ? ((data.summary.in_progress / data.summary.total_cells) * 100).toFixed(1) + '%' : '0%'],
        ['Yet to Start', data.summary.yet_to_start, data.summary.total_cells ? ((data.summary.yet_to_start / data.summary.total_cells) * 100).toFixed(1) + '%' : '0%'],
        ['Patch Work', data.summary.patch_work, data.summary.total_cells ? ((data.summary.patch_work / data.summary.total_cells) * 100).toFixed(1) + '%' : '0%'],
        ['Not Started', data.summary.not_started, data.summary.total_cells ? ((data.summary.not_started / data.summary.total_cells) * 100).toFixed(1) + '%' : '0%'],
        ['Pending', data.summary.pending, ''],
        ['Completion %', data.summary.completion_pct + '%', ''],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // Work view hierarchy (flattened for Excel)
    if (data.work_view_hierarchy && data.work_view_hierarchy.length > 0) {
        const flatRows = [];
        data.work_view_hierarchy.forEach(cat => {
            (cat.items || []).forEach(w => {
                flatRows.push({
                    Category: cat.category,
                    'Work Description': w.work_item,
                    Total: w.total,
                    Completed: w.completed,
                    'In Progress': w.in_progress,
                    'Patch Work': w.patch_work,
                    'Yet to Start': w.yet_to_start,
                    'Not Started': w.not_started,
                    Pending: w.pending,
                    'Pct': w.pct
                });
            });
        });
        if (flatRows.length > 0) {
            const wsItems = XLSX.utils.json_to_sheet(flatRows);
            XLSX.utils.book_append_sheet(wb, wsItems, 'Work View');
        }
    }

    // Category summary
    if (data.category_summary && data.category_summary.length > 0) {
        const wsCats = XLSX.utils.json_to_sheet(data.category_summary);
        XLSX.utils.book_append_sheet(wb, wsCats, 'Categories');
    }

    const filename = `Instant_Report_${(filters.venture || 'report').replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
}

// ========================
// Inventory Audit Renderer
// ========================

async function renderInventoryAudit() {
    const container = document.getElementById('inventoryAuditContent');
    if (!container) return;
    container.innerHTML = '';

    const ventureSelect = document.createElement('select');
    ventureSelect.style.cssText = 'padding:8px 12px;border:1px solid #ccc;border-radius:6px;font-size:0.9rem;margin:16px 24px;';
    ventureSelect.innerHTML = '<option value="">-- Select Venture --</option>';
    venturesList.forEach(v => {
        ventureSelect.innerHTML += `<option value="${v.id}">${v.name}</option>`;
    });
    container.appendChild(ventureSelect);

    const outputDiv = document.createElement('div');
    outputDiv.style.cssText = 'padding:0 24px;';
    container.appendChild(outputDiv);

    ventureSelect.addEventListener('change', async () => {
        const vid = ventureSelect.value;
        if (!vid) { outputDiv.innerHTML = ''; return; }
        outputDiv.innerHTML = '<div style="padding:24px;color:#888;">Loading audit...</div>';
        try {
            const rows = await apiGet(`/api/inventory/audit?venture_id=${encodeURIComponent(vid)}`);
            if (!rows.length) {
                outputDiv.innerHTML = '<div style="padding:24px;color:#888;">No materials found for this venture.</div>';
                return;
            }
            let html = '<table class="tracker-table" style="font-size:0.85rem;margin-top:16px;">';
            html += '<thead><tr><th>Material</th><th>Ordered</th><th>Received</th><th>Used</th><th>Wasted</th><th>Expected Rem.</th><th>Actual Bal.</th><th>Short Del.</th><th>Flag</th></tr></thead><tbody>';
            rows.forEach(r => {
                const flagClass = r.discrepancy_flag ? ' style="background:#f5f5f5;font-weight:600;"' : '';
                const flagText = r.discrepancy_flag ? '⚠ Discrepancy' : (r.short_delivery > 0 ? 'Short Delivery' : 'OK');
                const wastedStyle = (r.wasted_qty || 0) > 0 ? ' style="color:#e74c3c;font-weight:600;"' : '';
                html += `<tr${flagClass}><td>${r.material_name}</td><td>${r.ordered_qty} ${r.unit}</td><td>${r.received_qty} ${r.unit}</td><td>${r.consumed_qty} ${r.unit}</td><td${wastedStyle}>${r.wasted_qty || 0} ${r.unit}</td><td>${r.expected_remaining} ${r.unit}</td><td>${r.actual_balance} ${r.unit}</td><td>${r.short_delivery} ${r.unit}</td><td>${flagText}</td></tr>`;
            });
            html += '</tbody></table>';
            outputDiv.innerHTML = html;
        } catch (err) {
            outputDiv.innerHTML = `<div style="padding:24px;color:#c0392b;">Error: ${err.message}</div>`;
        }
    });
}


// ========================
// Expenditure Renderer
// ========================

async function loadExpenditures(ventureId) {
    try {
        expenditureList = await apiGet('/api/expenditures?venture_id=' + encodeURIComponent(ventureId)) || [];
    } catch (e) {
        expenditureList = [];
    }
}

function expenditureTotals(entries) {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const from = expenditureFromDate || '1900-01-01';
    const to = expenditureToDate || '9999-12-31';

    let todayTotal = 0;
    let monthTotal = 0;
    let rangeTotal = 0;

    entries.forEach(e => {
        const d = e.date || e.created_at?.slice(0, 10) || today;
        const amt = parseFloat(e.amount) || 0;
        if (d === today) todayTotal += amt;
        if (d >= monthStart && d <= today) monthTotal += amt;
        if (d >= from && d <= to) rangeTotal += amt;
    });

    return { todayTotal, monthTotal, rangeTotal };
}

function filteredExpenditures() {
    const user = currentUser || '';
    const role = currentUserRole || 'supervisor';

    // Supervisor tab only shows own entries; manager/admin tabs show all for the venture
    if (expenditureActiveTab === 'supervisor') {
        return expenditureList.filter(e => (e.created_by || '').toLowerCase() === user.toLowerCase());
    }
    return expenditureList;
}

function renderExpenditureList(container) {
    container.innerHTML = '';
    const entries = filteredExpenditures();
    const table = document.createElement('table');
    table.className = 'tracker-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Date</th>
                <th>Paid To</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Approved By</th>
                <th>Entered By</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:24px;">No expenditure entries found.</td></tr>';
    } else {
        entries.forEach(e => {
            const tr = document.createElement('tr');
            const date = e.date || (e.created_at ? e.created_at.slice(0, 10) : '-');
            const amount = parseFloat(e.amount) || 0;
            const canDelete = currentUserRole === 'admin' || (e.created_by || '').toLowerCase() === (currentUser || '').toLowerCase();
            tr.innerHTML = `
                <td data-label="Date">${date}</td>
                <td data-label="Paid To">${escapeHtml(e.paid_to || '')}</td>
                <td data-label="Amount">${amount.toLocaleString('en-IN', {maximumFractionDigits: 2})}</td>
                <td data-label="Reason">${escapeHtml(e.reason || '')}</td>
                <td data-label="Approved By">${escapeHtml(e.approved_by || '')}</td>
                <td data-label="Entered By">${escapeHtml(e.created_by || '')}</td>
                <td data-label="Actions" style="text-align:center;">
                    ${canDelete ? `<button class="btn-text exp-delete-btn" data-id="${e.id}" style="color:#c0392b;font-size:0.78rem;">Delete</button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.exp-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                if (!confirm('Delete this expenditure entry?')) return;
                try {
                    await apiDelete('/api/expenditure/' + encodeURIComponent(id));
                    showToast('Expenditure deleted');
                    await loadExpenditures(expenditureActiveVenture().id);
                    renderExpenditureView();
                } catch (err) {
                    showToast('Failed to delete', true);
                }
            });
        });
    }

    container.appendChild(table);
}

async function renderExpenditureView() {
    const container = document.getElementById('expenditureContent');
    if (!container) return;
    container.innerHTML = '';

    const v = expenditureActiveVenture();
    if (!v) {
        container.innerHTML = '<div style="padding:24px;color:#999;">No venture available.</div>';
        return;
    }

    // Load data
    await loadExpenditures(v.id);
    const totals = expenditureTotals(expenditureList);

    // Header with venture selector
    const header = document.createElement('div');
    header.className = 'pending-filter-bar';
    const ventureOptions = venturesList.map(vent => `<option value="${vent.id}" ${vent.id === v.id ? 'selected' : ''}>${escapeHtml(vent.name)}</option>`).join('');
    header.innerHTML = `
        <div class="pending-filter-group">
            <label>Venture</label>
            <select id="expenditureVentureSelect">${ventureOptions}</select>
        </div>
        <div class="pending-filter-group">
            <label>From</label>
            <input type="date" id="expenditureFrom" value="${expenditureFromDate}">
        </div>
        <div class="pending-filter-group">
            <label>To</label>
            <input type="date" id="expenditureTo" value="${expenditureToDate}">
        </div>
        <div class="pending-filter-group" style="align-self:flex-end;">
            <button id="expenditureApplyRange" class="btn-secondary" style="padding:8px 16px;">Apply Range</button>
        </div>
    `;
    container.appendChild(header);

    header.querySelector('#expenditureVentureSelect').addEventListener('change', (e) => {
        selectedExpenditureVenture = venturesList.find(vent => vent.id === e.target.value) || null;
        renderExpenditureView();
    });

    header.querySelector('#expenditureApplyRange').addEventListener('click', () => {
        expenditureFromDate = header.querySelector('#expenditureFrom').value;
        expenditureToDate = header.querySelector('#expenditureTo').value;
        renderExpenditureView();
    });

    // Summary cards
    const summary = document.createElement('div');
    summary.className = 'kpi-row';
    summary.style.margin = '16px 24px';
    summary.innerHTML = `
        <div class="kpi-card"><div class="kpi-label">Today's Expenditure</div><div class="kpi-value">&#8377; ${totals.todayTotal.toLocaleString('en-IN', {maximumFractionDigits: 2})}</div></div>
        <div class="kpi-card"><div class="kpi-label">This Month's Expenditure</div><div class="kpi-value">&#8377; ${totals.monthTotal.toLocaleString('en-IN', {maximumFractionDigits: 2})}</div></div>
        <div class="kpi-card"><div class="kpi-label">Range Total</div><div class="kpi-value">&#8377; ${totals.rangeTotal.toLocaleString('en-IN', {maximumFractionDigits: 2})}</div></div>
    `;
    container.appendChild(summary);

    // Tabs
    const tabBar = document.createElement('div');
    tabBar.className = 'inventory-tab-bar';
    const role = currentUserRole || 'supervisor';
    let tabsHtml = '';
    if (role === 'supervisor' || role === 'manager' || role === 'admin') {
        tabsHtml += `<button class="inventory-tab ${expenditureActiveTab === 'supervisor' ? 'active' : ''}" data-tab="supervisor">Supervisor</button>`;
    }
    if (role === 'manager' || role === 'admin') {
        tabsHtml += `<button class="inventory-tab ${expenditureActiveTab === 'manager' ? 'active' : ''}" data-tab="manager">Manager</button>`;
    }
    if (role === 'admin') {
        tabsHtml += `<button class="inventory-tab ${expenditureActiveTab === 'admin' ? 'active' : ''}" data-tab="admin">Admin</button>`;
    }
    tabBar.innerHTML = tabsHtml;
    container.appendChild(tabBar);

    tabBar.querySelectorAll('.inventory-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            expenditureActiveTab = btn.dataset.tab;
            renderExpenditureView();
        });
    });

    // Entry form (supervisor only)
    if (role === 'supervisor') {
        const formCard = document.createElement('div');
        formCard.className = 'invoice-form-card';
        formCard.style.margin = '16px 24px';
        formCard.innerHTML = `
            <h4 style="margin:0 0 16px;font-family:var(--font-display);">Add Expenditure</h4>
            <div class="invoice-form-row">
                <div class="invoice-form-field" style="flex:2;">
                    <label>Paid To</label>
                    <input type="text" id="expPaidTo" placeholder="Person / vendor name">
                </div>
                <div class="invoice-form-field" style="flex:1;">
                    <label>Amount</label>
                    <input type="number" id="expAmount" placeholder="0.00" min="0" step="0.01">
                </div>
            </div>
            <div class="invoice-form-row">
                <div class="invoice-form-field" style="flex:2;">
                    <label>Reason</label>
                    <input type="text" id="expReason" placeholder="Purpose of payment">
                </div>
                <div class="invoice-form-field" style="flex:1;">
                    <label>Approved By</label>
                    <input type="text" id="expApprovedBy" placeholder="Approver name">
                </div>
            </div>
            <div class="invoice-form-row">
                <div class="invoice-form-field" style="flex:1;">
                    <label>Date</label>
                    <input type="date" id="expDate" value="${new Date().toISOString().slice(0, 10)}">
                </div>
            </div>
            <div class="invoice-form-actions">
                <button id="saveExpenditureBtn" class="btn-primary">Save Expenditure</button>
            </div>
        `;
        container.appendChild(formCard);

        document.getElementById('saveExpenditureBtn').addEventListener('click', async () => {
            const paidTo = document.getElementById('expPaidTo').value.trim();
            const amount = parseFloat(document.getElementById('expAmount').value);
            const reason = document.getElementById('expReason').value.trim();
            const approvedBy = document.getElementById('expApprovedBy').value.trim();
            const date = document.getElementById('expDate').value;

            if (!paidTo || isNaN(amount) || amount <= 0 || !reason || !date) {
                showToast('Please fill all required fields', true);
                return;
            }

            try {
                await apiPost('/api/expenditure', {
                    venture_id: v.id,
                    paid_to: paidTo,
                    amount: amount,
                    reason: reason,
                    approved_by: approvedBy,
                    date: date
                });
                showToast('Expenditure saved');
                document.getElementById('expPaidTo').value = '';
                document.getElementById('expAmount').value = '';
                document.getElementById('expReason').value = '';
                document.getElementById('expApprovedBy').value = '';
                await loadExpenditures(v.id);
                renderExpenditureView();
            } catch (err) {
                showToast('Failed to save expenditure', true);
            }
        });
    }

    // List wrapper
    const listWrapper = document.createElement('div');
    listWrapper.className = 'grid-container';
    listWrapper.style.padding = '0 24px 24px';
    renderExpenditureList(listWrapper);
    container.appendChild(listWrapper);
}

// ========================
// Material Leakage Widget
// ========================

async function renderMaterialLeakageWidget(container, ventureId) {
    if (!container || !ventureId) return;
    container.innerHTML = '<div style="padding:16px;color:#888;">Loading leakage data...</div>';
    try {
        const rows = await apiGet(`/api/materials/leakage-check?venture_id=${encodeURIComponent(ventureId)}`);
        if (!rows.length) {
            container.innerHTML = '<div style="padding:16px;color:#888;">No materials data available.</div>';
            return;
        }
        const flagged = rows.filter(r => r.discrepancy_flag || r.short_delivery_flag);
        let html = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">`;
        html += `<h4 style="margin:0;font-size:0.95rem;">Material Leakage Detection</h4>`;
        if (flagged.length > 0) {
            html += `<span style="background:#f5f5f5;padding:2px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;">${flagged.length} flagged</span>`;
        }
        html += '</div>';

        html += '<table class="tracker-table" style="font-size:0.82rem;">';
        html += '<thead><tr><th>Material</th><th>Ordered</th><th>Received</th><th>Used</th><th>Wasted</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead><tbody>';
        rows.forEach(r => {
            const isFlagged = r.discrepancy_flag || r.short_delivery_flag;
            const rowStyle = isFlagged ? ' style="background:#f5f5f5;"' : '';
            const wastedStyle = (r.wasted_qty || 0) > 0 ? ' style="color:#e74c3c;font-weight:600;"' : '';
            let status = 'OK';
            if (r.discrepancy_flag) status = '⚠ Discrepancy';
            else if (r.short_delivery_flag) status = 'Short Delivery';
            html += `<tr${rowStyle}><td>${r.material_name}</td><td>${r.ordered_qty} ${r.unit}</td><td>${r.received_qty} ${r.unit}</td><td>${r.consumed_qty} ${r.unit}</td><td${wastedStyle}>${r.wasted_qty || 0} ${r.unit}</td><td>${r.expected_remaining} ${r.unit}</td><td>${r.actual_balance} ${r.unit}</td><td>${status}</td></tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<div style="padding:16px;color:#c0392b;">Error: ${err.message}</div>`;
    }
}


// ========================
// Inline Autosave Helper
// ========================

const autosaveTimers = new Map();

function attachInlineAutosave(element, cellId, field, valueExtractor) {
    if (!element) return;
    const eventType = element.tagName === 'SELECT' ? 'change' : 'input';
    element.addEventListener(eventType, () => {
        const value = valueExtractor ? valueExtractor(element) : element.value;
        const key = `${cellId}_${field}`;
        if (autosaveTimers.has(key)) clearTimeout(autosaveTimers.get(key));
        const timer = setTimeout(async () => {
            try {
                const existing = cellsCache[cacheKey(cellId)] || {};
                const updated = { ...existing, [field]: value, updated_at: new Date().toISOString() };
                await apiPost('/api/cells/batch', { cells: [{ id: cellId, data: updated }] });
                cellsCache[cacheKey(cellId)] = updated;
                showToast('Saved');
            } catch (err) {
                showToast('Save failed', true);
            }
            autosaveTimers.delete(key);
        }, 800);
        autosaveTimers.set(key, timer);
    });
}

// ========================
// Feature 1: Interior Design Studio
// ========================

let dgSelectedFile = null;
let dgCurrentDesignId = null;
let dgPollTimer = null;
let dgHistory = [];

function initDesignGenerator() {
    const uploadZone = document.getElementById('dgUploadZone');
    const fileInput = document.getElementById('dgImageInput');
    const preview = document.getElementById('dgImagePreview');
    const prompt = document.querySelector('.dg-upload-prompt');
    const generateBtn = document.getElementById('dgGenerateBtn');

    if (!uploadZone || !fileInput) return;

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('drag-over');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleDesignImage(file);
    });
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) handleDesignImage(file);
    });

    function handleDesignImage(file) {
        if (!file.type.startsWith('image/')) {
            showToast('Please upload an image file', true);
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showToast('Image must be under 5 MB', true);
            return;
        }
        dgSelectedFile = file;
        const url = URL.createObjectURL(file);
        preview.src = url;
        preview.style.display = '';
        if (prompt) prompt.style.display = 'none';
        generateBtn.disabled = false;
    }

    generateBtn.addEventListener('click', async () => {
        if (!dgSelectedFile) return;
        generateBtn.disabled = true;
        document.getElementById('dgLoading').style.display = '';
        document.getElementById('dgGallery').style.display = 'none';
        document.getElementById('dgPromptBox').style.display = 'none';

        const formData = new FormData();
        formData.append('image', dgSelectedFile);
        formData.append('room_type', document.getElementById('dgRoomType').value);
        formData.append('style', document.getElementById('dgStyle').value);
        formData.append('budget_tier', document.getElementById('dgBudgetTier').value);
        const areaSqft = document.getElementById('dgAreaSqft');
        formData.append('area_sqft', areaSqft && areaSqft.value ? areaSqft.value : '120');

        try {
            const res = await fetch('/api/interior-design/generate', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            dgCurrentDesignId = data.id;
            startDesignPolling(data.id);
        } catch (err) {
            showToast(err.message, true);
            document.getElementById('dgLoading').style.display = 'none';
            generateBtn.disabled = false;
        }
    });
}

function startDesignPolling(designId) {
    stopDesignPolling();
    let attempts = 0;
    dgPollTimer = setInterval(async () => {
        attempts++;
        try {
            const data = await apiGet(`/api/interior-design/${designId}/status`);
            if (data.status === 'completed' || data.status === 'failed' || attempts > 40) {
                stopDesignPolling();
                renderDesignResult(data);
                renderDesignGeneratorHistory();
            }
        } catch (err) {
            console.error('Design poll error:', err);
        }
    }, 1500);
}

function stopDesignPolling() {
    if (dgPollTimer) {
        clearInterval(dgPollTimer);
        dgPollTimer = null;
    }
}

function renderDesignResult(data) {
    document.getElementById('dgLoading').style.display = 'none';
    document.getElementById('dgGenerateBtn').disabled = false;
    const gallery = document.getElementById('dgGallery');
    const promptBox = document.getElementById('dgPromptBox');
    const promptText = document.getElementById('dgPromptText');

    gallery.innerHTML = '';
    const images = (data.generated_images || []).filter(img => img && img.url);
    if (images.length === 0) {
        const failures = (data.generated_images || []).filter(img => img && !img.url && img.error);
        const details = failures.length
            ? `<ul style="margin:8px 0 0 20px;font-size:13px;">${failures.map(f => `<li>Seed ${f.seed}: ${escapeHtml(f.error)}</li>`).join('')}</ul>`
            : '';
        gallery.innerHTML = `<div style="padding:20px;color:#c0392b;">${escapeHtml(data.error_message || 'No images were generated.')}${details}</div>`;
        gallery.style.display = '';
        return;
    }

    images.forEach((img, idx) => {
        const card = document.createElement('div');
        card.className = 'dg-result-card';
        const cost = data.cost_estimate || {};
        card.innerHTML = `
            <img src="${escapeHtml(img.url)}" alt="Generated design" loading="lazy">
            <div class="dg-result-meta">
                <h4>Generated Design</h4>
                <div class="dg-result-cost">Est. ${cost.currency || 'INR'} ${(cost.total_estimate || 0).toLocaleString()} (${cost.area_sqft || cost.sample_area_sqft || 120} sqft)</div>
                <div class="dg-result-actions">
                    <button class="btn-primary dg-download-btn" data-url="${escapeHtml(img.url)}" data-idx="${idx}">Download</button>
                </div>
            </div>
        `;
        gallery.appendChild(card);
    });

    gallery.querySelectorAll('.dg-download-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            downloadImage(btn.dataset.url, `design_${data.id}_v${parseInt(btn.dataset.idx) + 1}.jpg`);
        });
    });
    gallery.style.display = '';

    if (data.enhanced_prompt) {
        promptText.textContent = data.enhanced_prompt;
        promptBox.style.display = '';
    }
}

async function downloadImage(url, filename) {
    try {
        const res = await fetch(url);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(a.href);
        a.remove();
    } catch (err) {
        showToast('Download failed', true);
    }
}

async function renderDesignGeneratorHistory() {
    const container = document.getElementById('dgHistoryList');
    if (!container) return;
    try {
        const data = await apiGet('/api/interior-design/history');
        dgHistory = data || [];
    } catch (err) {
        dgHistory = [];
    }
    container.innerHTML = '';
    if (!dgHistory.length) {
        container.innerHTML = '<div style="color:#888;padding:12px 0;">No designs yet.</div>';
        return;
    }
    dgHistory.slice(0, 8).forEach(item => {
        const first = (item.generated_images || []).find(img => img && img.url);
        const el = document.createElement('div');
        el.className = 'dg-history-item';
        el.innerHTML = `
            ${first ? `<img src="${escapeHtml(first.url)}" alt="">` : '<div style="height:120px;background:#f0f0f0;border-radius:8px;margin-bottom:8px;"></div>'}
            <div class="dg-history-title">${escapeHtml(item.room_type || '')} &bull; ${escapeHtml(item.style || '')}</div>
            <div class="dg-history-meta">${escapeHtml(item.budget_tier || '')} &bull; ${item.status}</div>
        `;
        el.addEventListener('click', () => {
            dgCurrentDesignId = item.id;
            renderDesignResult(item);
        });
        container.appendChild(el);
    });
}

// ========================
// Feature 2: Construction Stock Purchases
// ========================

let spMaterials = [];
let spCategories = ['All', 'Structural', 'Electrical', 'Plumbing', 'Finishes', 'Hardware', 'Flooring', 'Ceiling'];
let spSelectedCategory = 'All';

async function renderStockPurchases() {
    const catBar = document.getElementById('spCategoryBar');
    const grid = document.getElementById('spMaterialsGrid');
    if (!catBar || !grid) return;

    renderSPCategories();
    try {
        spMaterials = await apiGet('/api/marketplace/materials');
    } catch (err) {
        spMaterials = [];
    }
    renderSPMaterials();
}

function renderSPCategories() {
    const catBar = document.getElementById('spCategoryBar');
    if (!catBar) return;
    const isAdmin = currentUserRole === 'admin';
    catBar.innerHTML = '';
    spCategories.forEach(cat => {
        const chip = document.createElement('button');
        chip.className = 'sp-category-chip' + (cat === spSelectedCategory ? ' active' : '') + (isAdmin ? '' : ' disabled');
        chip.textContent = cat;
        chip.disabled = !isAdmin;
        if (isAdmin) {
            chip.addEventListener('click', () => {
                spSelectedCategory = cat;
                renderSPCategories();
                renderSPMaterials();
            });
        }
        catBar.appendChild(chip);
    });
}

function renderSPMaterials() {
    const grid = document.getElementById('spMaterialsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const filtered = spSelectedCategory === 'All'
        ? spMaterials
        : spMaterials.filter(m => (m.category || '').toLowerCase() === spSelectedCategory.toLowerCase());

    if (!filtered.length) {
        grid.innerHTML = '<div style="grid-column:1/-1;color:#888;padding:20px;">No materials found.</div>';
        return;
    }

    filtered.forEach(m => {
        const card = document.createElement('div');
        card.className = 'sp-material-card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="sp-material-category">${escapeHtml(m.category || '')}</div>
            <div class="sp-material-name">${escapeHtml(m.name || '')}</div>
            <div class="sp-material-unit">${escapeHtml(m.unit || '')}</div>
            ${m.description ? `<div class="sp-material-desc">${escapeHtml(m.description)}</div>` : ''}
            <div class="sp-material-hint" style="font-size:0.75rem;color:#888;margin-top:8px;">Click to see suppliers & prices</div>
        `;
        card.addEventListener('click', () => openSPSupplierDrawer(m));
        grid.appendChild(card);
    });
}

async function openSPSupplierDrawer(material) {
    const drawer = document.getElementById('spSupplierDrawer');
    const title = document.getElementById('spDrawerTitle');
    const list = document.getElementById('spSuppliersList');
    if (!drawer || !title || !list) return;

    title.textContent = `${escapeHtml(material.name || '')} — Suppliers`;
    list.innerHTML = '<div style="padding:20px;color:#888;">Loading suppliers...</div>';
    drawer.style.display = '';
    drawer.classList.add('open');

    try {
        const suppliers = await apiGet(`/api/marketplace/materials/${material.id}/suppliers`);
        if (!suppliers.length) {
            list.innerHTML = '<div style="padding:20px;color:#888;">No suppliers found for this material.</div>';
            return;
        }
        list.innerHTML = suppliers.map(s => `
            <div class="sp-supplier-card">
                <div class="sp-supplier-brand">${escapeHtml(s.brand_name || '—')}</div>
                <div class="sp-supplier-company">${escapeHtml(s.company_name || '')}</div>
                <div class="sp-supplier-price">₹${s.price_low || 0} – ₹${s.price_high || 0}</div>
                <div class="sp-supplier-trust">${escapeHtml(s.trust_level || '')}</div>
                <div class="sp-supplier-contact">
                    ${s.phone ? `<div>📞 ${escapeHtml(s.phone)}</div>` : ''}
                    ${s.email ? `<div>✉ ${escapeHtml(s.email)}</div>` : ''}
                </div>
            </div>
        `).join('');
    } catch (err) {
        list.innerHTML = '<div style="padding:20px;color:#c0392b;">Failed to load suppliers.</div>';
    }
}

function closeSPSupplierDrawer() {
    const drawer = document.getElementById('spSupplierDrawer');
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.style.display = 'none';
}

function initStockPurchases() {
    // Filter interactions are wired in renderSPCategories per role.
    const closeBtn = document.getElementById('spCloseDrawer');
    if (closeBtn && !closeBtn._bound) {
        closeBtn.addEventListener('click', closeSPSupplierDrawer);
        closeBtn._bound = true;
    }
}

