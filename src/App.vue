<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app'
import { focusManager, onlineManager } from '@tanstack/vue-query'
import { navigateToInterceptor } from '@/router/interceptor'
import 'abortcontroller-polyfill/dist/abortcontroller-polyfill-only'

uni.getNetworkType({
  success: ({ networkType }) => {
    onlineManager.setOnline(networkType !== 'none')
  },
})
uni.onNetworkStatusChange(({ isConnected, networkType }) => {
  // 优先使用 isConnected 判断网络状态
  // 回退到 networkType 判断
  onlineManager.setOnline(
    isConnected != null ? isConnected : networkType !== 'none',
  )
})

onLaunch(async (options) => {
  console.log('App Launch', options)
  // if (isMp && !LOGIN_PAGE_ENABLE_IN_MP) {
  // const tokenStore = useTokenStore()
  // if (!tokenStore.hasLogin) {
  //   console.log('用户未登录，进行登录操作');
  //   await tokenStore.wxLogin()
  // }
  // }
})

onShow((options) => {
  console.log('App Show', options)
  focusManager.setFocused(true)
  // 处理直接进入页面路由的情况：如h5直接输入路由、微信小程序分享后进入等
  // https://github.com/unibest-tech/unibest/issues/192
  if (options?.path) {
    navigateToInterceptor.invoke({ url: `/${options.path}`, query: options.query })
  }
  else {
    navigateToInterceptor.invoke({ url: '/' })
  }
})
onHide(() => {
  console.log('App Hide')
  focusManager.setFocused(false)
})
</script>

<style lang="scss">
swiper,
scroll-view {
  flex: 1;
  height: 100%;
  overflow: hidden;
}

image {
  width: 100%;
  height: 100%;
  vertical-align: middle;
}

.page-wraper {
  min-height: calc(100vh - var(--window-top));
  box-sizing: border-box;
  // 解决下级子元素marginTop导致的页面空白；
  overflow: auto;
  background: var(--wot-color-bg);
}

.wot-theme-dark.page-wraper {
  background: var(--wot-dark-background2);
}
</style>
