import type { IncomingMessage, ServerResponse } from 'node:http'

export function handleActRequest(req: IncomingMessage, res: ServerResponse): boolean
