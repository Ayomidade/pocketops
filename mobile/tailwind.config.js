/** @type {import('tailwindcss').Config} */
const { colors } = require("./src/theme/tokens");

module.exports = {
  content: ["./app/**/*.{js,jsx}", "./src/**/*.{js,jsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: Object.fromEntries(Object.keys(colors).map(key => [key, `rgb(var(--color-${key}) / <alpha-value>)`])),
      fontFamily: { sans: ["Inter"], mono: ["JetBrainsMono", "monospace"] },
    },
  },
  plugins: [],
};
