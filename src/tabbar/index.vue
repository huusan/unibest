<script setup lang="ts">
import type { CustomTabBarItem } from './config'
import { computed } from 'vue'
import { useThemeStore } from '@/store/theme'
import { customTabbarEnable, needHideNativeTabbar, tabbarCacheEnable } from './config'
import { tabbarList, tabbarStore } from './store'

// #ifdef MP-WEIXIN
// 将自定义节点设置成虚拟的（去掉自定义组件包裹层），更加接近Vue组件的表现，能更好的使用flex属性
defineOptions({
  addGlobalClass: true,
  virtualHost: true,
  styleIsolation: 'shared',
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
// #ifndef MP-WEIXIN || MP-ALIPAY
// 因为有了 custom:true， 微信里面不需要多余的hide操作
onLoad(() => {
  // 解决原生 tabBar 未隐藏导致有2个 tabBar 的问题
  needHideNativeTabbar
  && uni.hideTabBar({
    fail(err) {
      console.log('hideTabBar fail: ', err)
    },
    success(res) {
      // console.log('hideTabBar success: ', res)
    },
  })
})
// #endif

// #ifdef MP-ALIPAY
onMounted(() => {
  // 解决支付宝自定义tabbar 未隐藏导致有2个 tabBar 的问题; 注意支付宝很特别，需要在 onMounted 钩子调用
  customTabbarEnable // 另外，支付宝里面，只要是 customTabbar 都需要隐藏
  && uni.hideTabBar({
    fail(err) {
      console.log('hideTabBar fail: ', err)
    },
    success(res) {
      // console.log('hideTabBar success: ', res)
    },
  })
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
      title: item.isBulge ? ' ' : item?.text,
      // title: item?.text,
      isDot: item.badge === 'dot',
      value: typeof item.badge === 'number' ? item.badge : null,
    }
  }
})
</script>

<template>
  <block v-if="customTabbarEnable">
    <wd-tabbar :model-value="tabbarStore.curIdx" bordered safe-area-inset-bottom placeholder fixed shape="round"
               @change="handleClick"
    >
      <block v-for="(item, idx) in tabbarList" :key="item.pagePath">
        <wd-tabbar-item v-if="item.iconType === 'uiLib'" :icon="item.icon" v-bind="itemProps(item)" :name="idx" />

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
  --bulge-offset: -0%; // 定义变量
  // 使用 transform 实现上浮效果，性能更好，且更灵活
  transform: translateY(var(--bulge-offset));

  // 尺寸和圆角
  width: 100rpx;
  height: 100rpx;
  border-radius: 50%;

  // 边框和阴影
  border: 2rpx solid #f0f0f0; // 给一个浅色边框，避免和背景融为一体
  box-shadow: 0 -4rpx 10rpx rgba(0, 0, 0, 0.05); // 阴影调整，更有立体感

  // 背景色使用主题色
  background-color: var(--wot-color-theme);
  // unocss/preset-icons 通过 color 控制图标颜色
  color: var(--wot-color-white);

  // flex 布局居中图标
  display: flex;
  justify-content: center;
  align-items: center;

  // 提高层级，避免被遮挡
  z-index: 2;

  // 增加过渡效果，让点击反馈更自然
  transition: transform 0.2s ease-in-out;

  // 向上移动后，通过负 margin-bottom 抵消原来占用的空间，让布局更紧凑
  margin-bottom: var(--bulge-offset);
}

.bulge-icon:active {
  transform: translateY(var(--bulge-offset)) scale(0.9); // 点击时缩小，增加交互感
}
</style>
