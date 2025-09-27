import type { uniappRequestAdapter } from '@alova/adapter-uniapp'
import type { IResponse } from './types'
import AdapterUniapp from '@alova/adapter-uniapp'
import { isMp } from '@uni-helper/uni-env'
import { createAlova } from 'alova'
import { createServerTokenAuthentication } from 'alova/client'
import VueHook from 'alova/vue'
import { LOGIN_PAGE, LOGIN_PAGE_ENABLE_IN_MP } from '@/router/config'
import { useTokenStore } from '@/store'
import { ContentTypeEnum, ResultEnum, ShowMessage } from './tools/enum'

// 配置动态Tag
export const API_DOMAINS = {
  DEFAULT: import.meta.env.VITE_SERVER_BASEURL,
  SECONDARY: import.meta.env.VITE_SERVER_BASEURL_SECONDARY,
}

/**
 * 创建请求实例
 */
const { onAuthRequired, onResponseRefreshToken } = createServerTokenAuthentication<
  typeof VueHook,
  typeof uniappRequestAdapter
>({
  // 放行访客请求
  // export const requestTokenNotRequired = () => {
  //   const method = alovaInstance.Get('/token_not_required');
  //   method.meta = {
  //     authRole: null
  //   };
  //   return method;
  // };
  assignToken: (method) => {
    const tokenStore = useTokenStore()
    const token = tokenStore.validToken
    method.config.headers.Authorization = `Bearer ${token}`
  },

  refreshTokenOnError: {
    isExpired: (error, method) => {
      return error.response?.status === ResultEnum.Unauthorized
    },
    handler: async () => {
      try {
        if (import.meta.env.VITE_AUTH_MODE !== 'double') {
          const tokenStore = useTokenStore()
          await tokenStore.wxLogin()
        }
        else {
          const tokenStore = useTokenStore()
          await tokenStore.refreshToken()
        }
      }
      catch (error) {
        if (isMp && !LOGIN_PAGE_ENABLE_IN_MP) {
          const tokenStore = useTokenStore()
          await tokenStore.wxLogin()
        }
        else {
          // 切换到登录页
          uni.reLaunch({ url: LOGIN_PAGE })
          // 并抛出错误
          throw error
        }
      }
    },
  },
})

/**
 * alova 请求实例
 */
const alovaInstance = createAlova({
  baseURL: API_DOMAINS.DEFAULT,
  ...AdapterUniapp(),
  timeout: 5000,
  statesHook: VueHook,

  beforeRequest: onAuthRequired(async (method) => {
    // 设置默认 Content-Type
    method.config.headers = {
      ContentType: ContentTypeEnum.JSON,
      Accept: 'application/json, text/plain, */*',
      ...method.config.headers,
    }

    const { config } = method

    // 处理动态域名
    if (config.meta?.domain) {
      method.baseURL = config.meta.domain
      console.log('当前域名', method.baseURL)
    }
    console.log('请求地址:', method) // 打印请求地址
  }),

  responded: onResponseRefreshToken((response, method) => {
    const { config } = method
    const { requestType } = config
    const {
      statusCode,
      data: rawData,
      errMsg,
    } = response as UniNamespace.RequestSuccessCallbackResult

    // 处理特殊请求类型（上传/下载）
    if (requestType === 'upload' || requestType === 'download') {
      return response
    }

    // 处理 HTTP 状态码错误
    if (statusCode !== 200) {
      const errorMessage = ShowMessage(statusCode) || `HTTP请求错误[${statusCode}]`
      console.error('errorMessage===>', errorMessage)
      uni.showToast({
        title: errorMessage,
        icon: 'error',
      })
      throw new Error(`${errorMessage}：${errMsg}`)
    }

    // 处理业务逻辑错误
    const { code, message, data } = rawData as IResponse
    // 0和200当做成功都很普遍，这里直接兼容两者，见 ResultEnum
    if (code !== ResultEnum.Success0 && code !== ResultEnum.Success200) {
      if (config.meta?.toast !== false) {
        uni.showToast({
          title: message,
          icon: 'none',
        })
      }
      throw new Error(`请求错误[${code}]：${message}`)
    }
    // 处理成功响应，返回业务数据
    return data
  }),
})

export const http = alovaInstance
