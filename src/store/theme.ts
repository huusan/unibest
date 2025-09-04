import type { ConfigProviderThemeVars } from 'wot-design-uni'
import { defineStore } from 'pinia'

export const useThemeStore = defineStore(
  'theme-store',
  () => {
    /** 主题 */
    const theme = ref<'light' | 'dark'>('light')
    const colorTheme = ref('#36c598')

    /** 主题变量 */
    const themeVars = ref<ConfigProviderThemeVars>({
      colorTheme: colorTheme.value,
      tabbarActiveColor: colorTheme.value,
      tabbarInactiveColor: '#999',
      tabbarItemIconSize: '24px',
      tabbarItemTitleFontSize: '10px',
    })

    /** 设置主题变量 */
    const setThemeVars = (partialVars: Partial<ConfigProviderThemeVars>) => {
      themeVars.value = { ...themeVars.value, ...partialVars }
    }

    /** 设置主题色 */
    const setColorTheme = (color: string) => {
      colorTheme.value = color
    }

    watch(colorTheme, (newVal) => {
      themeVars.value.colorTheme = newVal
      themeVars.value.tabbarActiveColor = newVal
    })

    /** 切换主题 */
    const toggleTheme = () => {
      theme.value = theme.value === 'light' ? 'dark' : 'light'
    }

    return {
      /** 设置主题变量 */
      setThemeVars,
      /** 切换主题 */
      toggleTheme,
      /** 主题变量 */
      themeVars,
      /** 主题 */
      theme,
      /** 设置主题色 */
      setColorTheme,
    }
  },
  {
    persist: true,
  },
)
