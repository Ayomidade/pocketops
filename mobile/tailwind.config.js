/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./src/**/*.{js,jsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: "#0B1220",
        panel: "#142033",
        accent: "#3B82F6",
        mint: "#38D9B3",
      },
    },
  },
  plugins: [],
};
