package app.efir.android

import android.app.*
import android.content.Intent
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.os.*
import java.io.IOException
import java.util.concurrent.Executors

class ServerService : Service() {
    inner class LocalBinder : Binder() {
        val service
            get() = this@ServerService
    }

    private val binder = LocalBinder()
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var strings: Localization
    private lateinit var networking: NetworkAddresses
    private lateinit var bonjour: Bonjour
    private var server: LocalServer? = null
    private var starting = false
    private var generation = 0
    @Volatile private var destroyed = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private lateinit var wake: PowerManager.WakeLock
    var sharing = false
        private set

    var port = 0
        private set

    var error: String? = null
        private set

    var selected = ""
        private set

    val clients
        get() = server?.clientCount ?: 0

    private val renewWake =
        object : Runnable {
            override fun run() {
                if (sharing && (server?.externalCount ?: 0) > 0 && !destroyed) {
                    wake.acquire(65000)
                    main.postDelayed(this, 30000)
                } else if (wake.isHeld) wake.release()
            }
        }
    var onChanged: (() -> Unit)? = null

    fun addresses() = networking.json()

    fun origin() = "http://${selected.ifEmpty { "localhost" }}:$port"

    override fun onCreate() {
        super.onCreate()
        strings = Localization(this)
        networking = NetworkAddresses(this)
        bonjour = Bonjour(this) { _, _ -> }
        wake =
            getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Efir:relay")
                .apply { setReferenceCounted(false) }
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(
                NotificationChannel("efir-server", "Efir", NotificationManager.IMPORTANCE_LOW)
            )
        val callback =
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    main.post { updateNetwork() }
                }

                override fun onLost(network: Network) {
                    main.post { updateNetwork() }
                }

                override fun onLinkPropertiesChanged(network: Network, props: LinkProperties) {
                    main.post { updateNetwork() }
                }
            }
        networkCallback = callback
        getSystemService(ConnectivityManager::class.java)
            .registerNetworkCallback(android.net.NetworkRequest.Builder().build(), callback)
    }

    override fun onBind(intent: Intent) = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") {
            generation++
            starting = false
            server?.stop()
            server = null
            port = 0
            bonjour.unpublish()
            error = strings.t("Сервер остановлен")
            if (wake.isHeld) wake.release()
            sharing = false
            stopForeground(STOP_FOREGROUND_REMOVE)
            onChanged?.invoke()
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.hasExtra("sharing") == true) {
            val requested = intent.getBooleanExtra("sharing", false)
            if (requested != sharing) {
                generation++
                starting = false
                server?.stop()
                server = null
                port = 0
                bonjour.unpublish()
                main.removeCallbacks(renewWake)
                if (wake.isHeld) wake.release()
                if (sharing) stopForeground(STOP_FOREGROUND_REMOVE)
                sharing = requested
            }
            if (sharing) startForeground(1, notification())
        }
        startServer()
        return START_NOT_STICKY
    }

    fun startServer() {
        if (server != null || starting) return
        starting = true
        error = null
        val current = ++generation
        val share = sharing
        worker.execute {
            var result: LocalServer? = null
            try {
                for (candidate in 8765..8865) {
                    val next =
                        LocalServer(assets, if (share) "0.0.0.0" else "127.0.0.1", candidate) {
                            main.post { updateClients() }
                        }
                    try {
                        next.start(0, true)
                        result = next
                        break
                    } catch (e: IOException) {
                        next.stop()
                        if (e !is java.net.BindException && e.cause !is java.net.BindException)
                            throw e
                    }
                }
                if (result == null) throw IOException("Efir ports are busy")
                main.post {
                    if (destroyed || current != generation) result?.stop()
                    else {
                        server = result
                        port = result!!.listeningPort
                        starting = false
                        updateNetwork(true)
                        onChanged?.invoke()
                    }
                }
            } catch (e: Exception) {
                main.post {
                    if (current == generation && !destroyed) {
                        starting = false
                        error = e.localizedMessage ?: "Server error"
                        onChanged?.invoke()
                        if (sharing)
                            getSystemService(NotificationManager::class.java)
                                .notify(1, notification())
                    }
                }
            }
        }
    }

    fun selectAddress(ip: String) {
        if (networking.list().none { it.address == ip }) return
        selected = ip
        getSharedPreferences("efir", MODE_PRIVATE).edit().putString("address", ip).apply()
        publish()
        onChanged?.invoke()
    }

    fun language(code: String) {
        strings.setLanguage(code)
        if (sharing) getSystemService(NotificationManager::class.java).notify(1, notification())
    }

    private fun updateNetwork(force: Boolean = false) {
        val list = networking.list()
        val previous = selected
        if (selected.isEmpty())
            selected = getSharedPreferences("efir", MODE_PRIVATE).getString("address", "") ?: ""
        if (list.none { it.address == selected }) selected = list.firstOrNull()?.address ?: ""
        if (previous != selected || force) publish()
        onChanged?.invoke()
    }

    private fun publish() {
        if (sharing && port > 0) {
            bonjour.publish(port, networking.list().find { it.address == selected })
            getSystemService(NotificationManager::class.java).notify(1, notification())
        }
    }

    private fun updateClients() {
        // The Activity holds the screen; server CPU is held only for external clients.
        if (sharing && (server?.externalCount ?: 0) > 0) {
            if (!wake.isHeld) renewWake.run()
        } else {
            main.removeCallbacks(renewWake)
            if (wake.isHeld) wake.release()
        }
        if (sharing) getSystemService(NotificationManager::class.java).notify(1, notification())
        onChanged?.invoke()
    }

    private fun notification(): Notification {
        val open =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java).putExtra("resumeServer", true),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val stop =
            PendingIntent.getService(
                this,
                1,
                Intent(this, ServerService::class.java).setAction("stop"),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        return Notification.Builder(this, "efir-server")
            .setSmallIcon(R.drawable.ic_status)
            .setContentTitle(strings.t("Сервер Эфир работает"))
            .setContentText(
                error
                    ?: if (port == 0) strings.t("Запуск сервера…")
                    else
                        "${origin()} · ${strings.t("Устройств: {count}", mapOf("count" to (server?.externalCount ?: 0).toString()))}"
            )
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(
                Notification.Action.Builder(null, strings.t("Остановить сервер"), stop).build()
            )
            .build()
    }

    override fun onDestroy() {
        destroyed = true
        generation++
        main.removeCallbacks(renewWake)
        onChanged = null
        server?.stop()
        server = null
        worker.shutdownNow()
        bonjour.close()
        networkCallback?.let {
            getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it)
        }
        if (wake.isHeld) wake.release()
        super.onDestroy()
    }
}
