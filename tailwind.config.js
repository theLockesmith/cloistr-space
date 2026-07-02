// NOTE: This app uses Tailwind v4 with CSS-based configuration via @tailwindcss/postcss.
// Token mapping lives in src/index.css (@theme block) and resolves to @cloistr/ui CSS vars.
// The @cloistr/tailwind-config preset applies to v3-style JS configs; for full preset adoption
// here, components would need to be migrated from cloistr-{dark,light,secondary,accent} to the
// preset's canonical names (cloistr-bg, cloistr-text, etc.) — deferred to a future refactor.
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
};
