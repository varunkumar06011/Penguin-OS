// ============================================================
// RWA Module — Standard Tier frontend logic
// Loaded only on RWA-related templates (visitor_portal.html)
// ============================================================

(function() {
    'use strict';

    // Only run if the RWA tab container exists
    const rwaRoot = document.getElementById('rwaStandardSection');
    if (!rwaRoot) return;

    let rwaRole = null;
    let rwaUser = null;

    async function rwaGet(path) {
        const r = await fetch(path);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    }
    async function rwaPost(path, body) {
        const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Request failed');
        return data;
    }
    async function rwaPatch(path, body) {
        const r = await fetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Request failed');
        return data;
    }
    async function rwaDelete(path) {
        const r = await fetch(path, { method: 'DELETE' });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Request failed');
        return data;
    }

    function fmtDate(d) {
        if (!d) return '-';
        return new Date(d).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
    }

    function esc(s) {
        const div = document.createElement('div');
        div.textContent = s || '';
        return div.innerHTML;
    }

    // --- Tab switching ---
    document.querySelectorAll('.rwa-std-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.rwa-std-tab').forEach(t => {
                t.classList.remove('active');
                t.style.borderBottom = '3px solid transparent';
                t.style.color = '#888';
            });
            document.querySelectorAll('.rwa-std-content').forEach(c => c.style.display = 'none');
            tab.classList.add('active');
            tab.style.borderBottom = '3px solid #1a1a1a';
            tab.style.color = '#1a1a1a';
            const target = document.getElementById('rwa-std-' + tab.dataset.tab);
            if (target) target.style.display = '';
        });
    });

    // --- Deliveries ---
    function fmtRemaining(expiresAt) {
        if (!expiresAt) return '';
        const diff = new Date(expiresAt).getTime() - Date.now();
        if (diff <= 0) return '<span style="color:#c0392b;font-weight:700;">OVERDUE</span>';
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        return `<span style="color:#1a1a1a;font-weight:700;">${m}m ${s}s</span>`;
    }

    async function loadDeliveries() {
        try {
            const items = await rwaGet('/api/rwa/deliveries');
            const el = document.getElementById('rwaDeliveriesList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No deliveries.</div>'; return; }
            let html = '<table class="vp-table"><thead><tr><th>Time</th><th>Resident</th><th>Flat</th><th>Person</th><th>Vehicle</th><th>Courier</th><th>Status</th><th>Timer</th>';
            if (rwaRole === 'security' || rwaRole === 'admin' || rwaRole === 'manager') html += '<th>Actions</th>';
            html += '</tr></thead><tbody>';
            items.forEach(d => {
                let actions = '';
                if (d.status === 'arrived' && (rwaRole === 'security' || rwaRole === 'admin' || rwaRole === 'manager')) {
                    actions = `<button class="vp-btn vp-btn-success" style="padding:4px 10px;font-size:0.75rem;" onclick="rwaMarkCollected('${d.id}')">Mark Collected</button>`;
                }
                if (d.status === 'inside' && (rwaRole === 'security' || rwaRole === 'admin' || rwaRole === 'manager')) {
                    actions = `<button class="vp-btn vp-btn-secondary" style="padding:4px 10px;font-size:0.75rem;" onclick="rwaMarkDeliveryExit('${d.id}')">Mark Exit</button>`;
                }
                let timerHtml = '';
                if (d.status === 'inside' && d.expires_at) {
                    timerHtml = `<span class="rwa-delivery-timer" data-expires="${d.expires_at}">${fmtRemaining(d.expires_at)}</span>`;
                }
                html += `<tr>
                    <td data-label="Time">${fmtDate(d.arrived_at)}</td>
                    <td data-label="Resident">${esc(d.resident_name)}</td>
                    <td data-label="Flat">${esc(d.block)}-${esc(d.floor)}-${esc(d.flat)}</td>
                    <td data-label="Person">${esc(d.delivery_person_name) || '-'}</td>
                    <td data-label="Vehicle">${esc(d.vehicle_number) || '-'}</td>
                    <td data-label="Courier">${esc(d.courier_name) || '-'}</td>
                    <td data-label="Status"><span class="vp-status ${d.status==='collected'?'approved':d.status==='expired'?'rejected':'inside'}">${d.status}</span></td>
                    <td data-label="Timer">${timerHtml}</td>
                    ${rwaRole === 'security' || rwaRole === 'admin' || rwaRole === 'manager' ? `<td data-label="Actions">${actions}</td>` : ''}
                </tr>`;
            });
            html += '</tbody></table>';
            el.innerHTML = html;
            startDeliveryTimerUpdates();
        } catch (e) { console.error('loadDeliveries:', e); }
    }
    window.rwaMarkCollected = async function(id) {
        try { await rwaPatch('/api/rwa/delivery/' + id, { status: 'collected' }); loadDeliveries(); }
        catch (e) { alert(e.message); }
    };
    window.rwaMarkDeliveryExit = async function(id) {
        try { await rwaPost('/api/rwa/delivery/' + id + '/exit', {}); loadDeliveries(); }
        catch (e) { alert(e.message); }
    };

    function startDeliveryTimerUpdates() {
        if (window.rwaDeliveryTimerInterval) clearInterval(window.rwaDeliveryTimerInterval);
        window.rwaDeliveryTimerInterval = setInterval(() => {
            document.querySelectorAll('.rwa-delivery-timer').forEach(el => {
                el.innerHTML = fmtRemaining(el.dataset.expires);
            });
        }, 1000);
    }

    // Security: log new delivery
    const rwaDeliveryBtn = document.getElementById('rwaLogDeliveryBtn');
    if (rwaDeliveryBtn) {
        rwaDeliveryBtn.addEventListener('click', async () => {
            const mobile = document.getElementById('rwaDeliveryMobile').value.trim();
            const courier = document.getElementById('rwaDeliveryCourier').value.trim();
            if (!mobile) { alert('Resident mobile required'); return; }
            try {
                const resident = await rwaGet('/api/visitor/resident-by-mobile/' + encodeURIComponent(mobile));
                if (!resident) { alert('Resident not found'); return; }
                await rwaPost('/api/rwa/delivery', { resident_id: resident.id, courier_name: courier });
                document.getElementById('rwaDeliveryMobile').value = '';
                document.getElementById('rwaDeliveryCourier').value = '';
                loadDeliveries();
            } catch (e) { alert(e.message); }
        });
    }

    // --- Daily Help ---
    async function loadDailyHelp() {
        try {
            const items = await rwaGet('/api/rwa/daily-help');
            const el = document.getElementById('rwaDailyHelpList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No daily help registered.</div>'; return; }
            let html = '<table class="vp-table"><thead><tr><th>Name</th><th>Role</th><th>Mobile</th>';
            if (rwaRole === 'security' || rwaRole === 'admin' || rwaRole === 'manager') html += '<th>Actions</th>';
            html += '</tr></thead><tbody>';
            items.forEach(h => {
                let actions = '';
                if (rwaRole === 'security' || rwaRole === 'admin' || rwaRole === 'manager') {
                    actions = `<button class="vp-btn vp-btn-success" style="padding:4px 10px;font-size:0.75rem;" onclick="rwaCheckIn('${h.id}')">Check In</button> <button class="vp-btn vp-btn-secondary" style="padding:4px 10px;font-size:0.75rem;" onclick="rwaCheckOut('${h.id}')">Check Out</button>`;
                }
                html += `<tr>
                    <td data-label="Name">${esc(h.name)}</td>
                    <td data-label="Role">${esc(h.role_type) || '-'}</td>
                    <td data-label="Mobile">${esc(h.mobile) || '-'}</td>
                    ${rwaRole === 'security' || rwaRole === 'admin' || rwaRole === 'manager' ? `<td data-label="Actions">${actions}</td>` : ''}
                </tr>`;
            });
            html += '</tbody></table>';
            el.innerHTML = html;
        } catch (e) { console.error('loadDailyHelp:', e); }
    }
    window.rwaCheckIn = async function(id) {
        try { await rwaPost('/api/rwa/daily-help/' + id + '/attendance', { action: 'check_in' }); alert('Checked in'); }
        catch (e) { alert(e.message); }
    };
    window.rwaCheckOut = async function(id) {
        try { await rwaPost('/api/rwa/daily-help/' + id + '/attendance', { action: 'check_out' }); alert('Checked out'); }
        catch (e) { alert(e.message); }
    };

    // Admin: add daily help
    const rwaAddHelpBtn = document.getElementById('rwaAddHelpBtn');
    if (rwaAddHelpBtn) {
        rwaAddHelpBtn.addEventListener('click', async () => {
            const name = document.getElementById('rwaHelpName').value.trim();
            const role = document.getElementById('rwaHelpRole').value.trim();
            const mobile = document.getElementById('rwaHelpMobile').value.trim();
            if (!name) { alert('Name required'); return; }
            try {
                await rwaPost('/api/rwa/daily-help', { name, role_type: role, mobile });
                document.getElementById('rwaHelpName').value = '';
                document.getElementById('rwaHelpRole').value = '';
                document.getElementById('rwaHelpMobile').value = '';
                loadDailyHelp();
            } catch (e) { alert(e.message); }
        });
    }

    // --- Vehicles ---
    async function loadVehicles() {
        try {
            const items = await rwaGet('/api/rwa/vehicles');
            const el = document.getElementById('rwaVehiclesList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No vehicles registered.</div>'; return; }
            let html = '<table class="vp-table"><thead><tr><th>Number</th><th>Type</th><th>Owner</th><th>Flat</th></tr></thead><tbody>';
            items.forEach(v => {
                html += `<tr>
                    <td data-label="Number">${esc(v.vehicle_number)}</td>
                    <td data-label="Type">${esc(v.vehicle_type) || '-'}</td>
                    <td data-label="Owner">${esc(v.resident_name)}</td>
                    <td data-label="Flat">${esc(v.block)}-${esc(v.floor)}-${esc(v.flat)}</td>
                </tr>`;
            });
            html += '</tbody></table>';
            el.innerHTML = html;
        } catch (e) { console.error('loadVehicles:', e); }
    }

    const rwaAddVehicleBtn = document.getElementById('rwaAddVehicleBtn');
    if (rwaAddVehicleBtn) {
        rwaAddVehicleBtn.addEventListener('click', async () => {
            const num = document.getElementById('rwaVehicleNum').value.trim();
            const type = document.getElementById('rwaVehicleType').value.trim();
            if (!num) { alert('Vehicle number required'); return; }
            try {
                await rwaPost('/api/rwa/vehicles', { vehicle_number: num, vehicle_type: type });
                document.getElementById('rwaVehicleNum').value = '';
                document.getElementById('rwaVehicleType').value = '';
                loadVehicles();
            } catch (e) { alert(e.message); }
        });
    }

    // --- Vehicle Search ---
    const rwaVehicleSearchBtn = document.getElementById('rwaVehicleSearchBtn');
    if (rwaVehicleSearchBtn) {
        rwaVehicleSearchBtn.addEventListener('click', async () => {
            const num = document.getElementById('rwaVehicleSearchNum').value.trim();
            if (!num) return;
            try {
                const results = await rwaGet('/api/rwa/vehicle-search?number=' + encodeURIComponent(num));
                const el = document.getElementById('rwaVehicleSearchResults');
                if (!results.length) { el.innerHTML = '<div class="vp-empty">No matches found.</div>'; return; }
                let html = '<table class="vp-table"><thead><tr><th>Source</th><th>Number</th><th>Name</th><th>Flat</th><th>Details</th></tr></thead><tbody>';
                results.forEach(r => {
                    const name = r.source === 'resident' ? r.resident_name : (r.visitor_name + ' (visitor)');
                    const details = r.source === 'visitor' ? `Status: ${r.status}` : (r.vehicle_type || '-');
                    html += `<tr>
                        <td data-label="Source">${r.source}</td>
                        <td data-label="Number">${esc(r.vehicle_number)}</td>
                        <td data-label="Name">${esc(name)}</td>
                        <td data-label="Flat">${esc(r.block)}-${esc(r.floor)}-${esc(r.flat)}</td>
                        <td data-label="Details">${esc(details)}</td>
                    </tr>`;
                });
                html += '</tbody></table>';
                el.innerHTML = html;
            } catch (e) { alert(e.message); }
        });
    }

    // --- Kids Checkout ---
    async function loadKidsCheckout() {
        try {
            const items = await rwaGet('/api/rwa/kids-checkout');
            const el = document.getElementById('rwaKidsList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No checkout records.</div>'; return; }
            let html = '<table class="vp-table"><thead><tr><th>Time</th><th>Child</th><th>Picked By</th><th>Flat</th><th>Verified</th>';
            if (rwaRole === 'security') html += '<th>Verify</th>';
            html += '</tr></thead><tbody>';
            items.forEach(k => {
                let verify = '';
                if (rwaRole === 'security' && !k.otp_verified_at) {
                    verify = `<input type="text" style="width:60px;text-align:center;font-size:1.1rem;" id="kid-otp-${k.id}" maxlength="4" placeholder="OTP"> <button class="vp-btn vp-btn-success" style="padding:4px 8px;font-size:0.75rem;" onclick="rwaVerifyKid('${k.id}')">Verify</button>`;
                }
                html += `<tr>
                    <td data-label="Time">${fmtDate(k.created_at)}</td>
                    <td data-label="Child">${esc(k.child_name)}</td>
                    <td data-label="Picked By">${esc(k.picked_up_by)}</td>
                    <td data-label="Flat">${esc(k.block)}-${esc(k.floor)}-${esc(k.flat)}</td>
                    <td data-label="Verified">${k.otp_verified_at ? '<span style="color:#27ae60;">Yes</span>' : '<span style="color:#c0392b;">Pending</span>'}</td>
                    ${rwaRole === 'security' ? `<td data-label="Verify">${verify}</td>` : ''}
                </tr>`;
            });
            html += '</tbody></table>';
            el.innerHTML = html;
        } catch (e) { console.error('loadKidsCheckout:', e); }
    }
    window.rwaVerifyKid = async function(id) {
        const code = document.getElementById('kid-otp-' + id).value.trim();
        if (!code) { alert('Enter OTP'); return; }
        try { await rwaPost('/api/rwa/kids-checkout/' + id + '/verify', { otp: code }); loadKidsCheckout(); }
        catch (e) { alert(e.message); }
    };

    // Security: initiate kids checkout
    const rwaKidCheckoutBtn = document.getElementById('rwaKidCheckoutBtn');
    if (rwaKidCheckoutBtn) {
        rwaKidCheckoutBtn.addEventListener('click', async () => {
            const mobile = document.getElementById('rwaKidMobile').value.trim();
            const childName = document.getElementById('rwaKidName').value.trim();
            const pickedBy = document.getElementById('rwaKidPickedBy').value.trim();
            if (!mobile || !childName || !pickedBy) { alert('All fields required'); return; }
            try {
                const resident = await rwaGet('/api/visitor/resident-by-mobile/' + encodeURIComponent(mobile));
                if (!resident) { alert('Resident not found'); return; }
                const res = await rwaPost('/api/rwa/kids-checkout', { resident_id: resident.id, child_name: childName, picked_up_by: pickedBy });
                alert(`OTP sent to resident (dev: ${res.otp})`);
                document.getElementById('rwaKidMobile').value = '';
                document.getElementById('rwaKidName').value = '';
                document.getElementById('rwaKidPickedBy').value = '';
                loadKidsCheckout();
            } catch (e) { alert(e.message); }
        });
    }

    // --- Directory ---
    async function loadDirectory() {
        try {
            const items = await rwaGet('/api/rwa/directory');
            const el = document.getElementById('rwaDirectoryList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No residents found.</div>'; return; }
            let html = '<table class="vp-table"><thead><tr><th>Name</th><th>Block</th><th>Floor</th><th>Flat</th><th>Mobile</th></tr></thead><tbody>';
            items.forEach(r => {
                html += `<tr>
                    <td data-label="Name">${esc(r.name)}</td>
                    <td data-label="Block">${esc(r.block)}</td>
                    <td data-label="Floor">${esc(r.floor)}</td>
                    <td data-label="Flat">${esc(r.flat)}</td>
                    <td data-label="Mobile">${esc(r.mobile)}</td>
                </tr>`;
            });
            html += '</tbody></table>';
            el.innerHTML = html;
        } catch (e) { console.error('loadDirectory:', e); }
    }

    // Resident: toggle opt-in
    const rwaOptInBtn = document.getElementById('rwaOptInBtn');
    if (rwaOptInBtn) {
        rwaOptInBtn.addEventListener('click', async () => {
            const opted = document.getElementById('rwaOptInCheckbox').checked;
            try { await rwaPost('/api/rwa/directory/opt-in', { opt_in: opted }); alert('Updated'); loadDirectory(); }
            catch (e) { alert(e.message); }
        });
    }

    // --- Pre-approve visitor ---
    const rwaPreApproveBtn = document.getElementById('rwaPreApproveBtn');
    if (rwaPreApproveBtn) {
        rwaPreApproveBtn.addEventListener('click', async () => {
            const name = document.getElementById('rwaPreApproveName').value.trim();
            const mobile = document.getElementById('rwaPreApproveMobile').value.trim();
            const purpose = document.getElementById('rwaPreApprovePurpose').value.trim();
            const vehicle = document.getElementById('rwaPreApproveVehicle').value.trim();
            if (!name) { alert('Visitor name required'); return; }
            try {
                await rwaPost('/api/rwa/pre-approve', { visitor_name: name, visitor_mobile: mobile, purpose, vehicle_number: vehicle });
                alert('Visitor pre-approved');
                document.getElementById('rwaPreApproveName').value = '';
                document.getElementById('rwaPreApproveMobile').value = '';
                document.getElementById('rwaPreApprovePurpose').value = '';
                document.getElementById('rwaPreApproveVehicle').value = '';
            } catch (e) { alert(e.message); }
        });
    }

    // --- Emergency contacts ---
    async function loadEmergency() {
        try {
            const items = await rwaGet('/api/rwa/emergency-contacts');
            const el = document.getElementById('rwaEmergencyList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No contacts.</div>'; return; }
            let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">';
            items.forEach(c => {
                html += `<div class="vp-card" style="padding:16px;text-align:center;">
                    <div style="font-weight:700;font-size:1rem;">${esc(c.label)}</div>
                    <div style="font-size:1.3rem;color:#1a1a1a;margin-top:6px;">${esc(c.phone_number)}</div>
                    <div style="font-size:0.75rem;color:#888;margin-top:4px;">${esc(c.category)}</div>
                </div>`;
            });
            html += '</div>';
            el.innerHTML = html;
        } catch (e) { console.error('loadEmergency:', e); }
    }

    // --- Init ---
    async function initRWA() {
        try {
            const me = await rwaGet('/api/visitor/me');
            if (me.resident) { rwaRole = 'resident'; rwaUser = me.resident; }
            else if (me.security) { rwaRole = 'security'; rwaUser = me.security; }
            else {
                const main = await rwaGet('/api/me');
                if (main.user) { rwaRole = main.role || 'admin'; rwaUser = { name: main.user }; }
            }
            if (!rwaRole) return;

            // Show/hide role-specific sections
            document.querySelectorAll('.rwa-security-only').forEach(el => {
                el.style.display = (rwaRole === 'security' || rwaRole === 'admin' || rwaRole === 'manager') ? '' : 'none';
            });
            document.querySelectorAll('.rwa-resident-only').forEach(el => {
                el.style.display = (rwaRole === 'resident') ? '' : 'none';
            });

            // Load all data
            loadDeliveries();
            loadDailyHelp();
            loadVehicles();
            loadKidsCheckout();
            loadDirectory();
            loadEmergency();
        } catch (e) { console.error('RWA init failed:', e); }
    }

    // --- Prime Tier Tab switching ---
    document.querySelectorAll('.rwa-prime-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.rwa-prime-tab').forEach(t => {
                t.classList.remove('active');
                t.style.borderBottom = '3px solid transparent';
                t.style.color = '#888';
            });
            document.querySelectorAll('.rwa-prime-content').forEach(c => c.style.display = 'none');
            tab.classList.add('active');
            tab.style.borderBottom = '3px solid #1a1a1a';
            tab.style.color = '#1a1a1a';
            const target = document.getElementById('rwa-prime-' + tab.dataset.tab);
            if (target) target.style.display = '';
        });
    });

    // --- Complaints ---
    async function loadComplaints() {
        try {
            const items = await rwaGet('/api/rwa/complaints');
            const el = document.getElementById('rwaComplaintsList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No complaints.</div>'; return; }
            let html = '<table class="vp-table"><thead><tr><th>Date</th><th>Resident</th><th>Flat</th><th>Category</th><th>Description</th><th>Status</th>';
            if (rwaRole === 'admin' || rwaRole === 'manager' || rwaRole === 'security') html += '<th>Update</th>';
            html += '</tr></thead><tbody>';
            items.forEach(c => {
                let update = '';
                if (rwaRole === 'admin' || rwaRole === 'manager' || rwaRole === 'security') {
                    update = `<select onchange="rwaUpdateComplaint('${c.id}', this.value)" style="padding:4px;border-radius:4px;">
                        <option value="open" ${c.status==='open'?'selected':''}>Open</option>
                        <option value="in_progress" ${c.status==='in_progress'?'selected':''}>In Progress</option>
                        <option value="resolved" ${c.status==='resolved'?'selected':''}>Resolved</option>
                        <option value="closed" ${c.status==='closed'?'selected':''}>Closed</option>
                    </select>`;
                }
                html += `<tr>
                    <td data-label="Date">${fmtDate(c.created_at)}</td>
                    <td data-label="Resident">${esc(c.resident_name)}</td>
                    <td data-label="Flat">${esc(c.block)}-${esc(c.floor)}-${esc(c.flat)}</td>
                    <td data-label="Category">${esc(c.category) || '-'}</td>
                    <td data-label="Description">${esc(c.description)}</td>
                    <td data-label="Status"><span class="vp-status" style="background:${c.status==='resolved'?'#d4edda':c.status==='closed'?'#e2e3e5':'#fff3cd'};color:${c.status==='resolved'?'#155724':c.status==='closed'?'#383d41':'#856404'};">${c.status}</span></td>
                    ${rwaRole === 'admin' || rwaRole === 'manager' || rwaRole === 'security' ? `<td data-label="Update">${update}</td>` : ''}
                </tr>`;
            });
            html += '</tbody></table>';
            el.innerHTML = html;
        } catch (e) { console.error('loadComplaints:', e); }
    }
    window.rwaUpdateComplaint = async function(id, status) {
        try { await rwaPatch('/api/rwa/complaints/' + id, { status }); loadComplaints(); }
        catch (e) { alert(e.message); }
    };

    const rwaFileComplaintBtn = document.getElementById('rwaFileComplaintBtn');
    if (rwaFileComplaintBtn) {
        rwaFileComplaintBtn.addEventListener('click', async () => {
            const category = document.getElementById('rwaComplaintCategory').value.trim();
            const desc = document.getElementById('rwaComplaintDesc').value.trim();
            if (!desc) { alert('Description required'); return; }
            try {
                await rwaPost('/api/rwa/complaints', { category, description: desc });
                document.getElementById('rwaComplaintCategory').value = '';
                document.getElementById('rwaComplaintDesc').value = '';
                loadComplaints();
            } catch (e) { alert(e.message); }
        });
    }

    // --- Amenities ---
    async function loadAmenities() {
        try {
            const items = await rwaGet('/api/rwa/amenities');
            const sel = document.getElementById('rwaBookingAmenity');
            if (sel) {
                sel.innerHTML = '<option value="">Select...</option>' + items.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
            }
        } catch (e) { console.error('loadAmenities:', e); }
    }

    async function loadBookings() {
        try {
            const items = await rwaGet('/api/rwa/amenity-bookings');
            const el = document.getElementById('rwaBookingsList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No bookings.</div>'; return; }
            let html = '<table class="vp-table"><thead><tr><th>Date</th><th>Amenity</th><th>Slot</th><th>Resident</th><th>Status</th></tr></thead><tbody>';
            items.forEach(b => {
                html += `<tr>
                    <td data-label="Date">${b.booking_date || '-'}</td>
                    <td data-label="Amenity">${esc(b.amenity_name)}</td>
                    <td data-label="Slot">${esc(b.slot)}</td>
                    <td data-label="Resident">${esc(b.resident_name)}</td>
                    <td data-label="Status">${b.status}</td>
                </tr>`;
            });
            html += '</tbody></table>';
            el.innerHTML = html;
        } catch (e) { console.error('loadBookings:', e); }
    }

    const rwaBookAmenityBtn = document.getElementById('rwaBookAmenityBtn');
    if (rwaBookAmenityBtn) {
        rwaBookAmenityBtn.addEventListener('click', async () => {
            const amenity_id = document.getElementById('rwaBookingAmenity').value;
            const booking_date = document.getElementById('rwaBookingDate').value;
            const slot = document.getElementById('rwaBookingSlot').value.trim();
            if (!amenity_id || !booking_date || !slot) { alert('All fields required'); return; }
            try {
                await rwaPost('/api/rwa/amenity-bookings', { amenity_id, booking_date, slot });
                document.getElementById('rwaBookingSlot').value = '';
                loadBookings();
            } catch (e) { alert(e.message); }
        });
    }

    // --- Notices ---
    async function loadNotices() {
        try {
            const items = await rwaGet('/api/rwa/notices');
            const el = document.getElementById('rwaNoticesList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No notices.</div>'; return; }
            let html = '';
            items.forEach(n => {
                html += `<div class="vp-card" style="margin-bottom:12px;${n.pinned ? 'border-left:4px solid #1a1a1a;' : ''}">
                    <div style="display:flex;justify-content:space-between;align-items:start;">
                        <div>
                            <strong>${esc(n.title)}</strong>
                            ${n.pinned ? '<span style="background:#1a1a1a;color:#fff;padding:2px 8px;border-radius:4px;font-size:0.7rem;margin-left:8px;">PINNED</span>' : ''}
                        </div>
                        <span style="font-size:0.78rem;color:#888;">${fmtDate(n.created_at)}</span>
                    </div>
                    <p style="margin:8px 0 0;color:#444;">${esc(n.body)}</p>
                    ${n.posted_by ? `<span style="font-size:0.75rem;color:#aaa;">— ${esc(n.posted_by)}</span>` : ''}
                </div>`;
            });
            el.innerHTML = html;
        } catch (e) { console.error('loadNotices:', e); }
    }

    const rwaPostNoticeBtn = document.getElementById('rwaPostNoticeBtn');
    if (rwaPostNoticeBtn) {
        rwaPostNoticeBtn.addEventListener('click', async () => {
            const title = document.getElementById('rwaNoticeTitle').value.trim();
            const body = document.getElementById('rwaNoticeBody').value.trim();
            const target_scope = document.getElementById('rwaNoticeScope').value;
            const target_value = document.getElementById('rwaNoticeTarget').value.trim();
            const pinned = document.getElementById('rwaNoticePinned').checked;
            if (!title || !body) { alert('Title and body required'); return; }
            try {
                await rwaPost('/api/rwa/notices', { title, body, target_scope, target_value, pinned });
                document.getElementById('rwaNoticeTitle').value = '';
                document.getElementById('rwaNoticeBody').value = '';
                document.getElementById('rwaNoticeTarget').value = '';
                document.getElementById('rwaNoticePinned').checked = false;
                loadNotices();
            } catch (e) { alert(e.message); }
        });
    }

    // --- Home Planner ---
    async function loadPlanner() {
        try {
            const items = await rwaGet('/api/rwa/home-planner');
            const el = document.getElementById('rwaPlannerList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No tasks. Add one above.</div>'; return; }
            let html = '<ul style="list-style:none;padding:0;margin:0;">';
            items.forEach(t => {
                html += `<li style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f0f0f0;">
                    <input type="checkbox" ${t.done ? 'checked' : ''} onchange="rwaToggleTask('${t.id}', this.checked)">
                    <span style="${t.done ? 'text-decoration:line-through;color:#aaa;' : ''}">${esc(t.title)}</span>
                    ${t.due_date ? `<span style="margin-left:auto;font-size:0.8rem;color:#888;">${t.due_date}</span>` : ''}
                </li>`;
            });
            html += '</ul>';
            el.innerHTML = html;
        } catch (e) { console.error('loadPlanner:', e); }
    }
    window.rwaToggleTask = async function(id, done) {
        try { await rwaPatch('/api/rwa/home-planner?id=' + id, { done }); loadPlanner(); }
        catch (e) { alert(e.message); }
    };

    const rwaAddTaskBtn = document.getElementById('rwaAddTaskBtn');
    if (rwaAddTaskBtn) {
        rwaAddTaskBtn.addEventListener('click', async () => {
            const title = document.getElementById('rwaPlannerTitle').value.trim();
            const due_date = document.getElementById('rwaPlannerDue').value;
            if (!title) { alert('Task title required'); return; }
            try {
                await rwaPost('/api/rwa/home-planner', { title, due_date });
                document.getElementById('rwaPlannerTitle').value = '';
                document.getElementById('rwaPlannerDue').value = '';
                loadPlanner();
            } catch (e) { alert(e.message); }
        });
    }

    // --- Parking ---
    async function loadParking() {
        try {
            const items = await rwaGet('/api/rwa/parking');
            const el = document.getElementById('rwaParkingList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No parking slots registered.</div>'; return; }
            let html = '<table class="vp-table"><thead><tr><th>Slot</th><th>Owner</th><th>Mobile</th><th>Status</th>';
            if (rwaRole === 'resident') html += '<th>Action</th>';
            html += '</tr></thead><tbody>';
            items.forEach(p => {
                let action = '';
                if (rwaRole === 'resident' && p.status === 'available_for_rent') {
                    action = `<button class="vp-btn vp-btn-primary" style="padding:4px 10px;font-size:0.75rem;" onclick="rwaRentParking('${p.id}')">Rent</button>`;
                }
                html += `<tr>
                    <td data-label="Slot">${esc(p.slot_number)}</td>
                    <td data-label="Owner">${esc(p.owner_name) || '-'}</td>
                    <td data-label="Mobile">${esc(p.owner_mobile) || '-'}</td>
                    <td data-label="Status">${p.status}</td>
                    ${rwaRole === 'resident' ? `<td data-label="Action">${action}</td>` : ''}
                </tr>`;
            });
            html += '</tbody></table>';
            el.innerHTML = html;
        } catch (e) { console.error('loadParking:', e); }
    }
    window.rwaRentParking = async function(slotId) {
        const startDate = prompt('Enter start date (YYYY-MM-DD):');
        if (!startDate) return;
        try { await rwaPost('/api/rwa/parking/rent', { slot_id: slotId, start_date: startDate }); loadParking(); }
        catch (e) { alert(e.message); }
    };

    // --- SOS ---
    const rwaSosBtn = document.getElementById('rwaSosBtn');
    if (rwaSosBtn) {
        rwaSosBtn.addEventListener('click', async () => {
            if (!confirm('Send SOS alert to security?')) return;
            try { await rwaPost('/api/rwa/sos', {}); alert('SOS sent. Security has been alerted.'); }
            catch (e) { alert(e.message); }
        });
    }

    // --- Intercom ---
    async function loadIntercom() {
        try {
            const items = await rwaGet('/api/rwa/intercom');
            const el = document.getElementById('rwaIntercomList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No calls.</div>'; return; }
            let html = '<table class="vp-table"><thead><tr><th>Time</th><th>From</th><th>To</th><th>Status</th></tr></thead><tbody>';
            items.forEach(c => {
                html += `<tr>
                    <td data-label="Time">${fmtDate(c.created_at)}</td>
                    <td data-label="From">${esc(c.caller_type)}</td>
                    <td data-label="To">${esc(c.target_type)}</td>
                    <td data-label="Status">${c.status}</td>
                </tr>`;
            });
            html += '</tbody></table>';
            el.innerHTML = html;
        } catch (e) { console.error('loadIntercom:', e); }
    }

    const rwaIntercomCallBtn = document.getElementById('rwaIntercomCallBtn');
    if (rwaIntercomCallBtn) {
        rwaIntercomCallBtn.addEventListener('click', async () => {
            const target_type = document.getElementById('rwaIntercomTarget').value;
            try { await rwaPost('/api/rwa/intercom', { target_type }); alert('Ringing...'); loadIntercom(); }
            catch (e) { alert(e.message); }
        });
    }

    // --- Elite Tier Tab switching ---
    document.querySelectorAll('.rwa-elite-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.rwa-elite-tab').forEach(t => {
                t.classList.remove('active');
                t.style.borderBottom = '3px solid transparent';
                t.style.color = '#888';
            });
            document.querySelectorAll('.rwa-elite-content').forEach(c => c.style.display = 'none');
            tab.classList.add('active');
            tab.style.borderBottom = '3px solid #1a1a1a';
            tab.style.color = '#1a1a1a';
            const target = document.getElementById('rwa-elite-' + tab.dataset.tab);
            if (target) target.style.display = '';
        });
    });

    // --- Load Prime data ---
    loadComplaints();
    loadAmenities();
    loadBookings();
    loadNotices();
    loadPlanner();
    loadParking();
    loadIntercom();

    // --- Elite Tier: Invoices (resident view) ---
    async function loadRwaInvoices() {
        try {
            const items = await rwaGet('/api/rwa/invoices');
            const el = document.getElementById('rwaEliteInvoicesList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No invoices.</div>'; return; }
            let html = '<table class="vp-table"><thead><tr><th>Invoice #</th><th>Month</th><th>Amount</th><th>Due Date</th><th>Status</th>';
            if (rwaRole === 'resident') html += '<th>Action</th>';
            html += '</tr></thead><tbody>';
            items.forEach(i => {
                let action = '';
                if (rwaRole === 'resident' && i.status === 'unpaid') {
                    action = `<button class="vp-btn vp-btn-primary" style="padding:4px 10px;font-size:0.75rem;" onclick="rwaPayInvoice('${i.id}', ${i.amount})">Pay Now</button>`;
                }
                html += `<tr>
                    <td data-label="Invoice">${i.invoice_number}</td>
                    <td data-label="Month">${i.billing_month}</td>
                    <td data-label="Amount">₹${i.amount}</td>
                    <td data-label="Due">${i.due_date || '-'}</td>
                    <td data-label="Status"><span class="vp-status" style="background:${i.status==='paid'?'#d4edda':'#fff3cd'};color:${i.status==='paid'?'#155724':'#856404'};">${i.status}</span></td>
                    ${rwaRole === 'resident' ? `<td data-label="Action">${action}</td>` : ''}
                </tr>`;
            });
            html += '</tbody></table>';
            el.innerHTML = html;
        } catch (e) { console.error('loadRwaInvoices:', e); }
    }
    window.rwaPayInvoice = async function(invoiceId, amount) {
        try {
            const order = await rwaPost('/api/rwa/razorpay/create-order', { invoice_id: invoiceId });
            alert(`Payment gateway: ${order.note}\nOrder ID: ${order.order_id}\nAmount: ₹${(order.amount/100).toFixed(2)}`);
            // TODO: integrate Razorpay checkout when keys are available
            // For now, simulate manual payment
            if (confirm('Record as manual payment (demo)?')) {
                await rwaPost('/api/rwa/payments', { invoice_id: invoiceId, amount, method: 'manual', status: 'success' });
                alert('Payment recorded');
                loadRwaInvoices();
            }
        } catch (e) { alert(e.message); }
    };

    // --- Elite Tier: Patrol (security view) ---
    async function loadPatrolCheckpoints() {
        try {
            const items = await rwaGet('/api/rwa/patrol/checkpoints');
            const sel = document.getElementById('rwaPatrolCpSelect');
            if (sel) {
                sel.innerHTML = '<option value="">Select checkpoint...</option>' + items.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            }
        } catch (e) { console.error('loadPatrolCheckpoints:', e); }
    }

    async function loadPatrolLogsPortal() {
        try {
            const items = await rwaGet('/api/rwa/patrol/log');
            const el = document.getElementById('rwaPatrolLogPortalList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No patrol logs.</div>'; return; }
            let html = '<table class="vp-table"><thead><tr><th>Time</th><th>Checkpoint</th><th>Security</th><th>Notes</th></tr></thead><tbody>';
            items.forEach(l => {
                html += `<tr>
                    <td data-label="Time">${fmtDate(l.scanned_at)}</td>
                    <td data-label="Checkpoint">${esc(l.checkpoint_name)}</td>
                    <td data-label="Security">${esc(l.security_name) || '-'}</td>
                    <td data-label="Notes">${esc(l.notes) || '-'}</td>
                </tr>`;
            });
            html += '</tbody></table>';
            el.innerHTML = html;
        } catch (e) { console.error('loadPatrolLogsPortal:', e); }
    }

    const rwaPatrolLogBtn = document.getElementById('rwaPatrolLogBtn');
    if (rwaPatrolLogBtn) {
        rwaPatrolLogBtn.addEventListener('click', async () => {
            const checkpoint_id = document.getElementById('rwaPatrolCpSelect').value;
            const notes = document.getElementById('rwaPatrolNotes').value.trim();
            if (!checkpoint_id) { alert('Select a checkpoint'); return; }
            try { await rwaPost('/api/rwa/patrol/log', { checkpoint_id, notes }); document.getElementById('rwaPatrolNotes').value = ''; loadPatrolLogsPortal(); }
            catch (e) { alert(e.message); }
        });
    }

    // --- QR Camera Scanning (Patrol) ---
    let rwaPatrolScanner = null;
    const rwaPatrolStartScanBtn = document.getElementById('rwaPatrolStartScanBtn');
    const rwaPatrolStopScanBtn = document.getElementById('rwaPatrolStopScanBtn');
    const rwaPatrolScanResult = document.getElementById('rwaPatrolScanResult');

    if (rwaPatrolStartScanBtn) {
        rwaPatrolStartScanBtn.addEventListener('click', () => {
            if (typeof Html5Qrcode === 'undefined') {
                alert('QR scanner library not loaded. Check your internet connection.');
                return;
            }
            rwaPatrolScanner = new Html5Qrcode('rwaPatrolQrReader');
            rwaPatrolStartScanBtn.style.display = 'none';
            rwaPatrolStopScanBtn.style.display = '';
            rwaPatrolScanResult.innerHTML = '<span style="color:#888;">Scanning... Point camera at checkpoint QR.</span>';
            rwaPatrolScanner.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 250, height: 250 } },
                async (decodedText) => {
                    // Stop scanner on successful scan
                    try { await rwaPatrolScanner.stop(); } catch (_) {}
                    rwaPatrolStartScanBtn.style.display = '';
                    rwaPatrolStopScanBtn.style.display = 'none';
                    // Send to scan endpoint
                    try {
                        const result = await rwaPost('/api/rwa/patrol/scan', { payload: decodedText });
                        rwaPatrolScanResult.innerHTML = `<div style="background:#d4edda;color:#155724;padding:12px;border-radius:8px;">
                            <strong>✓ Scanned: ${esc(result.checkpoint_name)}</strong><br>
                            <span style="font-size:0.8rem;">${fmtDate(result.scanned_at)}</span>
                        </div>`;
                        loadPatrolLogsPortal();
                    } catch (e) {
                        rwaPatrolScanResult.innerHTML = `<div style="background:#f8d7da;color:#721c24;padding:12px;border-radius:8px;">
                            <strong>✗ Scan failed</strong><br>${esc(e.message)}
                        </div>`;
                    }
                },
                (errMsg) => {
                    // Ignore per-frame errors (no QR visible)
                }
            ).catch(err => {
                rwaPatrolStartScanBtn.style.display = '';
                rwaPatrolStopScanBtn.style.display = 'none';
                rwaPatrolScanResult.innerHTML = `<div style="background:#f8d7da;color:#721c24;padding:12px;border-radius:8px;">
                    Camera error: ${esc(err)}
                </div>`;
            });
        });
        rwaPatrolStopScanBtn.addEventListener('click', async () => {
            if (rwaPatrolScanner) {
                try { await rwaPatrolScanner.stop(); } catch (_) {}
                rwaPatrolStartScanBtn.style.display = '';
                rwaPatrolStopScanBtn.style.display = 'none';
                rwaPatrolScanResult.innerHTML = '';
            }
        });
    }

    // --- Visitor Pass QR (resident) ---
    async function loadVisitorPasses() {
        try {
            const items = await rwaGet('/api/rwa/pre-approved-passes');
            const el = document.getElementById('rwaVisitorPassesList');
            if (!el) return;
            if (!items.length) { el.innerHTML = '<div class="vp-empty">No pre-approved passes. Create one from the Pre-Approve tab.</div>'; return; }
            let html = '';
            items.forEach(p => {
                const qrUrl = `/api/rwa/visitor-pass/${p.id}/qr`;
                const statusColor = p.status === 'inside' ? '#fff3cd' : p.status === 'completed' ? '#e2e3e5' : '#d4edda';
                const statusText = p.status === 'inside' ? '#856404' : p.status === 'completed' ? '#383d41' : '#155724';
                const waText = encodeURIComponent(`Visitor Pass for ${p.visitor_name}${p.flat ? ' at ' + p.flat : ''}\nPurpose: ${p.purpose || '-'}\nVehicle: ${p.vehicle_number || '-'}\nPlease show the attached QR code at the gate for instant entry.`);
                const waUrl = `https://wa.me/?text=${waText}`;
                html += `<div class="vp-card" style="margin-bottom:12px;display:flex;gap:16px;align-items:start;">
                    <div style="flex-shrink:0;text-align:center;">
                        <img src="${qrUrl}" alt="QR Pass" id="rwaPassQr-${p.id}" style="width:120px;height:120px;border:1px solid #ddd;border-radius:8px;">
                        <div style="margin-top:8px;display:flex;gap:6px;justify-content:center;">
                            <a href="${qrUrl}" download="visitor-pass-${p.id}.png" class="vp-btn" style="padding:4px 10px;font-size:0.75rem;">Download QR</a>
                            <a href="${waUrl}" target="_blank" class="vp-btn vp-btn-primary" style="padding:4px 10px;font-size:0.75rem;">Share on WhatsApp</a>
                        </div>
                    </div>
                    <div style="flex:1;">
                        <strong style="font-size:1.1rem;">${esc(p.visitor_name)}</strong>
                        <span style="background:${statusColor};color:${statusText};padding:2px 8px;border-radius:4px;font-size:0.75rem;margin-left:8px;">${p.status}</span>
                        <p style="margin:6px 0 2px;color:#555;">Purpose: ${esc(p.purpose) || '-'}</p>
                        <p style="margin:2px 0;color:#888;font-size:0.85rem;">Mobile: ${esc(p.visitor_mobile) || '-'} | Vehicle: ${esc(p.vehicle_number) || '-'}</p>
                        <p style="margin:2px 0;color:#888;font-size:0.85rem;">Flat: ${esc(p.flat)} | Created: ${fmtDate(p.created_at)}</p>
                        <p style="margin:6px 0 0;font-size:0.8rem;color:#999;">Download the QR and attach it on WhatsApp, or tap Share to open WhatsApp with the pass details.</p>
                    </div>
                </div>`;
            });
            el.innerHTML = html;
        } catch (e) { console.error('loadVisitorPasses:', e); }
    }

    // --- Load Elite data ---
    loadRwaInvoices();
    loadPatrolCheckpoints();
    loadPatrolLogsPortal();
    loadVisitorPasses();

    initRWA();
})();
