// ========================
// Daily Business Report (WhatsApp Share)
// ========================

function formatDbrINR(num) {
    return '₹' + (Number(num) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function drawDbrPieChart(canvas, data) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 12;
    const colors = ['#FF9F43', '#FFB74D', '#FFCC80', '#FFE0B2', '#FFD699', '#FFF3E0'];

    ctx.clearRect(0, 0, width, height);
    if (!data || data.length === 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fillStyle = '#f0f0f0';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.55, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        return;
    }

    const total = data.reduce((s, d) => s + (Number(d.amount) || 0), 0) || 1;
    let start = -Math.PI / 2;
    data.forEach((item, i) => {
        const slice = ((Number(item.amount) || 0) / total) * 2 * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, start + slice);
        ctx.closePath();
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
        start += slice;
    });

    // Donut hole
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.55, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
}

function renderDailyReportCard(data) {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-10000px';
    wrapper.style.top = '0';
    wrapper.style.width = '800px';
    wrapper.style.zIndex = '-1';

    const userName = (typeof currentUser === 'string' && currentUser)
        ? currentUser.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : 'Admin';

    const safe = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
    const kpiIcon = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;">${path}</svg>`;

    const ventureAnalysis = data.venture_analysis || [];
    const pieColors = ['#FF9F43', '#FFB74D', '#FFCC80', '#FFE0B2', '#FFD699', '#FFF3E0'];
    const legendHtml = ventureAnalysis.length
        ? ventureAnalysis.map((v, i) => `
            <div class="dbr-legend-item">
                <span class="dbr-legend-dot" style="background:${pieColors[i % pieColors.length]};"></span>
                <span class="dbr-legend-name">${safe(v.name)}</span>
                <span class="dbr-legend-amt">${formatDbrINR(v.amount)}</span>
                <span class="dbr-legend-pct">${v.pct}%</span>
            </div>
        `).join('')
        : '<div class="dbr-empty">No venture data</div>';

    const dayBook = data.day_book || {};
    const dayBookRows = [
        { label: 'Opening Balance', value: dayBook.opening_balance || 0, color: '#333' },
        { label: 'Total Receipts', value: dayBook.total_receipts || 0, color: '#27ae60' },
        { label: 'Total Payments', value: dayBook.total_payments || 0, color: '#e74c3c' },
        { label: 'Closing Balance', value: dayBook.closing_balance || 0, color: '#333' },
    ];
    const dayBookHtml = dayBookRows.map(r => `
        <div class="dbr-daybook-row">
            <span class="dbr-daybook-label">${r.label}</span>
            <span class="dbr-daybook-val" style="color:${r.color};">${formatDbrINR(r.value)}</span>
        </div>
    `).join('');

    const workDone = data.work_done_by_venture || [];
    const workDoneRows = workDone.length
        ? workDone.map(v => `
            <tr>
                <td>${safe(v.name)}</td>
                <td>${formatDbrINR(v.amount)}</td>
                <td>
                    <div class="dbr-bar"><div class="dbr-bar-fill" style="width:${v.pct || 0}%;"></div></div>
                    <div style="font-size:10px;color:#666;text-align:right;margin-top:2px;">${v.pct || 0}%</div>
                </td>
            </tr>
        `).join('')
        : '<tr><td colspan="3" style="text-align:center;color:#999;padding:12px;">No work data</td></tr>';

    const materials = data.materials_purchases || [];
    const materialsRows = materials.length
        ? materials.map(m => `
            <tr>
                <td>${safe(m.name)}</td>
                <td>${m.qty || 0} ${safe(m.unit || '')}</td>
                <td>${formatDbrINR(m.amount)}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="3" style="text-align:center;color:#999;padding:12px;">No material purchases today</td></tr>';

    const parties = data.outstanding_by_party || [];
    const partyHtml = parties.length
        ? parties.map(p => `
            <div class="dbr-party-row">
                <div class="dbr-party-name">${safe(p.name)}</div>
                <div class="dbr-party-amt">${formatDbrINR(p.amount)}</div>
                <div class="dbr-party-bar-wrap"><div class="dbr-party-bar" style="width:${p.pct || 0}%;"></div></div>
                <div class="dbr-party-pct">${p.pct || 0}%</div>
            </div>
        `).join('')
        : '<div class="dbr-empty">No outstanding data</div>';

    wrapper.innerHTML = `
    <style>
        .dbr-card { width: 800px; background: #fff7f0; font-family: 'Segoe UI', Arial, sans-serif; color: #333; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        .dbr-header { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, #FF9F43, #FFB74D); padding: 24px 32px; color: #fff; }
        .dbr-logo { display: flex; align-items: center; gap: 12px; }
        .dbr-logo svg { width: 40px; height: 40px; fill: #fff; }
        .dbr-logo-title { font-weight: 800; font-size: 14px; letter-spacing: 1px; }
        .dbr-logo-sub { font-size: 10px; opacity: 0.9; }
        .dbr-title-block { text-align: right; }
        .dbr-title { font-size: 26px; font-weight: 900; letter-spacing: 1px; }
        .dbr-date { font-size: 14px; margin-top: 4px; opacity: 0.95; }
        .dbr-greeting { display: flex; align-items: center; gap: 16px; background: #fff0e6; padding: 16px 32px; }
        .dbr-avatar { width: 48px; height: 48px; border-radius: 50%; background: #FF9F43; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 24px; }
        .dbr-greet-name { font-size: 18px; font-weight: 700; color: #FF9F43; }
        .dbr-greet-sub { font-size: 12px; color: #666; }
        .dbr-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 24px 32px; }
        .dbr-kpi-card { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .dbr-kpi-icon { width: 36px; height: 36px; border-radius: 8px; background: #fff0e6; color: #FF9F43; display: flex; align-items: center; justify-content: center; margin-bottom: 10px; }
        .dbr-kpi-label { font-size: 11px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.5px; }
        .dbr-kpi-value { font-size: 22px; font-weight: 800; color: #222; margin: 6px 0; }
        .dbr-kpi-sub { font-size: 11px; color: #666; }
        .dbr-section-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 0 32px 24px; }
        .dbr-section { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .dbr-section-title { background: #FF9F43; color: #fff; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 16px; margin: -16px -16px 16px; border-radius: 12px 12px 0 0; text-align: center; }
        .dbr-pie-row { display: flex; align-items: center; justify-content: center; gap: 24px; }
        .dbr-pie-legend { display: flex; flex-direction: column; gap: 8px; min-width: 160px; }
        .dbr-legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
        .dbr-legend-dot { width: 10px; height: 10px; border-radius: 50%; }
        .dbr-legend-name { font-weight: 700; color: #333; flex: 1; }
        .dbr-legend-amt { color: #666; }
        .dbr-legend-pct { font-weight: 700; color: #FF9F43; }
        .dbr-total-turnover { background: #fff0e6; border-radius: 8px; padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 700; margin-top: 16px; color: #444; }
        .dbr-daybook-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f0e0d5; }
        .dbr-daybook-row:last-child { border-bottom: none; }
        .dbr-daybook-label { font-size: 13px; color: #444; }
        .dbr-daybook-val { font-weight: 800; font-size: 15px; }
        .dbr-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .dbr-table th { text-align: left; color: #999; font-weight: 700; padding: 6px 0; }
        .dbr-table td { padding: 8px 0; border-top: 1px solid #f0e0d5; vertical-align: middle; }
        .dbr-table td:last-child { text-align: right; }
        .dbr-bar { height: 6px; border-radius: 3px; background: #FFF0E0; width: 100%; margin-top: 4px; }
        .dbr-bar-fill { height: 100%; border-radius: 3px; background: #FF9F43; }
        .dbr-party-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0e0d5; }
        .dbr-party-row:last-child { border-bottom: none; }
        .dbr-party-name { width: 180px; font-size: 13px; font-weight: 700; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dbr-party-amt { width: 90px; text-align: right; font-weight: 700; font-size: 13px; }
        .dbr-party-bar-wrap { flex: 1; height: 8px; background: #FFF0E0; border-radius: 4px; }
        .dbr-party-bar { height: 100%; border-radius: 4px; background: #FF9F43; }
        .dbr-party-pct { width: 44px; text-align: right; font-size: 12px; font-weight: 700; color: #666; }
        .dbr-party-total { display: flex; justify-content: space-between; align-items: center; background: #fff0e6; padding: 10px 12px; border-radius: 8px; margin-top: 12px; font-weight: 800; color: #FF9F43; }
        .dbr-footer { display: flex; align-items: center; gap: 8px; padding: 16px 32px; font-size: 12px; color: #666; font-style: italic; }
        .dbr-empty { color: #999; font-size: 12px; text-align: center; padding: 16px; }
        .dbr-work-table-section { padding: 0 32px 24px; }
        .dbr-party-section { padding: 0 32px 24px; }
    </style>

    <div class="dbr-card" id="dailyReportCardInner">
        <div class="dbr-header">
            <div class="dbr-logo">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2.5-1.25L12 8.5l-2.5 1.25L12 11zm0 2.5l-5-2.5-5 2.5L12 22l10-8.5-5-2.5-5 2.5z"/></svg>
                <div>
                    <div class="dbr-logo-title">${safe(data.company_name)}</div>
                    <div class="dbr-logo-sub">BUILDING BETTER FUTURES</div>
                </div>
            </div>
            <div class="dbr-title-block">
                <div class="dbr-title">DAILY BUSINESS REPORT</div>
                <div class="dbr-date">${safe(data.report_date)}</div>
            </div>
        </div>

        <div class="dbr-greeting">
            <div class="dbr-avatar">
                <svg viewBox="0 0 24 24" fill="currentColor" style="width:28px;height:28px;"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            </div>
            <div>
                <div class="dbr-greet-name">Hello ${safe(userName)}</div>
                <div class="dbr-greet-sub">Here's your business overview for today.</div>
            </div>
        </div>

        <div class="dbr-kpi-row">
            <div class="dbr-kpi-card">
                <div class="dbr-kpi-icon">${kpiIcon('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12h.01"/>')}</div>
                <div class="dbr-kpi-label">Total Expenditure</div>
                <div class="dbr-kpi-value">${formatDbrINR(data.total_expenditure)}</div>
                <div class="dbr-kpi-sub">Today's Total Spend</div>
            </div>
            <div class="dbr-kpi-card">
                <div class="dbr-kpi-icon">${kpiIcon('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>')}</div>
                <div class="dbr-kpi-label">Work Done</div>
                <div class="dbr-kpi-value">${formatDbrINR(data.work_done)}</div>
                <div class="dbr-kpi-sub">Value of Work Completed</div>
            </div>
            <div class="dbr-kpi-card">
                <div class="dbr-kpi-icon">${kpiIcon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>')}</div>
                <div class="dbr-kpi-label">Pending Works</div>
                <div class="dbr-kpi-value">${formatDbrINR(data.pending_works)}</div>
                <div class="dbr-kpi-sub">Remaining Work Value</div>
            </div>
            <div class="dbr-kpi-card">
                <div class="dbr-kpi-icon">${kpiIcon('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>')}</div>
                <div class="dbr-kpi-label">Outstanding Amount</div>
                <div class="dbr-kpi-value">${formatDbrINR(data.outstanding_amount)}</div>
                <div class="dbr-kpi-sub">Yet to be Received</div>
            </div>
        </div>

        <div class="dbr-section-row">
            <div class="dbr-section">
                <div class="dbr-section-title">Venture Wise Analysis</div>
                <div class="dbr-pie-row">
                    <canvas id="dbrPieCanvas" width="220" height="220"></canvas>
                    <div class="dbr-pie-legend">${legendHtml}</div>
                </div>
                <div class="dbr-total-turnover">Total Turnover Across Ventures: ${formatDbrINR(data.work_done + data.pending_works)}</div>
            </div>
            <div class="dbr-section">
                <div class="dbr-section-title">Day Book Summary</div>
                <div class="dbr-daybook-rows">${dayBookHtml}</div>
            </div>
        </div>

        <div class="dbr-section-row">
            <div class="dbr-section">
                <div class="dbr-section-title">Work Done (Venture Wise)</div>
                <table class="dbr-table">
                    <thead><tr><th>Venture</th><th>Work Done Value</th><th>% Contribution</th></tr></thead>
                    <tbody>${workDoneRows}</tbody>
                    <tfoot><tr style="font-weight:800;color:#FF9F43;"><td>Total</td><td>${formatDbrINR(data.work_done)}</td><td>100%</td></tr></tfoot>
                </table>
            </div>
            <div class="dbr-section">
                <div class="dbr-section-title">Materials Purchases</div>
                <table class="dbr-table">
                    <thead><tr><th>Material</th><th>Qty</th><th>Amount</th></tr></thead>
                    <tbody>${materialsRows}</tbody>
                    <tfoot><tr style="font-weight:800;color:#FF9F43;"><td>Total Purchase</td><td></td><td>${formatDbrINR(data.materials_purchases.reduce((s, m) => s + (Number(m.amount) || 0), 0))}</td></tr></tfoot>
                </table>
            </div>
        </div>

        <div class="dbr-party-section">
            <div class="dbr-section">
                <div class="dbr-section-title">Outstanding Amounts (Party Wise)</div>
                <div class="dbr-party-rows">${partyHtml}</div>
                <div class="dbr-party-total">
                    <span>Total Outstanding</span>
                    <span>${formatDbrINR(data.outstanding_amount)}</span>
                </div>
            </div>
        </div>

        <div class="dbr-footer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            "Good Planning Today, Better Results Tomorrow."
        </div>
    </div>
    `;

    const canvas = wrapper.querySelector('#dbrPieCanvas');
    drawDbrPieChart(canvas, ventureAnalysis);
    return wrapper;
}

function _buildDailyReportText(data) {
    const lines = [];
    const fmt = formatDbrINR;
    lines.push(`*${data.company_name}*`);
    lines.push(`*DAILY BUSINESS REPORT*`);
    lines.push(data.report_date);
    lines.push('');
    lines.push(`*Total Expenditure:* ${fmt(data.total_expenditure)}`);
    lines.push(`*Work Done:* ${fmt(data.work_done)}`);
    lines.push(`*Pending Works:* ${fmt(data.pending_works)}`);
    lines.push(`*Outstanding Amount:* ${fmt(data.outstanding_amount)}`);
    lines.push('');
    if (data.venture_analysis && data.venture_analysis.length > 0) {
        lines.push('*Venture Wise Analysis:*');
        data.venture_analysis.forEach(v => lines.push(`• ${v.name}: ${fmt(v.amount)} (${v.pct}%)`));
        lines.push(`*Total Turnover:* ${fmt(data.work_done + data.pending_works)}`);
        lines.push('');
    }
    const db = data.day_book || {};
    lines.push('*Day Book Summary:*');
    lines.push(`Opening Balance: ${fmt(db.opening_balance || 0)}`);
    lines.push(`Total Receipts: ${fmt(db.total_receipts || 0)}`);
    lines.push(`Total Payments: ${fmt(db.total_payments || 0)}`);
    lines.push(`Closing Balance: ${fmt(db.closing_balance || 0)}`);
    lines.push('');
    if (data.work_done_by_venture && data.work_done_by_venture.length > 0) {
        lines.push('*Work Done (Venture Wise):*');
        data.work_done_by_venture.forEach(v => lines.push(`• ${v.name}: ${fmt(v.amount)} (${v.pct}%)`));
        lines.push(`*Total Work Done:* ${fmt(data.work_done)}`);
        lines.push('');
    }
    if (data.materials_purchases && data.materials_purchases.length > 0) {
        lines.push('*Materials Purchases:*');
        data.materials_purchases.forEach(m => lines.push(`• ${m.name}: ${m.qty || 0} ${m.unit || ''} — ${fmt(m.amount)}`));
        const totalMat = data.materials_purchases.reduce((s, m) => s + (Number(m.amount) || 0), 0);
        lines.push(`*Total Purchase:* ${fmt(totalMat)}`);
        lines.push('');
    }
    if (data.outstanding_by_party && data.outstanding_by_party.length > 0) {
        lines.push('*Outstanding Amounts (Party Wise):*');
        data.outstanding_by_party.forEach(p => lines.push(`• ${p.name}: ${fmt(p.amount)} (${p.pct}%)`));
        lines.push(`*Total Outstanding:* ${fmt(data.outstanding_amount)}`);
    }
    return lines.join('\n');
}

async function shareDailyReport() {
    const btn = document.getElementById('shareDailyReportBtn');
    if (!btn || btn._sharing) return;
    if (typeof html2canvas !== 'function') {
        showToast('Report renderer not loaded. Please check your internet connection.', true);
        return;
    }
    btn.disabled = true;
    btn._sharing = true;

    try {
        const date = new Date().toISOString().slice(0, 10);
        const data = await apiGet('/api/daily-report?date=' + encodeURIComponent(date));
        if (!data || data.error) {
            throw new Error(data && data.error ? data.error : 'Failed to load daily report');
        }

        const reportText = _buildDailyReportText(data);
        const card = renderDailyReportCard(data);
        document.body.appendChild(card);
        await document.fonts.ready;
        await new Promise(r => requestAnimationFrame(r));

        const canvas = await html2canvas(card, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
        });
        document.body.removeChild(card);

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const filename = `daily_business_report_${data.raw_date || date}.png`;
        const file = new File([blob], filename, { type: 'image/png' });
        const shareTitle = `Daily Business Report - ${data.company_name}`;

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: shareTitle, text: reportText });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            const waText = encodeURIComponent(reportText + '\n\n_Report image downloaded above._');
            window.open('https://wa.me/?text=' + waText, '_blank');
        }
    } catch (err) {
        console.error('Daily report share error:', err);
        showToast(err.message || 'Could not share daily report', true);
    } finally {
        btn.disabled = false;
        btn._sharing = false;
    }
}
