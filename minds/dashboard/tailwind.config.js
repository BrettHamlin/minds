/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{tsx,ts,jsx,js}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(224 71% 4%)",
        card: "hsl(222 47% 11%)",
        border: "hsl(217 33% 17%)",
        foreground: "hsl(210 40% 98%)",
      },
    },
  },
  plugins: [],
};
