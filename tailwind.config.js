/** @type {import('tailwindcss').Config} */
// ── Premium enterprise theme (Stripe-inspired) ──────────────────
// The whole app consumes the `navy` and `amber` token scales, so the
// redesign happens here: `navy` is now a slate scale and `amber` is the
// electric-blue accent scale. Token NAMES are kept so no page needs edits.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Slate scale (was navy) — full scale so no step is undefined
        // (undefined steps generate no class → elements inherit dark text and
        //  go invisible on dark backgrounds).
        navy: {
          950: '#020617',
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          600: '#475569',
          500: '#64748b',
          400: '#94a3b8',
          300: '#cbd5e1',
          200: '#e2e8f0',
          100: '#f1f5f9',
          50:  '#f8fafc',
        },
        // Electric blue accent scale (was amber) — full scale defined so
        // no default-amber orange leaks through on undefined steps.
        amber: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        surface: '#f8fafc',
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '12px',
        '2xl': '16px',
        full: '9999px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(2,6,23,0.04), 0 1px 3px rgba(2,6,23,0.05)',
        modal: '0 10px 32px rgba(2,6,23,0.16), 0 4px 12px rgba(2,6,23,0.08)',
      },
    },
  },
  plugins: [],
}
