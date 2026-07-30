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

    /* ============================================================
       Sticky tracker header — measure height and set CSS variable
       so table thead th sticks at the correct offset.
       ============================================================ */
    function updateTrackerStickyOffset() {
        var trackerView = document.getElementById('trackerView');
        if (!trackerView || trackerView.style.display === 'none') return;

        var bulkBar = document.getElementById('bulkStickyBar');
        if (!bulkBar) return;

        var bulkHeight = bulkBar.offsetHeight;
        trackerView.style.setProperty('--bulk-bar-h', bulkHeight + 'px');

        // Measure section header height for thead th sticky offset
        var sectionHeader = document.querySelector('.work-view-container .section-header');
        if (sectionHeader) {
            trackerView.style.setProperty('--section-h', sectionHeader.offsetHeight + 'px');
        }

        // Measure mobile flat nav height for chip sticky offset
        var mobileNav = document.querySelector('.mobile-flat-nav');
        if (mobileNav) {
            trackerView.style.setProperty('--mobile-nav-h', mobileNav.offsetHeight + 'px');
        }
    }

    // Expose globally so cells.js / features.js can call after rendering
    window.updateTrackerStickyOffset = updateTrackerStickyOffset;

    // Update on scroll (sticky header height can change if bulk bar appears/disappears)
    var _stickyRaf = null;
    function scheduleStickyUpdate() {
        if (_stickyRaf) return;
        _stickyRaf = requestAnimationFrame(function() {
            _stickyRaf = null;
            updateTrackerStickyOffset();
        });
    }

    window.addEventListener('scroll', scheduleStickyUpdate, { passive: true });
    window.addEventListener('resize', scheduleStickyUpdate, { passive: true });

    // Also observe DOM mutations in the bulk bar (e.g. bulk action bar visibility change)
    if (typeof MutationObserver !== 'undefined') {
        var bulkBar = document.getElementById('bulkStickyBar');
        if (bulkBar) {
            var mo = new MutationObserver(scheduleStickyUpdate);
            mo.observe(bulkBar, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
        }
    }

    // Initial call after DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateTrackerStickyOffset);
    } else {
        updateTrackerStickyOffset();
    }
})();
