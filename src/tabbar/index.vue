<script setup lang="ts">
// i-carbon-code
import type { CustomTabBarItem } from './config'
import { computed } from 'vue'
import { useThemeStore } from '@/store/theme'
import { customTabbarEnable, needHideNativeTabbar, tabbarCacheEnable } from './config'
import { tabbarList, tabbarStore } from './store'

// #ifdef MP-WEIXIN
// 将自定义节点设置成虚拟的（去掉自定义组件包裹层），更加接近Vue组件的表现，能更好的使用flex属性
defineOptions({
  virtualHost: true,
})

const themeStore = useThemeStore()

// #endif

/**
 * 中间的鼓包tabbarItem的点击事件
 */
function handleClickBulge() {
  uni.showToast({
    title: '点击了中间的鼓包tabbarItem',
    icon: 'none',
  })
}

function handleClick(value: { value: number }) {
  const index = value.value
  // 点击原来的不做操作
  if (index === tabbarStore.curIdx) {
    return
  }
  const item = tabbarList[index]
  if (item?.isBulge) {
    handleClickBulge()
    return
  }
  const url = item.pagePath
  tabbarStore.setCurIdx(index)
  const action = tabbarCacheEnable ? uni.switchTab : uni.navigateTo
  action({ url })
}
// #ifndef MP-WEIXIN
// 因为有了 custom:true， 微信里面不需要多余的hide操作
onLoad(() => {
  // 解决原生 tabBar 未隐藏导致有2个 tabBar 的问题
  if (needHideNativeTabbar) {
    uni.hideTabBar({
      fail: (err) => {
        console.log('hideTabBar fail: ', err)
      },
    })
  }
})
// #endif



function getImageByIndex(index: number, item: CustomTabBarItem) {
  if (!item.iconActive) {
    console.warn('image 模式下，需要配置 iconActive (高亮时的图片)，否则无法切换高亮图片')
    return item.icon
  }
  return tabbarStore.curIdx === index ? item.iconActive : item.icon
}

const itemProps = computed(() => {
  return (item: CustomTabBarItem) => {
    return {
      title: item?.isBulge ? '' : item.text,
      isDot: item.badge === 'dot',
      value: typeof item.badge === 'number' ? item.badge : null,
    }
  }
})
</script>

<template>
  <block v-if="customTabbarEnable">
    <wd-tabbar :model-value="tabbarStore.curIdx" :bordered="true" :safe-area-inset-bottom="true" :placeholder="true"
               :fixed="true" @change="handleClick"
    >
      <block v-for="(item, idx) in tabbarList" :key="item.pagePath">
        <wd-tabbar-item v-if="item.iconType === 'uiLib'" :icon="item.icon" v-bind="itemProps(item)"
                        :name="idx"
        />

        <wd-tabbar-item v-else-if="['unocss', 'iconfont'].includes(item.iconType)" v-bind="itemProps(item)"
                        :name="idx"
        >
          <template #icon>
            <view class="h-50rpx w-50rpx"
                  :class="[item.icon, { 'is-active': idx === tabbarStore.curIdx, 'is-inactive': idx !== tabbarStore.curIdx }, { 'bulge-icon': item?.isBulge }]"
            />
          </template>
        </wd-tabbar-item>
        <wd-tabbar-item v-else-if="item.iconType === 'image'" v-bind="itemProps(item)" :name="idx">
          <template #icon>
            <image :src="getImageByIndex(idx, item)" h-64rpx w-64rpx />
          </template>
        </wd-tabbar-item>
      </block>
    </wd-tabbar>
  </block>
</template>

<style scoped lang="scss">
  .bulge-icon {
  position: relative;
  top: -40rpx;
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  border: 2rpx solid var(--wot-tabbar-active-color);
  box-shadow: 0 0 10rpx rgba(0, 0, 0, 0.1);
  background-color: var(--wot-tabbar-active-color);

  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
}
</style>
