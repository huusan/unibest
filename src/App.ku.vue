<script setup lang="ts">
import tabbar from '@/tabbar/index.vue'
import { useManualTheme } from './hooks/useManualTheme'
import { isPageTabbar } from './tabbar/store'
  import { currRoute } from './utils'


const { themeVars, theme } = useManualTheme()

const isCurrentPageTabbar = ref(true)
onShow(() => {
  console.log('App.ku.vue onShow', currRoute())
  const { path } = currRoute()
  // “蜡笔小开心”提到本地是 '/pages/index/index'，线上是 '/' 导致线上 tabbar 不见了
  // 所以这里需要判断一下，如果是 '/' 就当做首页，也要显示 tabbar
  if (path === '/') {
    isCurrentPageTabbar.value = true
  }
  else {
    isCurrentPageTabbar.value = isPageTabbar(path)
  }
})

const helloKuRoot = ref('Hello AppKuVue')

const exposeRef = ref('this is form app.Ku.vue')

defineExpose({
  exposeRef,
})
</script>

<template>
  <wd-config-provider :theme-vars="themeVars" :theme="theme"
                      :custom-class="`page-wraper ${theme}`"
  >
    <KuRootView />

    <tabbar v-if="isCurrentPageTabbar" />
    <wd-notify />
    <wd-message-box />
    <wd-toast />
    <global-loading />
    <global-toast />
    <global-message />
    <!-- #ifdef MP-WEIXIN -->
    <!-- <privacy-popup /> -->
    <!-- #endif -->
  </wd-config-provider>
</template>
