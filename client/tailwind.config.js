/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand:        'rgb(var(--brand)        / <alpha-value>)',
        'brand-dark': 'rgb(var(--brand-dark)   / <alpha-value>)',
        accent:       'rgb(var(--brand)        / <alpha-value>)',
        accentShadow: 'rgb(var(--brand-dark)   / <alpha-value>)',
        surface:      'rgb(var(--surface)      / <alpha-value>)',
        'surface-2':  'rgb(var(--surface-2)    / <alpha-value>)',
        // `dark` now correctly points to the dark page background (was inverted historically).
        // Anything `bg-dark` / `text-dark` will render dark (#0d0d0d) as the name implies.
        dark:         'rgb(var(--page-bg)      / <alpha-value>)',
        'page-bg':    'rgb(var(--page-bg)      / <alpha-value>)',
        'sidebar-bg': 'rgb(var(--sidebar-bg)   / <alpha-value>)',
        // Semantic foreground tokens — use these for text & icons.
        // `fg` = primary readable color on dark surfaces (≥ AA contrast).
        // `fg-muted` = secondary text.
        fg:           'rgb(var(--fg)           / <alpha-value>)',
        'fg-muted':   'rgb(var(--fg-muted)     / <alpha-value>)',
        // Dedicated receipt tokens (printable thermal preview — always white/black).
        'receipt-bg': '#ffffff',
        'receipt-fg': '#000000',
        danger:       'rgb(var(--danger)       / <alpha-value>)',
        success:      'rgb(var(--success)      / <alpha-value>)',
        warning:      'rgb(var(--warning)      / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Courier New"', 'monospace'],
      },
      minHeight: { 'touch': '44px' },
      minWidth:  { 'touch': '44px' },
      boxShadow: {
        'elev-1':    '0 1px 2px   rgb(0 0 0 / 0.20)',
        'elev-2':    '0 4px 12px  rgb(0 0 0 / 0.28)',
        'elev-3':    '0 10px 24px rgb(0 0 0 / 0.36)',
        'elev-glow': '0 0 24px rgb(var(--brand) / 0.30)',
      },
      transitionDuration: {
        '120': '120ms',
        '180': '180ms',
        '240': '240ms',
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'ease-out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
      },
      keyframes: {
        'slide-up':   { '0%': { transform: 'translateY(10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        'slide-down': { '0%': { transform: 'translateY(-10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        'scale-in':   { '0%': { transform: 'scale(0.95)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
      },
      animation: {
        'slide-up':   'slide-up 240ms cubic-bezier(0.25, 1, 0.5, 1) both',
        'slide-down': 'slide-down 240ms cubic-bezier(0.25, 1, 0.5, 1) both',
        'scale-in':   'scale-in 180ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
      },
    },
  },
  plugins: [],
}
