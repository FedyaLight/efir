package app.efir.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.net.Inet4Address
import java.net.InetAddress
import java.util.ArrayDeque
import org.json.JSONArray
import org.json.JSONObject

data class LanAddress(val name: String, val address: String, val network: Network)

fun isLanAddress(ip: InetAddress): Boolean =
    ip is Inet4Address && ip.isSiteLocalAddress && !ip.isLoopbackAddress

class NetworkAddresses(context: Context) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)

    fun list(): List<LanAddress> =
        connectivity.allNetworks
            .flatMap { network ->
                val caps =
                    connectivity.getNetworkCapabilities(network) ?: return@flatMap emptyList()
                if (
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ||
                        (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                            !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
                )
                    return@flatMap emptyList()
                val links = connectivity.getLinkProperties(network) ?: return@flatMap emptyList()
                val label =
                    links.interfaceName
                        ?: if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) "Wi-Fi"
                        else "Ethernet"
                links.linkAddresses
                    .filter { isLanAddress(it.address) }
                    .map { LanAddress(label, it.address.hostAddress!!, network) }
            }
            .distinctBy { it.address }
            .sortedBy { it.name }

    fun json(): JSONArray =
        JSONArray().apply {
            list().forEach { put(JSONObject().put("name", it.name).put("address", it.address)) }
        }
}

// Use Bonjour only during discovery or active hosting.
class Bonjour(context: Context, private val found: (String, String?) -> Unit) {
    private val manager = context.getSystemService(NsdManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var registration: NsdManager.RegistrationListener? = null
    private var discovery: NsdManager.DiscoveryListener? = null
    private val pending = ArrayDeque<NsdServiceInfo>()
    private var resolving = false
    private var generation = 0

    fun publish(port: Int, address: LanAddress?) {
        unpublish()
        if (address == null) return
        val info =
            NsdServiceInfo().apply {
                serviceName = "Efir ${Build.MODEL} $port"
                serviceType = "_efir._tcp."
                setPort(port)
                setAttribute("version", BuildConfig.VERSION_NAME)
                if (Build.VERSION.SDK_INT >= 33) network = address.network
            }
        val listener =
            object : NsdManager.RegistrationListener {
                override fun onServiceRegistered(service: NsdServiceInfo) {}

                override fun onRegistrationFailed(service: NsdServiceInfo, code: Int) {
                    if (registration === this) registration = null
                }

                override fun onServiceUnregistered(service: NsdServiceInfo) {}

                override fun onUnregistrationFailed(service: NsdServiceInfo, code: Int) {}
            }
        registration = listener
        runCatching { manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener) }
            .onFailure { registration = null }
    }

    fun unpublish() {
        registration?.let { runCatching { manager.unregisterService(it) } }
        registration = null
    }

    fun discover() {
        if (discovery != null) return
        val listener =
            object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(type: String) {}

                override fun onStartDiscoveryFailed(type: String, code: Int) {
                    stopDiscovery()
                }

                override fun onStopDiscoveryFailed(type: String, code: Int) {}

                override fun onDiscoveryStopped(type: String) {}

                override fun onServiceFound(service: NsdServiceInfo) {
                    handler.post {
                        if (discovery === this) {
                            pending.add(service)
                            resolveNext()
                        }
                    }
                }

                override fun onServiceLost(service: NsdServiceInfo) {
                    handler.post { if (discovery === this) found(service.serviceName, null) }
                }
            }
        discovery = listener
        runCatching {
                manager.discoverServices("_efir._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
            }
            .onFailure { discovery = null }
    }

    @Suppress("DEPRECATION")
    private fun resolveNext() {
        if (resolving || pending.isEmpty() || discovery == null) return
        val service = pending.removeFirst()
        val current = generation
        resolving = true
        manager.resolveService(
            service,
            object : NsdManager.ResolveListener {
                override fun onResolveFailed(info: NsdServiceInfo, code: Int) {
                    handler.post {
                        if (current == generation) {
                            resolving = false
                            resolveNext()
                        }
                    }
                }

                override fun onServiceResolved(info: NsdServiceInfo) {
                    handler.post {
                        if (current == generation) {
                            val ip = info.host
                            if (ip != null && isLanAddress(ip))
                                found(info.serviceName, "http://${ip.hostAddress}:${info.port}")
                            resolving = false
                            resolveNext()
                        }
                    }
                }
            },
        )
    }

    fun stopDiscovery() {
        generation++
        pending.clear()
        resolving = false
        discovery?.let { runCatching { manager.stopServiceDiscovery(it) } }
        discovery = null
    }

    fun close() {
        stopDiscovery()
        unpublish()
    }
}
