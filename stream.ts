import { key, cert } from '../dev/certs/src/index.ts'

const writer = createWriter({
    onStart: (message) => console.log('onStart', message),
    onChunk: (message) => console.log('onChunk', message),
    onError: (message) => console.log('onError', message),
    onAbort: (message) => console.log('onAbort', message),
    onClose: (message) => console.log('onClose', message),
    onMessage: (message) => console.log('onMessage', message),
})

const server = Bun.serve({
    port: 3000,
    tls: {
        key, cert
    },
    fetch(request) {

        request.body?.pipeThrough(new TextDecoderStream())
            .pipeTo(writer.writable)

        let controller: ReadableStreamDefaultController<string>;
        return new Response(new ReadableStream({
            start(_controller) {
                controller = _controller
                send(controller, 'Hello World from server')
                setInterval(() => send(controller, { from: 'server', now: Date.now() }), 1000)
            }
        }).pipeThrough(new TextEncoderStream()), {
            headers: {
                'Content-Type': 'event/stream'
            }
        })
    }
})

function send(controller: ReadableStreamDefaultController, data: any) {
    controller.enqueue(JSON.stringify({
        id: 0,
        data: data || null,
        event: 'message',
    } as Message) + '\n\n');
}

const response = await Bun.fetch(server.url, {
    method: 'POST',
    body: new ReadableStream({
        start(controller) {
            send(controller, 'Hello World from client')
            setInterval(() => send(controller, { from: 'client', now: Date.now() }), 1000)
        }
    })
})


response.body
    ?.pipeThrough(new TextDecoderStream())
    .pipeTo(writer.writable)



/// lib

type Event = 'init' | 'start' | 'chunk' | 'close' | 'abort' | 'error' | 'message'
type Message<T = any> = {
    id: number,
    event: Event,
    line?: string,
    data?: T,
    error?: Error,
    reason?: any
}
type Instance = {
    idx: number
    status: Event
    chunks: string,
    messages: Message[]
    controller?: WritableStreamDefaultController
}
type EventListener = (message: Message, instance: Instance) => void | Promise<void>
type EventListeners = {
    onEvent?: EventListener
    onError?: EventListener
    onStart?: EventListener
    onClose?: EventListener
    onAbort?: EventListener
    onChunk?: EventListener
    onMessage?: EventListener
}

function createWriter({
    onEvent,
    onStart,
    onError,
    onClose,
    onAbort,
    onChunk,
    onMessage
}: EventListeners = {}): { readonly writable: WritableStream<string>; } {
    async function parseMessage(instance: Instance) {
        if (!instance.chunks.endsWith('\n\n'))
            return

        const lines = instance.chunks.split('\n\n')
        const result: Message[] = []

        for (const line of lines) {
            if (line) {
                try {
                    const parsedMessage = JSON.parse(line) as Partial<Message>

                    instance.status = 'message'
                    const message: Message = {
                        ...parsedMessage,
                        id: instance.messages.length,
                        event: instance.status,
                        line
                    }

                    instance.messages.push(message)
                    result.push(message)
                    await onEvent?.(message, instance)
                    await onMessage?.(message, instance)

                } catch (error: any) {
                    instance.status = 'error'
                    const message: Message = {
                        id: instance.messages.length,
                        event: instance.status,
                        error,
                        line
                    }

                    instance.messages.push(message)
                    result.push(message)
                    await onEvent?.(message, instance)
                    await onError?.(message, instance)
                }
            }
        }

        instance.chunks = ''

        return result
    }

    let idx = 0

    return {
        get writable() {
            const instance: Instance = {
                idx: idx++,
                status: 'init',
                chunks: `\n\n`,
                messages: [],
            }

            return new WritableStream<string>({
                async start(controller) {
                    instance.status = 'start'
                    instance.controller = controller
                    const message: Message = {
                        id: instance.messages.length,
                        event: instance.status
                    }
                    instance.messages.push(message)
                    await onEvent?.(message, instance)
                    await onStart?.(message, instance)
                },
                async write(chunk) {
                    instance.status = 'chunk'
                    instance.chunks += chunk
                    const message: Message = {
                        id: instance.messages.length,
                        event: instance.status,
                        data: chunk
                    }
                    instance.messages.push(message)
                    await onEvent?.(message, instance)
                    await onChunk?.(message, instance)

                    await parseMessage(instance)
                },
                async close() {
                    instance.status = 'close'
                    await parseMessage(instance)
                    const message: Message = {
                        id: instance.messages.length,
                        event: instance.status
                    }
                    instance.messages.push(message)
                    await onEvent?.(message, instance)
                    await onClose?.(message, instance)

                },
                async abort(reason: any) {
                    instance.status = 'abort'
                    const message: Message = {
                        id: instance.messages.length,
                        event: instance.status,
                        reason
                    }
                    instance.messages.push(message)
                    await onEvent?.(message, instance)
                    await onAbort?.(message, instance)
                    instance.chunks = ''
                }
            })
        }
    }

}
