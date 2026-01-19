/*
 * ==============================================================================
 * ELEPHANT EXCHANGE - SHARED LIBRARY
 * ==============================================================================
 * Common logic for Admin and Scoreboard
 */

// 1. Calculate best text color (Black/White) for a given background
function getContrastColor(hex) {
    if (!hex || hex.length < 7) return '#ffffff';
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
}

// 2. Apply Theme to the current page
function applyTheme(settings) {
    if (!settings) return;

    const root = document.documentElement;
    const primary = settings.themeColor || '#2563eb';
    const bg = settings.themeBg || '';

    // A. Set Variables
    root.style.setProperty('--primary', primary);
    root.style.setProperty('--bg-image', bg ? `url('${bg}')` : 'none');

    // B. Calculate Contrast
    const textCol = getContrastColor(primary);

    // C. Inject Dynamic CSS (Covers Buttons, Active Rows, and Mobile)
    let styleTag = document.getElementById('dynamic-theme-style');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'dynamic-theme-style';
        document.head.appendChild(styleTag);
    }

    styleTag.innerHTML = `
        /* Buttons */
        .btn-primary, .btn-blue, .btn-sm, .btn-green, .btn-orange { 
            background-color: ${primary} !important; 
            color: ${textCol} !important; 
        }
        
        /* Active Player Row (Admin) & Active Turn (TV) */
        .active-row, .active-turn { 
            border: 2px solid ${primary} !important; 
            background-color: ${primary}15 !important; /* 10% opacity hex */
        }
        
        /* Mobile Camera Button */
        .btn-camera-add {
            background-color: ${primary};
            color: ${textCol};
        }

        /* Victim Exception (Always Red) */
        .victim-row {
            border-color: #dc2626 !important;
            background-color: #fef2f2 !important;
        }
    `;

    // D. Handle Logo (Safe check for existence)
    const titleEl = document.querySelector('h1');
    const existingLogo = document.getElementById('customGameLogo');
    
    if (settings.themeLogo) {
        if (!existingLogo && titleEl) {
            const img = document.createElement('img');
            img.src = settings.themeLogo;
            img.id = 'customGameLogo';
            img.className = 'game-logo';
            // Insert before the H1 or Banner
            const banner = document.getElementById('activePlayerBanner');
            const target = banner || titleEl;
            target.parentNode.insertBefore(img, target);
        } else if (existingLogo) {
            existingLogo.src = settings.themeLogo;
        }
    }
}