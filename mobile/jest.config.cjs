module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/tests/**/*.test.jsx"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native|expo|@expo|@react-navigation|react-native-css-interop|nativewind|@tanstack))",
  ],
};
