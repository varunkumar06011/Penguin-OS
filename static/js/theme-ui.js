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
        var stickyHeader = document.getElementById('trackerStickyHeader');
        var trackerView = document.getElementById('trackerView');
        if (!stickyHeader || !trackerView || trackerView.style.display === 'none') return;

        var height = stickyHeader.offsetHeight;
        // Account for #appMain padding-top on mobile (hamburger offset)
        var appMain = document.getElementById('appMain');
        var extraTop = 0;
        if (appMain && window.innerWidth <= 900) {
            var cs = window.getComputedStyle(appMain);
            extraTop = parseFloat(cs.paddingTop) || 0;
        }
        var offset = height + extraTop;
        trackerView.style.setProperty('--tracker-header-offset', offset + 'px');

        /* Measure Work View section header height for thead th sticky offset */
        var sectionHeader = document.querySelector('.work-view-container .section-header');
        if (sectionHeader) {
            trackerView.style.setProperty('--work-section-h', sectionHeader.offsetHeight + 'px');
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

    // Also observe DOM mutations in the sticky header (e.g. bulk bar visibility change)
    if (typeof MutationObserver !== 'undefined') {
        var stickyHeader = document.getElementById('trackerStickyHeader');
        if (stickyHeader) {
            var mo = new MutationObserver(scheduleStickyUpdate);
            mo.observe(stickyHeader, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
        }
    }

    // Initial call after DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateTrackerStickyOffset);
    } else {
        updateTrackerStickyOffset();
    }
})();
