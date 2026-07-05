/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: "tsconfig.test.json",
    }],
  },
  collectCoverageFrom: [
    "src/services/**/*.ts",
    "src/config/**/*.ts",
    "!src/**/*.d.ts",
  ],
};
