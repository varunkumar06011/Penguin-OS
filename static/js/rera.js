// ============================================================
// RERA QPR Module - Frontend Logic
// ============================================================

// --- API helpers ---
async function apiGet(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}
async function apiPost(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
}
async function apiPut(path, body) {
    const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
}
async function apiDelete(path) {
    const r = await fetch(path, { method: 'DELETE' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatINR(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function progressBar(pct) {
    const cls = pct >= 75 ? 'high' : pct >= 40 ? 'mid' : pct > 0 ? 'low' : 'zero';
    return `<div class="progress-bar-container"><div class="progress-bar-fill ${cls}" style="width:${Math.min(pct, 100)}%;">${pct}%</div></div>`;
}

// --- Tab switching ---
function showReraTab(tabName) {
    document.querySelectorAll('.rera-sidebar-item').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.rera-tab-content').forEach(c => c.classList.remove('active'));
    const sidebarItem = document.querySelector('.rera-sidebar-item[data-tab="' + tabName + '"]');
    if (sidebarItem) sidebarItem.classList.add('active');
    const tabContent = document.getElementById('tab-' + tabName);
    if (tabContent) tabContent.classList.add('active');
    if (window.innerWidth <= 900) {
        document.getElementById('reraApp').classList.remove('sidebar-open');
    }
}

document.querySelectorAll('.rera-sidebar-item').forEach(item => {
    item.addEventListener('click', () => showReraTab(item.dataset.tab));
});

const reraSidebarToggle = document.getElementById('reraSidebarToggle');
const reraSidebarScrim = document.getElementById('reraSidebarScrim');
if (reraSidebarToggle) {
    reraSidebarToggle.addEventListener('click', () => {
        document.getElementById('reraApp').classList.toggle('sidebar-open');
    });
}
if (reraSidebarScrim) {
    reraSidebarScrim.addEventListener('click', () => {
        document.getElementById('reraApp').classList.remove('sidebar-open');
    });
}

// --- Logout ---
document.getElementById('reraLogout').addEventListener('click', async () => {
    await fetch('/logout', { method: 'POST' });
    window.location.href = '/login';
});

// --- Load ventures into all dropdowns ---
async function loadVentures() {
    try {
        const ventures = await apiGet('/api/ventures');
        const dropdowns = ['reraReadinessVenture', 'reraDraftVenture', 'reraFiledVenture', 'reraApprovalsVenture', 'reraThresholdVenture'];
        dropdowns.forEach(id => {
            const sel = document.getElementById(id);
            if (!sel) return;
            const currentValue = sel.value;
            const isThreshold = id === 'reraThresholdVenture';
            sel.innerHTML = isThreshold
                ? '<option value="">Global defaults</option>'
                : '<option value="">Select project...</option>';
            ventures.forEach(v => {
                const vid = v.id || v.venture_id || '';
                const vname = v.name || v.project_name || vid;
                sel.innerHTML += `<option value="${escapeHtml(vid)}">${escapeHtml(vname)}</option>`;
            });
            if (currentValue) sel.value = currentValue;
        });
    } catch (e) {
        console.error('Error loading ventures:', e);
    }
}

// --- Current quarter helper ---
function currentQuarterLabel() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    if (month <= 3) return `${year}-Q1`;
    if (month <= 6) return `${year}-Q2`;
    if (month <= 9) return `${year}-Q3`;
    return `${year}-Q4`;
}

// Pre-fill quarter field
const draftQuarterInput = document.getElementById('reraDraftQuarter');
if (draftQuarterInput) draftQuarterInput.value = currentQuarterLabel();

// ============================================================
// Tab 1: Readiness Dashboard
// ============================================================

document.getElementById('reraLoadReadinessBtn').addEventListener('click', async () => {
    const ventureId = document.getElementById('reraReadinessVenture').value;
    if (!ventureId) { alert('Please select a project'); return; }
    const el = document.getElementById('reraReadinessContent');
    el.innerHTML = '<div class="rera-empty">Loading...</div>';
    try {
        const data = await apiGet(`/api/rera/readiness/${ventureId}`);
        el.innerHTML = renderReadiness(data);
    } catch (e) {
        el.innerHTML = `<div class="rera-empty">Error: ${escapeHtml(e.message)}</div>`;
    }
});

function renderReadiness(data) {
    const q = data.quarter || {};
    const progress = data.progress || {};
    const fin = data.financials || {};
    const checklist = data.checklist || [];
    const existing = data.existing_report;

    let html = '';

    // Quarter countdown
    const days = q.days_remaining;
    const countdownClass = days < 0 ? 'urgent' : days <= 7 ? 'urgent' : days <= 15 ? 'warning' : 'ok';
    const countdownText = days < 0 ? `OVERDUE by ${Math.abs(days)} days` : `${days} days remaining`;
    html += `<div class="rera-card no-print">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
            <div>
                <h3 style="margin:0 0 4px;">Quarter ${escapeHtml(q.label)}</h3>
                <p style="color:#888;margin:0;font-size:0.82rem;">${q.start} to ${q.end} &middot; Filing deadline: ${q.filing_deadline}</p>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
                <span class="countdown-badge ${countdownClass}">${countdownText}</span>
                ${existing ? (existing.status === 'locked' || existing.status === 'submitted'
                    ? '<span class="locked-badge">Report Locked</span>'
                    : '<span class="draft-badge">Draft Exists</span>') : ''}
            </div>
        </div>
    </div>`;

    // Stat cards
    html += '<div class="stat-grid">';
    html += `<div class="stat-card"><h4>Overall Completion</h4><div class="stat-value">${progress.overall_pct || 0}%</div><div class="stat-sub">${(progress.blocks || []).length} blocks tracked</div></div>`;
    html += `<div class="stat-card"><h4>Funds Collected</h4><div class="stat-value">&#8377;${formatINR(fin.collected)}</div><div class="stat-sub">From paid invoices</div></div>`;
    html += `<div class="stat-card"><h4>Funds Utilized</h4><div class="stat-value">&#8377;${formatINR(fin.utilized)}</div><div class="stat-sub">From expenditures</div></div>`;
    html += `<div class="stat-card"><h4>Escrow Balance</h4><div class="stat-value" style="color:${fin.escrow_balance >= 0 ? '#27ae60' : '#c0392b'};">&#8377;${formatINR(fin.escrow_balance)}</div><div class="stat-sub">Collected - Utilized</div></div>`;
    html += '</div>';

    // Progress per block
    html += '<div class="rera-card"><h3>Construction Progress by Block</h3>';
    if (!progress.blocks || !progress.blocks.length) {
        html += '<div class="rera-empty">No cell data found for this project.</div>';
    } else {
        html += '<table class="rera-table"><thead><tr><th>Block</th><th>Cells</th><th>% Complete</th><th>Progress</th></tr></thead><tbody>';
        progress.blocks.forEach(b => {
            html += `<tr><td><strong>${escapeHtml(b.block)}</strong></td><td>${b.cell_count}</td><td>${b.pct_complete}%</td><td style="min-width:200px;">${progressBar(b.pct_complete)}</td></tr>`;
        });
        html += '</tbody></table>';
    }
    html += '</div>';

    // Compliance checklist
    html += '<div class="rera-card"><h3>Form B Compliance Checklist</h3>';
    html += '<p style="color:#888;font-size:0.82rem;margin-bottom:12px;">Each field is checked against its underlying data source. <span class="checklist-dot red" style="display:inline-block;vertical-align:middle;"></span> = no data source, <span class="checklist-dot yellow" style="display:inline-block;vertical-align:middle;"></span> = incomplete, <span class="checklist-dot green" style="display:inline-block;vertical-align:middle;"></span> = ready.</p>';
    checklist.forEach(item => {
        html += `<div class="checklist-row">
            <span class="checklist-dot ${item.status}"></span>
            <span class="checklist-field">${escapeHtml(item.field)}</span>
            <span class="checklist-source">${escapeHtml(item.source)}</span>
            <span class="checklist-detail">${escapeHtml(item.detail)}</span>
        </div>`;
    });
    html += '</div>';

    return html;
}

// ============================================================
// Tab 2: Quarterly Draft Report
// ============================================================

let currentDraft = null;

document.getElementById('reraGenerateDraftBtn').addEventListener('click', async () => {
    const ventureId = document.getElementById('reraDraftVenture').value;
    const quarter = document.getElementById('reraDraftQuarter').value.trim();
    if (!ventureId) { alert('Please select a project'); return; }
    if (!quarter) { alert('Please enter a quarter (e.g. 2026-Q2)'); return; }
    const el = document.getElementById('reraDraftContent');
    el.innerHTML = '<div class="rera-empty">Generating draft...</div>';
    try {
        currentDraft = await apiGet(`/api/rera/draft/${ventureId}/${quarter}`);
        el.innerHTML = renderDraft(currentDraft);
    } catch (e) {
        el.innerHTML = `<div class="rera-empty">Error: ${escapeHtml(e.message)}</div>`;
    }
});

function renderDraft(d) {
    const progress = d.construction_progress || {};
    const fin = d.financial_updates || {};
    const units = d.unit_status || {};
    const milestones = d.milestone_status || [];
    const approvals = d.compliance_status || [];
    const delays = d.delays_issues || [];

    let html = '';

    // Meta header
    html += `<div class="rera-card formb-meta no-print">
        <div class="formb-meta-row">
            <div class="formb-meta-item"><strong>Project:</strong> ${escapeHtml(d.venture_name)}</div>
            <div class="formb-meta-item"><strong>Quarter:</strong> ${escapeHtml(d.quarter)}</div>
            <div class="formb-meta-item"><strong>Period:</strong> ${d.quarter_start} to ${d.quarter_end}</div>
            <div class="formb-meta-item"><strong>Filing Deadline:</strong> ${d.filing_deadline}</div>
            <div class="formb-meta-item"><strong>Generated:</strong> ${new Date(d.generated_at).toLocaleString('en-IN')}</div>
        </div>
        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
            <button class="rera-btn rera-btn-secondary" onclick="window.print()">Export PDF (Print)</button>
            <button class="rera-btn rera-btn-success" id="reraSubmitLockBtn">Submit &amp; Lock</button>
        </div>
    </div>`;

    // Printable report header
    html += `<div class="rera-card">
        <div style="text-align:center;margin-bottom:20px;">
            <h2 style="margin:0 0 4px;">RERA Quarterly Progress Report</h2>
            <p style="color:#888;margin:0;">Form B &middot; ${escapeHtml(d.venture_name)} &middot; ${escapeHtml(d.quarter)}</p>
        </div>`;

    // Section 1: Construction Progress
    html += '<div class="formb-section"><h4>1. Construction Progress</h4>';
    if (!progress.blocks || !progress.blocks.length) {
        html += '<p style="color:#888;">No construction data available.</p>';
    } else {
        html += `<p style="margin-bottom:12px;"><strong>Overall Completion: ${progress.overall_pct}%</strong></p>`;
        html += '<table class="rera-table"><thead><tr><th>Block</th><th>Cells Tracked</th><th>% Complete</th></tr></thead><tbody>';
        progress.blocks.forEach(b => {
            html += `<tr><td>${escapeHtml(b.block)}</td><td>${b.cell_count}</td><td>${b.pct_complete}%</td></tr>`;
        });
        html += '</tbody></table>';
    }
    html += '</div>';

    // Section 2: Financial Updates
    html += '<div class="formb-section"><h4>2. Financial Updates</h4>';
    html += '<table class="rera-table"><thead><tr><th>Item</th><th>Amount (INR)</th></tr></thead><tbody>';
    html += `<tr><td>Funds Collected</td><td>&#8377;${formatINR(fin.collected)}</td></tr>`;
    html += `<tr><td>Funds Utilized</td><td>&#8377;${formatINR(fin.utilized)}</td></tr>`;
    html += `<tr><td><strong>Escrow Balance</strong></td><td><strong>&#8377;${formatINR(fin.escrow_balance)}</strong></td></tr>`;
    html += '</tbody></table>';
    html += '</div>';

    // Section 3: Unit Status
    html += '<div class="formb-section"><h4>3. Unit Status</h4>';
    html += '<table class="rera-table"><thead><tr><th>Category</th><th>Count</th></tr></thead><tbody>';
    html += `<tr><td>Total Units</td><td>${units.total || 0}</td></tr>`;
    html += `<tr><td>Sold</td><td>${units.sold || 0}</td></tr>`;
    html += `<tr><td>Available</td><td>${units.available || 0}</td></tr>`;
    html += '</tbody></table>';
    if (!units.has_data) {
        html += '<p style="color:#c0392b;font-size:0.82rem;margin-top:8px;">Note: No sales/booking data source available. Sold count shows 0.</p>';
    }
    html += '</div>';

    // Section 4: Milestone Status
    html += '<div class="formb-section"><h4>4. Milestone Status</h4>';
    if (!milestones.length) {
        html += '<p style="color:#888;">No milestones recorded.</p>';
    } else {
        html += '<table class="rera-table"><thead><tr><th>Block</th><th>Work Item</th><th>Completion Date</th><th>Updated By</th></tr></thead><tbody>';
        milestones.forEach(m => {
            html += `<tr><td>${escapeHtml(m.block)}</td><td>${escapeHtml(m.work_item)}</td><td>${escapeHtml(m.actual_date)}</td><td>${escapeHtml(m.changed_by)}</td></tr>`;
        });
        html += '</tbody></table>';
    }
    html += '</div>';

    // Section 5: Compliance Status
    html += '<div class="formb-section"><h4>5. Compliance Status (Statutory Approvals)</h4>';
    if (!approvals.length) {
        html += '<p style="color:#888;">No statutory approvals recorded.</p>';
    } else {
        html += '<table class="rera-table"><thead><tr><th>Approval</th><th>Authority</th><th>Issued</th><th>Expiry</th><th>Status</th><th>Remarks</th></tr></thead><tbody>';
        approvals.forEach(a => {
            html += `<tr><td>${escapeHtml(a.approval_name)}</td><td>${escapeHtml(a.issuing_authority)}</td><td>${a.issued_date || '-'}</td><td>${a.expiry_date || '-'}</td><td>${escapeHtml(a.status)}</td><td>${escapeHtml(a.remarks)}</td></tr>`;
        });
        html += '</tbody></table>';
    }
    html += '</div>';

    // Section 6: Delays & Issues
    html += '<div class="formb-section"><h4>6. Delays & Issues</h4>';
    if (!delays.length) {
        html += '<p style="color:#888;">No delays or issues logged for this quarter.</p>';
    } else {
        html += '<table class="rera-table"><thead><tr><th>Block</th><th>Floor</th><th>Work Item</th><th>Delay (days)</th><th>Reason</th></tr></thead><tbody>';
        delays.forEach(dl => {
            html += `<tr><td>${escapeHtml(dl.block)}</td><td>${escapeHtml(dl.floor)}</td><td>${escapeHtml(dl.work_item)}</td><td>${dl.delay_days}</td><td>${escapeHtml(dl.reason)}</td></tr>`;
        });
        html += '</tbody></table>';
    }
    html += '</div>';

    // Add delay form (no-print)
    html += `<div class="formb-section no-print"><h4>Add Delay Entry</h4>
        <div class="rera-form-row">
            <div class="rera-form-field"><label>Block</label><input type="text" id="reraDelayBlock" placeholder="e.g. A Block"></div>
            <div class="rera-form-field"><label>Floor</label><input type="text" id="reraDelayFloor" placeholder="e.g. 1st Floor"></div>
            <div class="rera-form-field"><label>Work Item</label><input type="text" id="reraDelayWorkItem" placeholder="e.g. PLASTERING"></div>
            <div class="rera-form-field"><label>Delay (days)</label><input type="number" id="reraDelayDays" placeholder="7" value="0"></div>
            <div class="rera-form-field" style="flex:2;"><label>Reason</label><input type="text" id="reraDelayReason" placeholder="Shortage of labour"></div>
            <div class="rera-form-field" style="align-self:flex-end;"><button id="reraAddDelayBtn" class="rera-btn rera-btn-primary">Add</button></div>
        </div>
    </div>`;

    html += '</div>'; // close rera-card

    // Bind submit & lock
    setTimeout(() => {
        const submitBtn = document.getElementById('reraSubmitLockBtn');
        if (submitBtn) submitBtn.addEventListener('click', submitLockReport);
        const addDelayBtn = document.getElementById('reraAddDelayBtn');
        if (addDelayBtn) addDelayBtn.addEventListener('click', addDelayEntry);
    }, 0);

    return html;
}

async function addDelayEntry() {
    const ventureId = document.getElementById('reraDraftVenture').value;
    const quarter = document.getElementById('reraDraftQuarter').value.trim();
    const block = document.getElementById('reraDelayBlock').value.trim();
    const floor = document.getElementById('reraDelayFloor').value.trim();
    const work_item = document.getElementById('reraDelayWorkItem').value.trim();
    const delay_days = parseInt(document.getElementById('reraDelayDays').value) || 0;
    const reason = document.getElementById('reraDelayReason').value.trim();
    if (!ventureId || !quarter) { alert('Project and quarter required'); return; }
    try {
        await apiPost('/api/rera/delays', { venture_id: ventureId, quarter, block, floor, work_item, delay_days, reason });
        // Re-generate draft to show updated delays
        document.getElementById('reraGenerateDraftBtn').click();
    } catch (e) { alert(e.message); }
}

async function submitLockReport() {
    if (!currentDraft) { alert('No draft to submit'); return; }
    if (!confirm('Submit and lock this quarterly report? Once locked, the snapshot cannot be modified. This action requires the promoter\'s authorized signatory review before filing to RERA.')) return;
    try {
        const result = await apiPost('/api/rera/report/submit', {
            venture_id: currentDraft.venture_id,
            quarter: currentDraft.quarter,
            report_data: currentDraft
        });
        alert('Report locked successfully! This snapshot is now immutable.');
        // Switch to filed reports tab
        showReraTab('filed');
        document.getElementById('reraFiledVenture').value = currentDraft.venture_id;
        document.getElementById('reraLoadFiledBtn').click();
    } catch (e) { alert(e.message); }
}

// ============================================================
// Tab 3: Filed Reports
// ============================================================

document.getElementById('reraLoadFiledBtn').addEventListener('click', async () => {
    const ventureId = document.getElementById('reraFiledVenture').value;
    if (!ventureId) { alert('Please select a project'); return; }
    const el = document.getElementById('reraFiledContent');
    el.innerHTML = '<div class="rera-empty">Loading...</div>';
    try {
        const reports = await apiGet(`/api/rera/reports/${ventureId}`);
        el.innerHTML = renderFiledReports(reports);
    } catch (e) {
        el.innerHTML = `<div class="rera-empty">Error: ${escapeHtml(e.message)}</div>`;
    }
});

function renderFiledReports(reports) {
    if (!reports.length) return '<div class="rera-empty">No filed reports yet. Generate and lock a quarterly draft first.</div>';
    let html = '<table class="rera-table"><thead><tr><th>Quarter</th><th>Period</th><th>Filing Deadline</th><th>Status</th><th>Submitted By</th><th>Submitted At</th><th>Action</th></tr></thead><tbody>';
    reports.forEach(r => {
        const statusBadge = r.status === 'locked' || r.status === 'submitted'
            ? '<span class="locked-badge">Locked</span>'
            : '<span class="draft-badge">Draft</span>';
        html += `<tr>
            <td><strong>${escapeHtml(r.quarter)}</strong></td>
            <td>${r.quarter_start} to ${r.quarter_end}</td>
            <td>${r.filing_deadline}</td>
            <td>${statusBadge}</td>
            <td>${escapeHtml(r.submitted_by || '-')}</td>
            <td>${r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-IN') : '-'}</td>
            <td><button class="rera-btn rera-btn-secondary" style="padding:6px 12px;font-size:0.8rem;" onclick="viewFiledReport('${r.id}')">View</button></td>
        </tr>`;
    });
    html += '</tbody></table>';
    html += '<div id="reraFiledDetail" style="margin-top:20px;"></div>';
    return html;
}

async function viewFiledReport(reportId) {
    const el = document.getElementById('reraFiledDetail');
    if (!el) return;
    el.innerHTML = '<div class="rera-empty">Loading report...</div>';
    try {
        const report = await apiGet(`/api/rera/report/${reportId}`);
        const d = report.report_data || {};
        el.innerHTML = renderFiledDetail(report, d);
    } catch (e) {
        el.innerHTML = `<div class="rera-empty">Error: ${escapeHtml(e.message)}</div>`;
    }
}

function renderFiledDetail(report, d) {
    const progress = d.construction_progress || {};
    const fin = d.financial_updates || {};
    const units = d.unit_status || {};
    const milestones = d.milestone_status || [];
    const approvals = d.compliance_status || [];
    const delays = d.delays_issues || [];

    let html = `<div class="rera-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <h3 style="margin:0;">Locked Report: ${escapeHtml(report.quarter)}</h3>
            <div>
                <span class="locked-badge">Immutable Snapshot</span>
                <button class="rera-btn rera-btn-secondary no-print" style="margin-left:8px;padding:6px 12px;font-size:0.8rem;" onclick="window.print()">Print</button>
            </div>
        </div>
        <div class="formb-meta">
            <div class="formb-meta-row">
                <div class="formb-meta-item"><strong>Project:</strong> ${escapeHtml(d.venture_name || report.venture_id)}</div>
                <div class="formb-meta-item"><strong>Period:</strong> ${d.quarter_start || report.quarter_start} to ${d.quarter_end || report.quarter_end}</div>
                <div class="formb-meta-item"><strong>Submitted By:</strong> ${escapeHtml(report.submitted_by || '')}</div>
                <div class="formb-meta-item"><strong>Submitted At:</strong> ${report.submitted_at ? new Date(report.submitted_at).toLocaleString('en-IN') : '-'}</div>
            </div>
        </div>`;

    // Section 1
    html += '<div class="formb-section"><h4>1. Construction Progress</h4>';
    html += `<p><strong>Overall: ${progress.overall_pct || 0}%</strong></p>`;
    if (progress.blocks && progress.blocks.length) {
        html += '<table class="rera-table"><thead><tr><th>Block</th><th>% Complete</th></tr></thead><tbody>';
        progress.blocks.forEach(b => { html += `<tr><td>${escapeHtml(b.block)}</td><td>${b.pct_complete}%</td></tr>`; });
        html += '</tbody></table>';
    }
    html += '</div>';

    // Section 2
    html += '<div class="formb-section"><h4>2. Financial Updates</h4>';
    html += '<table class="rera-table"><tbody>';
    html += `<tr><td>Funds Collected</td><td>&#8377;${formatINR(fin.collected)}</td></tr>`;
    html += `<tr><td>Funds Utilized</td><td>&#8377;${formatINR(fin.utilized)}</td></tr>`;
    html += `<tr><td><strong>Escrow Balance</strong></td><td><strong>&#8377;${formatINR(fin.escrow_balance)}</strong></td></tr>`;
    html += '</tbody></table></div>';

    // Section 3
    html += '<div class="formb-section"><h4>3. Unit Status</h4>';
    html += `<p>Total: ${units.total || 0} | Sold: ${units.sold || 0} | Available: ${units.available || 0}</p></div>`;

    // Section 4
    html += '<div class="formb-section"><h4>4. Milestones</h4>';
    if (milestones.length) {
        html += '<table class="rera-table"><thead><tr><th>Block</th><th>Work Item</th><th>Date</th></tr></thead><tbody>';
        milestones.forEach(m => { html += `<tr><td>${escapeHtml(m.block)}</td><td>${escapeHtml(m.work_item)}</td><td>${escapeHtml(m.actual_date)}</td></tr>`; });
        html += '</tbody></table>';
    } else { html += '<p style="color:#888;">None recorded.</p>'; }
    html += '</div>';

    // Section 5
    html += '<div class="formb-section"><h4>5. Statutory Approvals</h4>';
    if (approvals.length) {
        html += '<table class="rera-table"><thead><tr><th>Approval</th><th>Authority</th><th>Expiry</th><th>Status</th></tr></thead><tbody>';
        approvals.forEach(a => { html += `<tr><td>${escapeHtml(a.approval_name)}</td><td>${escapeHtml(a.issuing_authority)}</td><td>${a.expiry_date || '-'}</td><td>${escapeHtml(a.status)}</td></tr>`; });
        html += '</tbody></table>';
    } else { html += '<p style="color:#888;">None recorded.</p>'; }
    html += '</div>';

    // Section 6
    html += '<div class="formb-section"><h4>6. Delays & Issues</h4>';
    if (delays.length) {
        html += '<table class="rera-table"><thead><tr><th>Block</th><th>Work Item</th><th>Delay</th><th>Reason</th></tr></thead><tbody>';
        delays.forEach(dl => { html += `<tr><td>${escapeHtml(dl.block)}</td><td>${escapeHtml(dl.work_item)}</td><td>${dl.delay_days} days</td><td>${escapeHtml(dl.reason)}</td></tr>`; });
        html += '</tbody></table>';
    } else { html += '<p style="color:#888;">None logged.</p>'; }
    html += '</div>';

    html += '</div>';
    return html;
}

// ============================================================
// Tab 4: Statutory Approvals
// ============================================================

document.getElementById('reraApprovalsVenture').addEventListener('change', async () => {
    const ventureId = document.getElementById('reraApprovalsVenture').value;
    if (!ventureId) return;
    await loadApprovals(ventureId);
});

async function loadApprovals(ventureId) {
    const el = document.getElementById('reraApprovalsList');
    el.innerHTML = '<div class="rera-empty">Loading...</div>';
    try {
        const items = await apiGet(`/api/rera/approvals?venture_id=${ventureId}`);
        if (!items.length) { el.innerHTML = '<div class="rera-empty">No approvals recorded yet.</div>'; return; }
        let html = '<table class="rera-table"><thead><tr><th>Approval</th><th>Authority</th><th>Issued</th><th>Expiry</th><th>Status</th><th>Remarks</th><th>Action</th></tr></thead><tbody>';
        const today = new Date().toISOString().slice(0, 10);
        items.forEach(a => {
            let statusHtml = escapeHtml(a.status);
            if (a.status === 'active' && a.expiry_date) {
                const daysToExpiry = Math.floor((new Date(a.expiry_date) - new Date(today)) / (1000 * 60 * 60 * 24));
                if (daysToExpiry < 0) statusHtml = '<span style="color:#c0392b;font-weight:700;">Expired</span>';
                else if (daysToExpiry <= 30) statusHtml = `<span style="color:#e67e22;font-weight:700;">${escapeHtml(a.status)} (${daysToExpiry}d left)</span>`;
            } else if (a.status === 'expired') {
                statusHtml = '<span style="color:#c0392b;font-weight:700;">Expired</span>';
            }
            html += `<tr>
                <td>${escapeHtml(a.approval_name)}</td>
                <td>${escapeHtml(a.issuing_authority || '-')}</td>
                <td>${a.issued_date || '-'}</td>
                <td>${a.expiry_date || '-'}</td>
                <td>${statusHtml}</td>
                <td>${escapeHtml(a.remarks || '-')}</td>
                <td><button class="rera-btn rera-btn-danger" style="padding:4px 10px;font-size:0.75rem;" onclick="deleteApproval('${a.id}')">Delete</button></td>
            </tr>`;
        });
        html += '</tbody></table>';
        el.innerHTML = html;
    } catch (e) {
        el.innerHTML = `<div class="rera-empty">Error: ${escapeHtml(e.message)}</div>`;
    }
}

document.getElementById('reraAddApprovalBtn').addEventListener('click', async () => {
    const ventureId = document.getElementById('reraApprovalsVenture').value;
    if (!ventureId) { alert('Please select a project'); return; }
    const approval_name = document.getElementById('reraApName').value.trim();
    if (!approval_name) { alert('Approval name is required'); return; }
    const body = {
        venture_id: ventureId,
        approval_name,
        issuing_authority: document.getElementById('reraApAuthority').value.trim(),
        issued_date: document.getElementById('reraApIssued').value || null,
        expiry_date: document.getElementById('reraApExpiry').value || null,
        status: document.getElementById('reraApStatus').value,
        remarks: document.getElementById('reraApRemarks').value.trim()
    };
    try {
        await apiPost('/api/rera/approvals', body);
        ['reraApName', 'reraApAuthority', 'reraApIssued', 'reraApExpiry', 'reraApRemarks'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('reraApStatus').value = 'active';
        loadApprovals(ventureId);
    } catch (e) { alert(e.message); }
});

async function deleteApproval(id) {
    if (!confirm('Delete this approval record?')) return;
    try {
        await apiDelete(`/api/rera/approval/${id}`);
        const ventureId = document.getElementById('reraApprovalsVenture').value;
        loadApprovals(ventureId);
    } catch (e) { alert(e.message); }
}

// ============================================================
// Tab 5: Color Thresholds
// ============================================================

const RERA_COLORS = ['red', 'yellow', 'blue', 'green'];
const RERA_COLOR_HEX = { red: '#c0392b', yellow: '#f1c40f', blue: '#2980b9', green: '#27ae60' };

async function loadThresholds() {
    const el = document.getElementById('reraThresholdsGrid');
    if (!el) return;
    el.innerHTML = '<div class="rera-empty">Loading...</div>';
    try {
        const items = await apiGet('/api/rera/thresholds');
        const ventureId = document.getElementById('reraThresholdVenture').value;
        // Filter: show global defaults + venture-specific overrides
        const globalDefaults = items.filter(t => !t.venture_id);
        const ventureOverrides = items.filter(t => t.venture_id === ventureId);
        // Build a map: color -> value (venture override takes priority)
        const map = {};
        globalDefaults.forEach(t => { map[t.color] = t.pct_value; });
        ventureOverrides.forEach(t => { map[t.color] = t.pct_value; });
        let html = '<div class="rera-form-row">';
        RERA_COLORS.forEach(color => {
            html += `<div class="rera-form-field" style="max-width:200px;">
                <label><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${RERA_COLOR_HEX[color]};margin-right:6px;vertical-align:middle;"></span>${color}</label>
                <input type="number" id="reraThreshold_${color}" value="${map[color] !== undefined ? map[color] : ''}" step="0.01" min="0" max="100">
            </div>`;
        });
        html += '</div>';
        if (ventureId) {
            html += `<p style="color:#888;font-size:0.82rem;">These override the global defaults for this project only.</p>`;
        }
        el.innerHTML = html;
    } catch (e) {
        el.innerHTML = `<div class="rera-empty">Error: ${escapeHtml(e.message)}</div>`;
    }
}

document.getElementById('reraThresholdVenture').addEventListener('change', loadThresholds);

document.getElementById('reraSaveThresholdsBtn').addEventListener('click', async () => {
    const ventureId = document.getElementById('reraThresholdVenture').value || null;
    const payload = [];
    RERA_COLORS.forEach(color => {
        const val = document.getElementById(`reraThreshold_${color}`).value;
        if (val !== null && val !== '') {
            payload.push({ venture_id: ventureId, work_item: null, color, pct_value: parseFloat(val) });
        }
    });
    if (!payload.length) { alert('No values to save'); return; }
    try {
        await apiPost('/api/rera/thresholds', payload);
        alert('Thresholds saved successfully!');
    } catch (e) { alert(e.message); }
});

// ============================================================
// Initial Load
// ============================================================
loadVentures().then(() => {
    loadThresholds();
});
