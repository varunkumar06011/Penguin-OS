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
        const app = document.getElementById('app');
        if (!sidebar || !main) return;
        sidebar.classList.toggle('collapsed');
        main.classList.toggle('sidebar-collapsed');
        if (app) app.classList.remove('sidebar-open');
    }

    function goDashboard() {
        const bcHome = document.getElementById('bcHome');
        if (bcHome) bcHome.click();
    }

    function bindSidebarControls() {
        var toggle = document.getElementById('sidebarToggle');
        var scrim = document.getElementById('sidebarScrim');
        var collapseBtn = document.getElementById('sidebarCollapse');
        var sidebar = document.getElementById('appSidebar');

        if (toggle && !toggle._bound) {
            toggle.addEventListener('click', toggleSidebar);
            toggle._bound = true;
        }
        if (scrim && !scrim._bound) {
            scrim.addEventListener('click', closeSidebar);
            scrim._bound = true;
        }
        if (collapseBtn && !collapseBtn._bound) {
            collapseBtn.addEventListener('click', collapseSidebar);
            collapseBtn._bound = true;
        }

        // Delegate nav item clicks for mobile sidebar close (works with dynamically rendered items)
        if (sidebar && !sidebar._navDelegated) {
            sidebar.addEventListener('click', function(e) {
                var item = e.target.closest('.sidebar-nav-item');
                if (item && window.innerWidth <= 900) {
                    closeSidebar();
                }
            });
            sidebar._navDelegated = true;
        }
    }

    // Bind immediately if DOM is already available; also wait for DOMContentLoaded.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindSidebarControls);
    } else {
        bindSidebarControls();
    }
})();
