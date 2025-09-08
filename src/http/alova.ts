import type { uniappRequestAdapter } from '@alova/adapter-uniapp'
import type { IResponse } from './types'
import AdapterUniapp from '@alova/adapter-uniapp'
import { createAlova } from 'alova'
import { createServerTokenAuthentication } from 'alova/client'
import VueHook from 'alova/vue'
import { LOGIN_PAGE } from '@/router/config'
import { useTokenStore } from '@/store'
import { ResultEnum, ShowMessage } from './tools/enum'

// 配置动态Tag
export const API_DOMAINS = {
  DEFAULT: import.meta.env.VITE_SERVER_BASEURL,
  SECONDARY: import.meta.env.VITE_API_SECONDARY_URL,
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
      if (method.meta?.authRole === 'refreshToken') {
        return false
      }
      return error.response?.status === ResultEnum.Unauthorized
    },
    handler: async () => {
      try {
        const tokenStore = useTokenStore()
        await tokenStore.refreshToken()
      }
      catch (error) {
        // 切换到登录页
        uni.reLaunch({ url: LOGIN_PAGE })
        // 并抛出错误
        throw error
      }
    },
  },
})

/**
 * alova 请求实例
 */
const alovaInstance = createAlova({
  baseURL: import.meta.env.VITE_APP_PROXY_PREFIX,
  ...AdapterUniapp(),
  timeout: 5000,
  statesHook: VueHook,

  beforeRequest: onAuthRequired(async (method) => {
    // 设置默认 Content-Type
    // method.config.headers = {
    //   ContentType: ContentTypeEnum.JSON,
    //   Accept: 'application/json, text/plain, */*',
    //   ...method.config.headers,
    // }

    const { config } = method

    // 处理动态域名
    if (config.meta?.domain) {
      method.baseURL = config.meta.domain
      console.log('当前域名', method.baseURL)
    }
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
    if (code !== ResultEnum.Success) {
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
