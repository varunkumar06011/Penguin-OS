/* ============================================================
   theme-ui.js — Sidebar toggle + dashboard navigation
   Does NOT duplicate any navigation logic from app.js.
   ============================================================ */

(function () {
    'use strict';

    function toggleSidebar() {
        const app = document.getElementById('app');
        if (app) app.classList.toggle('sidebar-open');
    }

    function closeSidebar() {
        const app = document.getElementById('app');
        if (app) app.classList.remove('sidebar-open');
    }

    function collapseSidebar() {
        const sidebar = document.getElementById('appSidebar');
        const main = document.getElementById('appMain');
        if (!sidebar || !main) return;
        sidebar.classList.toggle('collapsed');
        main.classList.toggle('sidebar-collapsed');
    }

    function goDashboard() {
        const bcHome = document.getElementById('bcHome');
        if (bcHome) bcHome.click();
    }

    document.addEventListener('DOMContentLoaded', function () {
        var toggle = document.getElementById('sidebarToggle');
        var scrim = document.getElementById('sidebarScrim');
        var collapseBtn = document.getElementById('sidebarCollapse');
        var dashboardBtn = document.getElementById('sidebarDashboard');

        if (toggle) toggle.addEventListener('click', toggleSidebar);
        if (scrim) scrim.addEventListener('click', closeSidebar);
        if (collapseBtn) collapseBtn.addEventListener('click', collapseSidebar);
        if (dashboardBtn) dashboardBtn.addEventListener('click', function () {
            goDashboard();
            closeSidebar();
        });
    });
})();
