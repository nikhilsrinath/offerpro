# EdgeOS Complete UI/UX Audit & Design System

> **Objective:** Pixel-perfect replication reference for the EdgeOS Enterprise Operating System interface.

---

## 1. TYPOGRAPHY SYSTEM

### 1.1 Font Families
```css
/* Primary Font Stack */
--font-main: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-display: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

/* Document Generation Fonts (PDF/Downloads) */
'Playfair Display'     /* Certificates, formal docs */
'Lato'                 /* Alternative body text */
'Poppins'              /* Branding, logo text */
'IM Fell English'      /* Vintage/classic docs */
'Libre Baskerville'    /* Elegant typography */
```

**Google Fonts URL:**
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap" rel="stylesheet">
```

### 1.2 Typography Scale

| Element | Size | Weight | Line Height | Letter Spacing | Usage |
|---------|------|--------|-------------|----------------|-------|
| Hero Title | `clamp(3.5rem, 8vw, 6.5rem)` | 900 | 0.95 | -0.05em | Landing page main headline |
| H1 Page Title | `clamp(2.5rem, 5vw, 4rem)` | 800 | 1.1 | -0.04em | Page headers |
| H2 Section | `clamp(2.5rem, 5vw, 3.5rem)` | 800 | 1.1 | - | Section titles |
| H3 Card Title | `1.75rem - 2.5rem` | 700-800 | 1.2 | -0.02em | Card headers |
| H4 Subsection | `0.9375rem` | 700 | 1.3 | -0.02em | Sub-headings |
| Body Large | `1.125rem - 1.25rem` | 400 | 1.6 | - | Primary content |
| Body | `0.9375rem` | 400-500 | 1.6 | - | Standard text |
| Body Small | `0.875rem` | 400 | 1.5 | - | Secondary text |
| Caption | `0.75rem` | 500-600 | 1.4 | 0.04em | Meta information |
| Label | `0.6875rem - 0.8125rem` | 700-850 | 1.3 | 0.06-0.15em | Form labels, badges |
| Micro | `0.6rem` | 700 | 1.3 | 0.07-0.1em | Tiny labels, stat subtext |

### 1.3 Text Transform Patterns
```css
/* Uppercase labels (common pattern) */
font-size: 0.6875rem;
font-weight: 700;
text-transform: uppercase;
letter-spacing: 0.08em; /* or 0.15em for emphasis */

/* Eyebrow badges */
font-size: 0.6rem;
font-weight: 700;
text-transform: uppercase;
letter-spacing: 0.08em;
```

---

## 2. COLOR SYSTEM

### 2.1 CSS Custom Properties (Exact Values)

#### Light Theme (`:root` / `[data-theme="light"]`)
```css
/* Backgrounds */
--background: #f8f9fb;
--surface: #ffffff;
--surface-hover: #f1f3f5;
--bg-base: #f8f9fb;
--bg-elevated: #ffffff;
--bg-raised: #f1f3f5;
--bg-overlay: #e8eaed;
--bg-sunken: #f1f3f5;

/* Text Colors */
--text-primary: #18181b;
--text-secondary: #3f3f46;
--text-tertiary: #71717a;
--text-muted: #a1a1aa;
--accent: #18181b;
--accent-muted: #71717a;

/* Borders */
--border: rgba(0, 0, 0, 0.08);
--border-subtle: rgba(0, 0, 0, 0.06);
--border-default: rgba(0, 0, 0, 0.1);
--border-strong: rgba(0, 0, 0, 0.16);

/* Accent Colors */
--blue: #3b82f6;
--blue-hover: #2563eb;
--blue-muted: rgba(59, 130, 246, 0.08);
--blue-border: rgba(59, 130, 246, 0.2);

--gold: #b45309;
--gold-muted: rgba(180, 83, 9, 0.1);

--success: #10b981;
--success-muted: rgba(16, 185, 129, 0.08);
--error: #dc2626;
--error-muted: rgba(220, 38, 38, 0.05);

/* Glow/Overlays */
--accent-glow: rgba(0, 0, 0, 0.02);
--overlay-bg: rgba(0, 0, 0, 0.4);
```

#### Dark Theme (`[data-theme="dark"]`)
```css
/* Backgrounds */
--background: #09090b;
--surface: #0f0f12;
--surface-hover: #161619;
--bg-base: #09090b;
--bg-elevated: #111113;
--bg-raised: #18181b;
--bg-overlay: #1f1f23;
--bg-sunken: #050506;

/* Text Colors */
--text-primary: #fafafa;
--text-secondary: #a1a1aa;
--text-tertiary: #71717a;
--text-muted: #52525b;
--accent: #ffffff;
--accent-muted: #a1a1aa;

/* Borders */
--border: rgba(255, 255, 255, 0.08);
--border-subtle: rgba(255, 255, 255, 0.06);
--border-default: rgba(255, 255, 255, 0.09);
--border-strong: rgba(255, 255, 255, 0.14);

/* Accent Colors (Dark variants) */
--blue-hover: #60a5fa;
--blue-muted: rgba(59, 130, 246, 0.12);
--blue-border: rgba(59, 130, 246, 0.25);

--gold: #F5C842;
--gold-muted: rgba(245, 200, 66, 0.12);

--success: #34d399;
--success-muted: rgba(16, 185, 129, 0.12);
--error: #f87171;
--error-muted: rgba(248, 113, 113, 0.08);

/* Glow/Overlays */
--accent-glow: rgba(255, 255, 255, 0.04);
--overlay-bg: rgba(0, 0, 0, 0.85);
```

### 2.2 Module Color Assignment (Fixed Palette)
| Module | Primary Color | Hex | Muted Variant |
|--------|---------------|-----|---------------|
| Team | Violet | `#8b5cf6` | `#8b5cf612` |
| Documents | Emerald | `#10b981` | `#10b98112` |
| Finance | Amber | `#f59e0b` | `#f59e0b12` |
| Business | Fuchsia | `#d946ef` | - |
| Records | Red | `#ef4444` | - |
| Overview | Slate | `#64748b` | - |

### 2.3 Chart/Graph Colors (Document Distribution)
```javascript
const PIE_COLORS = {
    'Offer Letters': '#fbbf24',  // Amber 400
    'Invoices':      '#f97316',  // Orange 500
    'Quotations':    '#a855f7',  // Purple 500
    'Proformas':     '#6366f1',  // Indigo 500
};
```

### 2.4 Gradient Patterns
```css
/* Brand Gradient (Logo) */
background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
box-shadow: 0 4px 14px rgba(59, 130, 246, 0.35);

/* Stats Number Gradient (Dark mode) */
background: linear-gradient(180deg, #fff 0%, rgba(255, 255, 255, 0.7) 100%);
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;

/* Card Accent Lines */
background: linear-gradient(90deg, ${color}, ${color}60); /* 60 = ~38% opacity */

/* Grid Background Pattern */
background-image: 
    linear-gradient(${gridLine} 1px, transparent 1px),
    linear-gradient(90deg, ${gridLine} 1px, transparent 1px);
background-size: 60px 60px;
mask-image: radial-gradient(ellipse 90% 60% at 50% 0%, black 10%, transparent 75%);
```

---

## 3. SPACING & LAYOUT SYSTEM

### 3.1 Spacing Scale (Rem-based)
```css
--space-24: 6rem;  /* Custom property */

/* Standard spacing values used: */
0.125rem  (2px)   - Micro gaps
0.25rem   (4px)   - Tight spacing
0.375rem  (6px)   - Icon gaps
0.5rem    (8px)   - Default small
0.625rem  (10px)  - Button padding Y
0.75rem   (12px)  - Card padding small
0.875rem  (14px)  - Input padding
1rem      (16px)  - Base unit
1.25rem   (20px)  - Card padding medium
1.5rem    (24px)  - Section gaps
1.75rem   (28px)  - Large spacing
2rem      (32px)  - Section padding
2.5rem    (40px)  - Form containers
3rem      (48px)  - Section margins
4rem      (64px)  - Major sections
5rem      (80px)  - Hero spacing
6rem      (96px)  /* --space-24 */
8rem      (128px) - Major section gaps
```

### 3.2 Border Radius Scale
```css
--radius-lg: 24px;  /* Bento cards, modals */

/* Common radius values: */
4px   - Small dots, inline elements
6px   - Tiny badges
8px   - Icon containers, small buttons
10px  - Sidebar items, nav buttons
12px  - Buttons, inputs, cards (default)
14px  - Large cards (dashboard)
16px  - Analytics mini-cards
99px  - Pills, nav bars (fully rounded)
50%   - Avatar circles
```

### 3.3 Layout Grid System

#### Dashboard Grid
```css
/* Stats Grid */
grid-template-columns: repeat(4, 1fr);
gap: 1rem;

/* Charts Row */
grid-template-columns: 1.5fr 1fr;  /* Revenue | Distribution */

/* Module Grid */
grid-template-columns: repeat(3, 1fr);

/* Mobile */
grid-template-columns: repeat(2, 1fr);  /* Stats */
grid-template-columns: 1fr;               /* Charts, Modules */
```

#### Bento Grid (Landing Page)
```css
.bento-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
}

/* Card spanning */
grid-column: span 8;   /* Large cards */
grid-column: span 6;   /* Medium cards */
grid-column: span 4;   /* Small cards */
```

### 3.4 Breakpoints
```css
/* Mobile */
@media (max-width: 480px) { /* Tiny phones */ }

/* Mobile */
@media (max-width: 768px) { 
    /* Primary mobile breakpoint */
    /* Sidebar collapses */
    /* Grid becomes single column */
    /* Typography scales down */
}

/* Tablet */
@media (max-width: 992px) {
    /* Stats: 2 columns */
    /* Testimonial cards: 90vw */
}

/* Large Tablet/Small Desktop */
@media (max-width: 1100px) {
    /* Bento cards: full width */
    /* Module grid: 2 columns */
}

/* Desktop sidebar breakpoint */
@media (max-width: 1024px) {
    /* Auth visual side hidden */
}
```

### 3.5 Container Patterns
```css
/* Main content container */
max-width: 1200px;
max-width: 1300px;  /* Hub page */
margin: 0 auto;
padding: 2rem 2.5rem;  /* Desktop */
padding: 1.5rem 1rem;  /* Mobile */

/* Sidebar width */
width: 280px;  /* Fixed sidebar */

/* Card padding scale */
padding: 1rem;       /* Mobile cards */
padding: 1.25rem;    /* Standard cards */
padding: 1.5rem;     /* Large cards */
padding: 2rem;       /* Bento/desktop */
padding: 3rem;       /* Hero bento cards */
```

---

## 4. SHADOW SYSTEM

### 4.1 Shadow Scale
```css
/* Light Theme */
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.1), 0 4px 8px rgba(0, 0, 0, 0.05);
--shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.06);

--card-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.04);
--card-shadow-hover: 0 8px 24px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.06);

/* Dark Theme */
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.4);
--shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.4);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.3);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.4), 0 4px 8px rgba(0, 0, 0, 0.3);
--shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.45), 0 8px 16px rgba(0, 0, 0, 0.3);

--card-shadow: 0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 0 rgba(255, 255, 255, 0.03) inset;
--card-shadow-hover: 0 8px 24px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.04) inset;
```

### 4.2 Focus Ring
```css
--focus-ring: 0 0 0 2px var(--bg-base), 0 0 0 4px rgba(59, 130, 246, 0.4);  /* Light */
--focus-ring: 0 0 0 2px var(--bg-base), 0 0 0 4px rgba(59, 130, 246, 0.5);  /* Dark */
```

---

## 5. COMPONENT STYLING

### 5.1 Buttons

#### Primary Button (`.btn-cinematic`)
```css
background: var(--btn-accent-bg);  /* Light: #18181b | Dark: #ffffff */
color: var(--btn-accent-text);     /* Light: #ffffff | Dark: #09090b */
padding: 0.875rem 2rem;
border-radius: 12px;
font-weight: 700;
font-size: 0.9375rem;
border: none;
transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
```
**Hover:** `translateY(-2px)` + `box-shadow: var(--btn-accent-shadow)`

#### Secondary Button
```css
background: var(--bg-raised);
color: var(--text-primary);
border: 1px solid var(--border);
backdrop-filter: blur(10px);
```

#### Mobile Button Override
```css
@media (max-width: 480px) {
    .btn-cinematic {
        height: 44px;
        padding: 0 1.25rem;
        font-size: 0.8125rem;
        border-radius: 99px;
    }
}
```

### 5.2 Cards

#### Standard Card Pattern
```css
background: var(--bg-elevated);  /* Light: #ffffff | Dark: #111113 */
border: 1px solid var(--border-default);
border-radius: 12px;  /* or 14px for dashboard */
padding: 1.5rem;
box-shadow: var(--card-shadow);
transition: all 0.2s ease;
```

**Card Hover State:**
```css
border-color: var(--border-strong);
transform: translateY(-2px);
box-shadow: var(--card-shadow-hover);
```

#### Card with Gradient Accent
```css
/* Top accent line */
position: absolute;
top: 0; left: 0; right: 0;
height: 3px;
background: linear-gradient(90deg, ${brand-color}, transparent);
```

#### Bento Card (Premium)
```css
background: rgba(10, 10, 10, 0.4);
backdrop-filter: blur(12px);
-webkit-backdrop-filter: blur(12px);
border: 1px solid var(--border);
border-radius: var(--radius-lg);  /* 24px */
padding: 3rem;
transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
```

### 5.3 Inputs

#### Standard Input
```css
width: 100%;
background: var(--bg-sunken);
border: 1px solid var(--border-subtle);
border-radius: 12px;
padding: 0.875rem 1rem;  /* or 0.625rem 0.75rem for compact */
color: var(--text-primary);
font-size: 0.9375rem;
outline: none;
transition: all 0.3s ease;
```

**Focus State:**
```css
border-color: var(--border-strong);
box-shadow: var(--focus-ring);
```

#### Registration Text Input (Underlined)
```css
background: transparent;
border: none;
border-bottom: 2px solid var(--border-default);
color: var(--text-primary);
font-size: 1.75rem;
padding: 0.5rem 0;
outline: none;
```

### 5.4 Sidebar Navigation

#### Sidebar Container
```css
width: 280px;
height: 100vh;
position: fixed;
left: 0; top: 0;
background: var(--bg-base);
border-right: 1px solid var(--border-default);
display: flex;
flex-direction: column;
z-index: 50;
```

#### Sidebar Item
```css
display: flex;
align-items: center;
gap: 0.75rem;
padding: 0.625rem 0.75rem;
border-radius: 10px;
border: none;
background: transparent;
transition: all 0.2s ease;
```

**Active State:**
```css
background: rgba(255,255,255,0.08);  /* Dark */
background: rgba(0,0,0,0.05);       /* Light */
```

**Icon Container:**
```css
width: 32px;
height: 32px;
border-radius: 8px;
background: rgba(255,255,255,0.05);  /* or color-muted variant */
display: flex;
align-items: center;
justify-content: center;
```

### 5.5 Navigation (Glass)

```css
.glass-nav {
    position: sticky;
    top: 1.5rem;
    margin: 0 auto;
    width: calc(100% - 3rem);
    max-width: 1200px;
    background: rgba(10, 10, 10, 0.7);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    border-radius: 99px;
    padding: 0.75rem 2.5rem;
    z-index: 1000;
}
```

### 5.6 Badges & Labels

#### Eyebrow Badge
```css
display: inline-flex;
align-items: center;
gap: 0.375rem;
padding: 0.3rem 0.875rem;
background: rgba(0,0,0,0.04);  /* Light */
border: 1px solid var(--border);
border-radius: 999px;
font-size: 0.6rem;
font-weight: 700;
text-transform: uppercase;
letter-spacing: 0.08em;
```

#### Status Badge
```css
padding: 0.25rem 0.75rem;
background: var(--bg-raised);
border: 1px solid var(--border);
border-radius: 999px;
font-size: 0.6875rem;
font-weight: 700;
letter-spacing: 0.04em;
```

---

## 6. ICONOGRAPHY SYSTEM

### 6.1 Icon Library
**Primary:** `lucide-react` (consistent stroke-based icons)

### 6.2 Icon Size Scale
| Size | Usage |
|------|-------|
| 12px | Inline indicators, micro UI |
| 14px | Compact buttons, stat trends |
| 16px | Sidebar icons, small buttons |
| 18px | Mobile navigation |
| 20px | Standard buttons, cards |
| 22px | Featured action icons |
| 24px | Hero icons, large CTAs |
| 28-32px | Brand elements, hero graphics |

### 6.3 Icon Styling Pattern
```css
/* Standard icon container */
width: 40px;
height: 40px;
border-radius: 10px;
background: ${color}15;  /* 15 = ~8% opacity */
display: flex;
align-items: center;
justify-content: center;
color: ${color};

/* Stroke width */
strokeWidth: 2;    /* Default */
strokeWidth: 2.5;  /* Emphasis */
```

---

## 7. ANIMATIONS & INTERACTIONS

### 7.1 Transition Patterns
```css
/* Standard */
transition: all 0.2s ease;
transition: all 0.3s ease;

/* Premium/Elevated */
transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);

/* Specific properties */
transition: background 0.15s ease, border-color 0.15s ease;
transition: transform 0.3s ease, opacity 0.3s ease;
```

### 7.2 Keyframe Animations
```css
/* Spinner */
@keyframes spin {
    to { transform: rotate(360deg); }
}
animation: spin 1s linear infinite;

/* Logo Carousel */
@keyframes logo-scroll {
    0% { transform: translateX(0); }
    100% { transform: translateX(calc(-220px * 6 - 1rem * 6)); }
}
animation: logo-scroll 30s linear infinite;

/* Pulse (Loading) */
@keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
}
animation: pulse 1.5s ease-in-out infinite;

/* Fade In */
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
animation: fadeIn 0.2s ease;
```

### 7.3 Hover Microinteractions
```css
/* Card lift */
transform: translateY(-2px);  /* Standard */
transform: translateY(-3px);  /* Premium cards */

/* Scale effects */
transform: scale(1.05);  /* Icons */

/* Glow on hover (dark mode) */
box-shadow: 0 20px 40px rgba(0,0,0,0.5);  /* Dark */
box-shadow: 0 20px 40px rgba(0,0,0,0.1);  /* Light */

/* Color transitions */
background: rgba(255,255,255,0.04) → rgba(255,255,255,0.08);  /* Dark hover */
```

---

## 8. CSS ARCHITECTURE

### 8.1 Naming Convention
- **BEM-like**: `.component-element--modifier`
- **Examples:**
  - `.hero-section` / `.hero-title` / `.hero-actions`
  - `.sidebar-item` / `.sidebar-brand` / `.sidebar-footer`
  - `.billing-summary-card` / `.billing-summary-icon`

### 8.2 CSS Custom Properties Strategy
```css
/* Theme tokens at :root */
--background, --surface, --text-primary, etc.

/* Semantic colors */
--success, --error, --gold

/* Component-specific */
--card-shadow, --focus-ring
--chart-tooltip-bg, --chart-grid
```

### 8.3 File Organization
```
src/
├── index.css          /* Main design system + all component styles */
├── components/
│   ├── LandingPage.css    /* Landing-specific */
│   └── landing/
│       └── SubPage.css    /* Sub-page components */
```

### 8.4 No CSS-in-JS
- All styles in `.css` files
- React components use inline styles only for dynamic theme values
- CSS variables handle theme switching via `data-theme` attribute

---

## 9. RESPONSIVENESS PATTERNS

### 9.1 Mobile-First or Desktop-First?
**Desktop-first with mobile overrides** - Base styles target desktop, mobile styles in `@media (max-width: 768px)`

### 9.2 Adaptive Patterns

#### Sidebar Behavior
```
Desktop (>768px): Fixed 280px sidebar visible
Mobile (≤768px):  Hidden, slide-in drawer from left
```

#### Grid Adaptations
```css
/* Desktop → Mobile */
grid-template-columns: repeat(4, 1fr) → repeat(2, 1fr)  /* Stats */
grid-template-columns: 1.5fr 1fr → 1fr                   /* Charts */
grid-template-columns: repeat(3, 1fr) → 1fr            /* Modules */
```

#### Typography Scaling
```css
/* Fluid typography pattern */
font-size: clamp(3.5rem, 8vw, 6.5rem);  /* Hero */
font-size: clamp(1.5rem, 3vw, 2.25rem); /* Sub-headings */
```

### 9.3 Mobile-Specific Patterns
```css
/* Safe area padding */
padding: 0 2rem;        /* Minimum mobile padding */
padding: 1rem 1.25rem;  /* Compact mobile */

/* Touch targets */
min-height: 44px;       /* iOS recommended */
min-height: 32px;       /* Desktop buttons */
```

---

## 10. ASSETS & VISUAL EFFECTS

### 10.1 Background Treatments

#### Grid Pattern (Common)
```css
background-image: 
    linear-gradient(${lineColor} 1px, transparent 1px),
    linear-gradient(90deg, ${lineColor} 1px, transparent 1px);
background-size: 60px 60px;
mask-image: radial-gradient(ellipse 90% 60% at 50% 0%, black 10%, transparent 75%);
```

#### Radial Glow (Dark Mode)
```css
background: radial-gradient(ellipse at center, rgba(255,255,255,0.035) 0%, transparent 65%);
```

#### Mouse Follow Glow
```css
.mouse-glow {
    background: radial-gradient(800px circle at var(--mouse-x) var(--mouse-y),
        rgba(255, 255, 255, 0.04),
        transparent 80%);
}
```

### 10.2 Glassmorphism
```css
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
background: rgba(10, 10, 10, 0.7);
border: 1px solid var(--border);
```

### 10.3 Gradient Overlays
```css
/* Card hover glow */
background: radial-gradient(circle at var(--mouse-x) var(--mouse-y),
    rgba(255,255,255,0.03),
    transparent 40%);

/* Top accent */
background: linear-gradient(90deg, ${color} 0%, ${color}40 60%, transparent 100%);
```

---

## 11. REPLICATION-READY STYLE GUIDE

### 11.1 Quick Setup (Tailwind Config)
```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        // Light theme
        background: '#f8f9fb',
        surface: '#ffffff',
        'bg-elevated': '#ffffff',
        'bg-sunken': '#f1f3f5',
        
        // Dark theme
        'dark-background': '#09090b',
        'dark-surface': '#0f0f12',
        'dark-elevated': '#111113',
        
        // Text
        'text-primary': '#18181b',
        'text-secondary': '#3f3f46',
        'text-tertiary': '#71717a',
        'text-muted': '#a1a1aa',
        
        // Dark text
        'dark-text-primary': '#fafafa',
        'dark-text-secondary': '#a1a1aa',
        
        // Module colors
        'team': '#8b5cf6',
        'documents': '#10b981',
        'finance': '#f59e0b',
        'business': '#d946ef',
        'records': '#ef4444',
        
        // Semantic
        success: '#10b981',
        error: '#dc2626',
        blue: '#3b82f6',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        display: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        'lg': '24px',
        'card': '14px',
        'button': '12px',
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 8px 24px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.06)',
        'dark-card': '0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 0 rgba(255, 255, 255, 0.03) inset',
      },
      letterSpacing: {
        'display': '-0.04em',
        'heading': '-0.02em',
      }
    }
  }
}
```

### 11.2 Component Templates

#### Button Component
```jsx
const Button = ({ variant = 'primary', children, ...props }) => {
  const baseStyles = "inline-flex items-center justify-center gap-2 font-bold transition-all duration-300";
  
  const variants = {
    primary: "bg-[#18181b] text-white dark:bg-white dark:text-[#09090b] px-8 py-3.5 rounded-xl text-[0.9375rem] hover:-translate-y-0.5 hover:shadow-md",
    secondary: "bg-[#f1f3f5] text-[#18181b] dark:bg-[#18181b] dark:text-white border border-black/10 px-8 py-3.5 rounded-xl hover:bg-[#e8eaed]",
    ghost: "bg-transparent text-[#71717a] hover:bg-black/5 dark:hover:bg-white/5 px-3 py-2 rounded-lg text-sm"
  };
  
  return (
    <button className={`${baseStyles} ${variants[variant]}`} {...props}>
      {children}
    </button>
  );
};
```

#### Card Component
```jsx
const Card = ({ accentColor, children }) => (
  <div className="relative bg-white dark:bg-[#111113] border border-black/[0.08] dark:border-white/[0.08] rounded-[14px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg overflow-hidden">
    {/* Accent line */}
    <div 
      className="absolute top-0 left-0 right-0 h-[3px]"
      style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}
    />
    {children}
  </div>
);
```

---

## 12. CHART STYLING SPECIFICATIONS

### 12.1 Recharts Configuration
```javascript
// Theme-aware chart styles
const chartStyles = () => ({
  tooltip: {
    background: css('--chart-tooltip-bg'),
    border: `1px solid ${css('--chart-tooltip-border')}`,
    borderRadius: 10,
    fontSize: 12,
    color: css('--chart-tooltip-text')
  },
  label: { color: css('--chart-axis-text') },
  axis: { 
    fill: css('--chart-axis-text'), 
    fontSize: 11 
  },
  grid: css('--chart-grid'),
});

// Area gradient definition
<defs>
  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />  {/* Dark: 0.3, Light: 0.18 */}
    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
  </linearGradient>
</defs>
```

---

**END OF AUDIT**

*This document contains all exact values, patterns, and specifications required for pixel-perfect replication of the EdgeOS interface.*
