import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["./vitest.setup.ts"],
		reporters: ["default", "junit"],
		outputFile: { junit: "./test-report.junit.xml" },
		coverage: {
			provider: "v8",
			reporter: ["text", "text-summary", "lcov"],
			include: ["src/**/*.ts"],
			exclude: [
				"**/*.test.ts",
				"**/test/**",
				"**/index.ts",
				"src/cli.ts",
				"src/interfaces/**",
				"src/live/**",
				"src/shell/**",
			],
			thresholds: {
				lines: 90,
				functions: 90,
				statements: 90,
				branches: 90,
			},
		},
	},
});
