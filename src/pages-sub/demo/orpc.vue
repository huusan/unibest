<script lang="ts" setup>
import { useQuery } from '@tanstack/vue-query'
import { orpc, testStream } from '@/lib/orpc'

defineOptions({
  addGlobalClass: true,
  virtualHost: true,
  styleIsolation: 'shared',
})
definePage({
  style: {
    navigationStyle: 'default',
    navigationBarTitleText: 'ORPC',
  },
})

const { data, isLoading, error } = useQuery(orpc.todo.list.queryOptions({
  input: { text: '10' },
}))
console.log('query', data.value)
console.log('query', isLoading.value)
console.log('query', error.value)

testStream().catch(console.error)

const { data: exampleData, isLoading: exampleIsLoading, error: exampleError } = useQuery(orpc.sse.experimental_streamedOptions({ context: { sse: true } }))
console.log(
  exampleData.value,
  exampleIsLoading.value,
  exampleError.value,
)
</script>

<template>
  <div>
    <div v-if="isLoading">
      加载中...
    </div>
    <div v-else-if="error">
      错误: {{ error.message }}
    </div>
    <div v-else>
      <view style="word-break: break-all;" selectable>
        结果: {{ JSON.stringify(data, null, 2) }}
      </view>
    </div>
  </div>

  <div>
    <div v-if="exampleIsLoading">
      加载中...
    </div>
    <div v-else-if="exampleError">
      错误: {{ exampleError.message }}
    </div>
    <div v-else>
      <view style="word-break: break-all;" selectable>
        结果: {{ JSON.stringify(exampleData, null, 2) }}
      </view>
    </div>
  </div>
</template>
