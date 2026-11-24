package app.efir.android

import android.content.res.AssetManager
import android.os.SystemClock
import fi.iki.elonen.NanoWSD
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

// Serve files and relay unchanged packets; do not interpret roles or scripts.
class LocalServer(
    private val assets: AssetManager,
    address: String,
    port: Int,
    private val changed: (Int) -> Unit,
) : NanoWSD(address, port) {
    private val clients = ConcurrentHashMap.newKeySet<Client>()
    private val lifecycle = Any()
    private var stopping = false
    private var watchdog: ScheduledFuture<*>? = null
    private val deadline =
        ScheduledThreadPoolExecutor(1) { task ->
            Thread(task, "Efir socket deadline").apply { isDaemon = true }
        }
    val clientCount
        get() = clients.size

    val externalCount
        get() = clients.count { !it.local }

    private fun admit(client: Client): Boolean = synchronized(lifecycle) {
        if (stopping || clients.size >= 32) return@synchronized false
        clients.add(client)
        if (watchdog == null) {
            watchdog = deadline.scheduleWithFixedDelay(
                {
                    val now = SystemClock.elapsedRealtime()
                    clients.forEach { if (it.expired(now)) it.terminate() }
                },
                1,
                1,
                TimeUnit.SECONDS,
            )
        }
        true
    }

    private fun remove(client: Client): Boolean = synchronized(lifecycle) {
        val removed = clients.remove(client)
        if (clients.isEmpty()) {
            watchdog?.cancel(false)
            watchdog = null
        }
        removed
    }

    override fun openWebSocket(session: IHTTPSession): WebSocket = Client(session)

    override fun serve(session: IHTTPSession): Response {
        if (session.headers["upgrade"]?.equals("websocket", true) == true && session.uri != "/ws")
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "")
        return super.serve(session)
    }

    override fun serveHttp(session: IHTTPSession): Response {
        if (session.method != Method.GET && session.method != Method.HEAD)
            return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "")
        if (session.uri == "/efir-local.json") {
            val data =
                JSONObject()
                    .put("local", true)
                    .put("version", BuildConfig.VERSION_NAME)
                    .put("hostName", "Android")
                    .put("platform", "android")
                    .toString()
                    .toByteArray()
            return response(
                Response.Status.OK,
                "application/json",
                data.size.toLong(),
                ByteArrayInputStream(data),
                "no-store",
            )
        }
        val path = session.uri.removePrefix("/").ifEmpty { "index.html" }
        if (path.split('/').any { it.startsWith('.') || '\\' in it || '\u0000' in it })
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "")
        val input =
            try {
                assets.open("web/$path")
            } catch (_: IOException) {
                return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "")
            }
        val size = input.available().toLong()
        val etag = "W/\"${BuildConfig.VERSION_CODE}-${path.hashCode()}-$size\""
        val ext = path.substringAfterLast('.', "")
        val mime =
            when (ext) {
                "html" -> "text/html; charset=utf-8"
                "js" -> "text/javascript; charset=utf-8"
                "css" -> "text/css; charset=utf-8"
                "json" -> "application/json"
                "webmanifest" -> "application/manifest+json"
                "svg" -> "image/svg+xml"
                "png" -> "image/png"
                "woff2" -> "font/woff2"
                "mp4" -> "video/mp4"
                "webm" -> "video/webm"
                else -> "application/octet-stream"
            }
        val cache = if (ext == "woff2") "public, max-age=31536000, immutable" else "no-cache"
        if (
            session.headers["if-none-match"]?.split(',')?.any {
                it.trim() == etag || it.trim() == "*"
            } == true
        ) {
            input.close()
            return newFixedLengthResponse(Response.Status.NOT_MODIFIED, mime, "").apply {
                addHeader("ETag", etag)
                addHeader("Cache-Control", cache)
            }
        }
        var start = 0L
        var end = size - 1
        var partial = false
        session.headers["range"]?.takeIf { it.startsWith("bytes=") }?.removePrefix("bytes=")?.let { range ->
            val split = range.split('-', limit = 2)
            if (split.size != 2) start = Long.MAX_VALUE
            else {
                start =
                    if (split[0].isEmpty()) size - (split[1].toLongOrNull() ?: 0).coerceAtMost(size)
                    else split[0].toLongOrNull() ?: Long.MAX_VALUE
                if (split[0].isNotEmpty() && split[1].isNotEmpty())
                    end = (split[1].toLongOrNull() ?: -1).coerceAtMost(end)
            }
            partial = true
        }
        if (partial && (size == 0L || start < 0 || start > end)) {
            input.close()
            return newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, mime, "").apply {
                addHeader("Content-Range", "bytes */$size")
            }
        }
        if (start > 0) {
            var remaining = start
            while (remaining > 0) {
                val skipped = input.skip(remaining)
                if (skipped <= 0) {
                    input.close()
                    return newFixedLengthResponse(Response.Status.NOT_FOUND, mime, "")
                }
                remaining -= skipped
            }
        }
        val length = if (size == 0L) 0 else end - start + 1
        return response(
                if (partial) Response.Status.PARTIAL_CONTENT else Response.Status.OK,
                mime,
                length,
                input,
                cache,
            )
            .apply {
                addHeader("ETag", etag)
                addHeader("Accept-Ranges", "bytes")
                if (partial) addHeader("Content-Range", "bytes $start-$end/$size")
            }
    }

    private fun response(
        status: Response.IStatus,
        mime: String,
        size: Long,
        input: java.io.InputStream,
        cache: String,
    ) =
        newFixedLengthResponse(status, mime, input, size).apply {
            addHeader("Cache-Control", cache)
            addHeader("X-Content-Type-Options", "nosniff")
            addHeader("Referrer-Policy", "no-referrer")
        }

    private inner class Client(session: IHTTPSession) : WebSocket(session) {
        val local = session.remoteIpAddress in listOf("127.0.0.1", "::1")
        @Volatile private var receivedAt = SystemClock.elapsedRealtime()
        @Volatile private var writeStartedAt = 0L
        private val pending = ArrayBlockingQueue<WebSocketFrame>(64)
        private val queued = AtomicLong()
        @Volatile private var writer: Thread? = null

        override fun onOpen() {
            val worker = Thread(
                {
                    try {
                        while (isOpen) {
                            val frame = pending.take()
                            queued.addAndGet(-frame.binaryPayload.size.toLong())
                            sendFrame(frame)
                        }
                    } catch (_: InterruptedException) {
                    } catch (_: IOException) {
                        terminate()
                    }
                },
                "Efir relay",
            ).apply { isDaemon = true }
            writer = worker
            if (!admit(this)) {
                terminate()
                return
            }
            changed(clients.size)
            worker.start()
        }

        fun expired(now: Long): Boolean {
            val started = writeStartedAt
            return now - receivedAt > 45_000 || (started != 0L && now - started > 5_000)
        }

        override fun writeFrame(frame: WebSocketFrame) {
            writeStartedAt = SystemClock.elapsedRealtime()
            try {
                super.writeFrame(frame)
            } finally {
                writeStartedAt = 0L
            }
        }

        fun enqueue(frame: WebSocketFrame) {
            if (!isOpen) return
            if (
                queued.addAndGet(frame.binaryPayload.size.toLong()) > 4 * 1024 * 1024 ||
                    !pending.offer(frame)
            )
                terminate()
        }

        override fun debugFrameReceived(frame: WebSocketFrame) {
            receivedAt = SystemClock.elapsedRealtime()
        }

        override fun onMessage(message: WebSocketFrame) {
            if (
                message.opCode == WebSocketFrame.OpCode.Text &&
                    message.textPayload.contains("__efir_ping")
            ) {
                val ping = runCatching { JSONObject(message.textPayload) }.getOrNull()
                if (
                    ping?.optString("t") == "__efir_ping" &&
                        !ping.has("from") &&
                        ping.opt("ts") is Number
                ) {
                    enqueue(
                        WebSocketFrame(
                            WebSocketFrame.OpCode.Text,
                            true,
                            JSONObject()
                                .put("t", "__efir_pong")
                                .put("ts", ping.get("ts"))
                                .toString(),
                        )
                    )
                    return
                }
            }
            for (client in clients) if (client !== this)
                client.enqueue(WebSocketFrame(message.opCode, true, message.binaryPayload))
        }

        override fun onPing(frame: WebSocketFrame) {
            enqueue(WebSocketFrame(WebSocketFrame.OpCode.Pong, true, frame.binaryPayload))
        }

        override fun onPong(pong: WebSocketFrame) {}

        override fun onException(exception: IOException) {
            terminate()
        }

        override fun onClose(
            code: WebSocketFrame.CloseCode,
            reason: String,
            initiatedByRemote: Boolean,
        ) {
            writer?.interrupt()
            pending.clear()
            if (remove(this)) changed(clients.size)
        }
    }

    override fun stop() {
        synchronized(lifecycle) { stopping = true }
        clients.toList().forEach { it.terminate() }
        deadline.shutdownNow()
        super.stop()
    }
}
