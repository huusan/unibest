<script lang="ts" setup>
import { useTokenStore } from '@/store/token'
import { useUserStore } from '@/store/user'
import { tabbarList } from '@/tabbar/config'
import { isPageTabbar } from '@/tabbar/store'
import { ensureDecodeURIComponent } from '@/utils'
import { parseUrlToObj } from '@/utils/index'

definePage({
  style: {
    navigationBarTitleText: '登录',
  },
})

const redirectUrl = ref('')
onShow(() => {
  // onShow 比 onLoad 更适合处理登录页的跳转逻辑
  // 因为 onShow 每次页面显示都会执行，而 onLoad 只执行一次
  // 这样能保证每次进入登录页都能正确处理跳转
  const pages = getCurrentPages()
  const currentPage = pages[pages.length - 1] as any
  const options = currentPage.options
  console.log('login options: ', options)
  if (options.redirect)
    redirectUrl.value = ensureDecodeURIComponent(options.redirect)
  else
    redirectUrl.value = tabbarList[0].pagePath

  console.log('redirectUrl.value: ', redirectUrl.value)
})

const userStore = useUserStore()
const tokenStore = useTokenStore()
async function doLogin() {
  if (tokenStore.hasLogin) {
    uni.navigateBack()
    return
  }
  try {
    // 调用登录接口
    await tokenStore.login({
      username: '菲鸽',
      password: '123456',
    })
    console.log(redirectUrl.value)
  }
  catch (error) {
    console.log('登录失败', error)
  }
  let path = redirectUrl.value
  if (!path.startsWith('/')) {
    path = `/${path}`
  }
  const { path: _path, query } = parseUrlToObj(path)
  console.log('_path:', _path, 'query:', query, 'path:', path)
  console.log('isPageTabbar(_path):', isPageTabbar(_path))
  if (isPageTabbar(_path)) {
    // 经过我的测试 switchTab 不能带 query 参数, 不管是放到 url  还是放到 query ,
    // 最后跳转过去的时候都会丢失 query 信息
    uni.switchTab({
      url: path,
    })
    // uni.switchTab({
    //   url: _path,
    //   query,
    // })
  }
  else {
    // 自己决定是 redirectTo 还是 navigateBack
    // uni.redirectTo({
    //   url: path,
    // })
    uni.navigateBack()
  }
}
</script>

<template>
  <view class="login">
    <!-- 本页面是非MP的登录页，主要用于 h5 和 APP -->
    <view class="text-center">
      登录页
    </view>
    <button class="mt-4 w-40 text-center" @click="doLogin">
      点击模拟登录
    </button>
  </view>
</template>

<style lang="scss" scoped>
  //
</style>
