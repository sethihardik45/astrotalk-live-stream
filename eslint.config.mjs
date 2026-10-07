import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "node_modules/**", ".devdb/**", "next-env.d.ts"] },
  {
    rules: {
      // The astrologer page intentionally sets state inside effects (timers, LiveKit events).
      "react-hooks/set-state-in-effect": "off",
      // Login/logout use a full page load on purpose, so the new (or removed) session cookie applies everywhere.
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
];

export default config;
