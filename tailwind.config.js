/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        fg: "#0f172a",
        "fg-muted": "#64748b",
        surface: "#ffffff",
        "surface-2": "#f1f5f9",
      },
    },
  },
  plugins: [],
};
