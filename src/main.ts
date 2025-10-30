import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createSSRApp } from 'vue'
import App from './App.vue'
import { routeInterceptor } from './router/interceptor'
import store from './store'
// 导入 polyfill
import '@/lib/orpc/polyfills'
import '@/style/index.scss'
import 'virtual:uno.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // ⚠️ 这些不是请求超时!
      staleTime: 30 * 1000, // 数据 30 秒后过期
      gcTime: 5 * 60 * 1000, // 缓存保留 5 分钟

      // ✅ 重试配置(可以间接控制总等待时间)
      retry: 0, // 失败重试 2 次
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),

      // ✅ 其他超时相关配置
      refetchOnWindowFocus: false, // 窗口聚焦不自动重新请求
      refetchOnReconnect: true, // 网络重连后重新请求
    },
  },
})

export function createApp() {
  const app = createSSRApp(App)
  app.use(store)
  app.use(routeInterceptor)
  app.use(VueQueryPlugin, { queryClient })

  return {
    app,
  }
}
