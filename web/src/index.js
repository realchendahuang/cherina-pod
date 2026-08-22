// cherina-pod：纯静态展示 Worker。
// 所有内容（index.html / bilingual.json）由 ASSETS 静态资源服务，
// 这里只做兜底：若将来需要 API 路由（如按集数取数据），在此扩展。
export default {
	async fetch(request, env, ctx) {
		return env.ASSETS.fetch(request);
	},
};
