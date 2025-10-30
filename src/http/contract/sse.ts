import { eventIterator, oc } from '@orpc/contract'
import * as z from 'zod'

export const sse = oc
  // .route({
  //   method: 'GET',
  //   path: '/sse',
  //   tags: ['SSE'],
  //   summary: 'Server-Sent Events',
  // })
  .output(eventIterator(z.object({ time: z.date() })))
  // .input(z.object({ id: z.number() }))

export const list = oc
  .input(z.object({ text: z.string().min(1) }))
  .output(z.object({ id: z.number().int(), text: z.string() }))
