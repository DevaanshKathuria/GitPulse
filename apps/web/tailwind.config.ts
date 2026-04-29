import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "#1f2937",
        background: "#070a12",
        foreground: "#e5e7eb",
        muted: "#94a3b8",
        surface: "#0d1320",
        accent: "#38bdf8"
      }
    }
  },
  plugins: []
};

export default config;
