package app.efir.android

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.IBinder
import androidx.test.runner.AndroidJUnitRunner
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

// Launch the Android server for the shared tests/relay.mjs contract.
class EfirTestRunner : AndroidJUnitRunner() {
    private var fixture = false

    override fun onCreate(arguments: Bundle?) {
        fixture = arguments?.getString("efirServerFixture") == "true"
        super.onCreate(arguments)
    }

    override fun onStart() {
        if (!fixture) {
            super.onStart()
            return
        }
        // Start the same sharing service as the Activity without opening a
        // controller that can leave WebSocket traffic in the test session.
        val context = targetContext
        val intent = Intent(context, ServerService::class.java).putExtra("sharing", true)
        val ready = CompletableFuture<Int>()
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, binder: IBinder) {
                val service = (binder as ServerService.LocalBinder).service
                fun checkServer() {
                    val error = service.error
                    if (error != null) ready.completeExceptionally(IllegalStateException(error))
                    else if (service.sharing && service.port > 0) ready.complete(service.port)
                }
                service.onChanged = ::checkServer
                checkServer()
            }

            override fun onServiceDisconnected(name: ComponentName) {
                ready.completeExceptionally(IllegalStateException("Android server disconnected"))
            }
        }
        context.startForegroundService(intent)
        try {
            check(context.bindService(intent, connection, Context.BIND_AUTO_CREATE))
            try {
                val port = ready.get(15, TimeUnit.SECONDS)
                sendStatus(1, Bundle().apply { putString("efirUrl", "http://localhost:$port") })
                Thread.sleep(180_000)
            } finally {
                context.unbindService(connection)
            }
        } finally {
            context.stopService(intent)
        }
        finish(android.app.Activity.RESULT_OK, Bundle())
    }
}
