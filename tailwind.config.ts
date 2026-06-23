import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      boxShadow: {
        table: "0 20px 80px rgba(8, 20, 32, 0.22)"
      }
    }
  },
  plugins: []
};

export default config;
