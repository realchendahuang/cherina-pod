import { bindings, defineConfig } from "cf/config";


export default defineConfig({
	worker: {
		name: "cherina-pod",
		compatibilityDate: "2024-12-01",
		entrypoint: "src/index.ts",
		workersDev: true,
		observability: {
			enabled: true,
		},
		assets: {
			notFoundHandling: "404-page",
		},
		domains: [
			"pod.cherina.app",
		],
		env: {
			DB: bindings.d1({
				name: "cherina-pod-db",
				id: "ae388ead-47e4-4d23-ba4d-4a84e4afd407",
			}),
			ASSETS: bindings.assets(),
		},
	},
});
