<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app'
import { isMp } from '@uni-helper/uni-env'
import { navigateToInterceptor } from '@/router/interceptor'
import { LOGIN_PAGE_ENABLE_IN_MP } from './router/config'
import { useTokenStore } from './store'

onLaunch(async (options) => {
  console.log('App Launch', options)
  if (isMp && !LOGIN_PAGE_ENABLE_IN_MP) {
    const tokenStore = useTokenStore()
    if (!tokenStore.hasLogin) {
      await tokenStore.wxLogin()
    }
  }
})

onShow((options) => {
  console.log('App Show', options)
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
