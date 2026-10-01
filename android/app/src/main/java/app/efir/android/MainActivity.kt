package app.efir.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.*
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.*
import android.view.*
import android.webkit.*
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URI
import java.util.concurrent.Executors
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var strings: Localization
    private lateinit var speech: NativeSpeech
    private lateinit var container: FrameLayout
    private lateinit var bonjour: Bonjour
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val discovered = linkedMapOf<String, String>()
    private var devices: LinearLayout? = null
    private var address: EditText? = null
    private var service: ServerService? = null
    private var bound = false
    private var requestedSharing = false
    private var controller: WebView? = null
    private var prompter: WebView? = null
    private var resumed = false
    private var fullscreen = false
    private var awakeRequested = false
    private var connecting = false
    private var generation = 0
    private var pendingLanguage = "ru-RU"
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var exportBytes: ByteArray? = null
    private var exportType = "text/plain"
    private val prefs by lazy { getSharedPreferences("efir", MODE_PRIVATE) }

    private val scan =
        registerForActivityResult(ScanContract()) { result -> result.contents?.let { connect(it) } }
    private val microphone =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
            if (allowed && resumed && controller != null) speech.start(pendingLanguage)
            else voiceEvent("denied", strings.t("Нет доступа к микрофону"), false)
        }
    private val notification =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { startLocal(true) }
    private val importFile =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val values =
                if (result.resultCode == RESULT_OK)
                    WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
                else null
            fileCallback?.onReceiveValue(values)
            fileCallback = null
        }
    private val exportFile =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = exportBytes
            exportBytes = null
            if (result.resultCode == RESULT_OK && result.data?.data != null && data != null) {
                val uri = result.data!!.data!!
                worker.execute {
                    runCatching { contentResolver.openOutputStream(uri)?.use { it.write(data) } }
                        .onFailure { main.post { toast(it.localizedMessage ?: "File error") } }
                }
            }
        }
    private val connection =
        object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, binder: IBinder) {
                service = (binder as ServerService.LocalBinder).service
                service!!.onChanged = { serverChanged() }
                service!!.startServer()
                serverChanged()
            }

            override fun onServiceDisconnected(name: ComponentName) {
                service = null
                if (controller != null) showHome()
            }
        }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        strings = Localization(this)
        speech = NativeSpeech(this, strings, ::voiceEvent)
        bonjour =
            Bonjour(this) { name, url ->
                if (url == null) discovered.remove(name) else discovered[name] = url
                renderDevices()
            }
        container = FrameLayout(this).apply { setBackgroundColor(Color.rgb(16, 18, 16)) }
        setContentView(container)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val padding =
                insets.getInsets(
                    if (fullscreen && prompter != null) WindowInsetsCompat.Type.displayCutout()
                    else
                        WindowInsetsCompat.Type.systemBars() or
                            WindowInsetsCompat.Type.displayCutout()
                )
            view.setPadding(padding.left, padding.top, padding.right, padding.bottom)
            insets
        }
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    back()
                }
            },
        )
        if (
            intent.getBooleanExtra("resumeServer", false) || prefs.getString("mode", "") == "server"
        )
            startLocal(true)
        else if (prefs.getString("mode", "") == "standalone") startLocal(false) else showHome()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra("resumeServer", false) && controller == null) {
            closeViews()
            awakeRequested = false
            fullscreen = false
            updateScreen()
            startLocal(true)
        }
    }

    private fun button(label: String, action: () -> Unit): Button =
        Button(this).apply {
            text = strings.t(label)
            isAllCaps = false
            setTextColor(Color.rgb(201, 255, 98))
            setOnClickListener { action() }
        }

    private fun text(label: String, size: Float = 15f) =
        TextView(this).apply {
            text = strings.t(label)
            textSize = size
            setTextColor(Color.LTGRAY)
            setPadding(0, 12, 0, 12)
        }

    private fun showHome() {
        generation++
        connecting = false
        closeViews()
        releaseService()
        speech.stop()
        fullscreen = false
        awakeRequested = false
        updateScreen()
        discovered.clear()
        prefs.edit().remove("mode").apply()
        container.removeAllViews()
        val column =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                val p = (24 * resources.displayMetrics.density).toInt()
                setPadding(p, p, p, p)
                layoutDirection =
                    if (strings.language == "ar") View.LAYOUT_DIRECTION_RTL
                    else View.LAYOUT_DIRECTION_LTR
            }
        val scroll = ScrollView(this)
        scroll.addView(column)
        container.addView(scroll)
        column.addView(text("brand.name", 32f))
        column.addView(text("Суфлёр на телефоне или планшете"))
        val language =
            Spinner(this).apply {
                adapter =
                    ArrayAdapter(
                        this@MainActivity,
                        android.R.layout.simple_spinner_dropdown_item,
                        strings.names,
                    )
                setSelection(strings.languages.indexOf(strings.language))
                onItemSelectedListener =
                    object : AdapterView.OnItemSelectedListener {
                        override fun onNothingSelected(parent: AdapterView<*>?) {}

                        override fun onItemSelected(
                            parent: AdapterView<*>?,
                            view: View?,
                            position: Int,
                            id: Long,
                        ) {
                            if (strings.language != strings.languages[position]) {
                                strings.setLanguage(strings.languages[position])
                                showHome()
                            }
                        }
                    }
            }
        column.addView(language)
        column.addView(button("Читать на этом устройстве") { startLocal(false) })
        column.addView(text("Редактор, настройки и экран чтения — без компьютера и интернета."))
        column.addView(
            button("Запустить сервер") {
                if (
                    Build.VERSION.SDK_INT >= 33 &&
                        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                            PackageManager.PERMISSION_GRANTED
                )
                    notification.launch(Manifest.permission.POST_NOTIFICATIONS)
                else startLocal(true)
            }
        )
        column.addView(
            text("Этот Android станет пультом и раздаст суфлёр другим устройствам по Wi-Fi.")
        )
        column.addView(text("Подключиться к серверу", 21f))
        address =
            EditText(this).apply {
                setTextColor(Color.WHITE)
                setHintTextColor(Color.GRAY)
                hint = "http://192.168.1.23:8765"
                inputType =
                    android.text.InputType.TYPE_CLASS_TEXT or
                        android.text.InputType.TYPE_TEXT_VARIATION_URI
                setSingleLine()
                setText(prefs.getString("server", ""))
            }
        column.addView(address)
        column.addView(button("Подключиться") { connect(address!!.text.toString()) })
        column.addView(
            button("Сканировать QR") {
                scan.launch(
                    ScanOptions()
                        .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                        .setPrompt(strings.t("Подключить суфлёр"))
                        .setBeepEnabled(false)
                        .setOrientationLocked(false)
                )
            }
        )
        column.addView(text("Серверы в локальной сети"))
        devices = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(devices)
        column.addView(
            text(
                "Если включён VPN, разрешите «Доступ к локальной сети / Allow LAN» или исключите Эфир из туннеля."
            )
        )
        if (resumed) bonjour.discover()
    }

    private fun renderDevices() {
        devices?.let { list ->
            list.removeAllViews()
            discovered.forEach { (name, url) -> list.addView(button(name) { connect(url) }) }
        }
    }

    private fun startLocal(sharing: Boolean) {
        if (bound) return
        requestedSharing = sharing
        devices = null
        bonjour.stopDiscovery()
        container.removeAllViews()
        container.addView(text("Запуск сервера…", 20f))
        prefs.edit().putString("mode", if (sharing) "server" else "standalone").apply()
        val intent = Intent(this, ServerService::class.java).putExtra("sharing", sharing)
        if (sharing) startForegroundService(intent) else startService(intent)
        bound = bindService(intent, connection, Context.BIND_AUTO_CREATE)
    }

    private fun serverChanged() {
        val host = service ?: return
        if (host.error != null) {
            toast(host.error!!)
            showHome()
            return
        }
        if (host.port == 0) return
        if (controller == null) {
            controller = webView("http://localhost:${host.port}", "controller") ?: return
            container.removeAllViews()
            container.addView(controller)
            controller!!.loadUrl("http://localhost:${host.port}/#/c/LOCAL")
        }
        listOfNotNull(controller, prompter).forEach { view ->
            call(
                view,
                "info => { if (!window.efirNative) return; Object.assign(window.efirNative,info); window.dispatchEvent(new Event('efirnetwork')); }",
                JSONObject()
                    .put("publicOrigin", host.origin())
                    .put("addresses", host.addresses())
                    .toString(),
            )
        }
    }

    private fun connect(value: String) {
        if (connecting) return
        connecting = true
        val current = ++generation
        worker.execute {
            val result = runCatching {
                val uri =
                    URI(
                        if (value.trim().startsWith("http://")) value.trim()
                        else "http://${value.trim()}"
                    )
                require(uri.scheme == "http" && uri.host != null && uri.userInfo == null) {
                    strings.t("Введите локальный HTTP-адрес сервера Эфир")
                }
                require(uri.host.matches(Regex("[0-9.]+")) || uri.host.endsWith(".local", true)) {
                    strings.t("Введите локальный HTTP-адрес сервера Эфир")
                }
                require(InetAddress.getAllByName(uri.host).all { isLanAddress(it) }) {
                    strings.t("Введите локальный HTTP-адрес сервера Эфир")
                }
                val port = if (uri.port < 0) 8765 else uri.port
                require(port in 1..65535)
                val origin = "http://${uri.host}:$port"
                val request =
                    (java.net.URL("$origin/efir-local.json").openConnection() as HttpURLConnection)
                        .apply {
                            connectTimeout = 4000
                            readTimeout = 4000
                            instanceFollowRedirects = false
                        }
                try {
                    require(request.responseCode == 200)
                    val marker =
                        request.inputStream.use { input ->
                            val buffer = ByteArray(8192)
                            var count = 0
                            while (count < buffer.size) {
                                val n = input.read(buffer, count, buffer.size - count)
                                if (n < 0) break
                                count += n
                            }
                            require(count < buffer.size)
                            String(buffer, 0, count, Charsets.UTF_8)
                        }
                    require(JSONObject(marker).optBoolean("local"))
                } finally {
                    request.disconnect()
                }
                origin
            }
            main.post {
                if (current != generation || isFinishing) return@post
                connecting = false
                result
                    .onSuccess { origin ->
                        prefs.edit().putString("server", origin).apply()
                        bonjour.stopDiscovery()
                        devices = null
                        prompter = webView(origin, "prompter") ?: return@onSuccess
                        container.removeAllViews()
                        container.addView(prompter)
                        prompter!!.loadUrl("$origin/#/p/LOCAL")
                        awakeRequested = true
                        updateScreen()
                    }
                    .onFailure {
                        toast(
                            strings.t(
                                "Сервер недоступен. Проверьте Wi-Fi, адрес и доступ к локальной сети в VPN."
                            )
                        )
                    }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun webView(origin: String, role: String): WebView? {
        if (
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) ||
                !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        ) {
            toast(strings.t("Обновите Android System WebView, чтобы открыть приложение"))
            showHome()
            return null
        }
        val view = WebView(this)
        view.setBackgroundColor(Color.BLACK)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = true
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
        }
        val caps =
            JSONObject()
                .put("fullscreen", true)
                .put("screenAwake", true)
                .put("navigation", true)
                .put("speech", role == "controller")
                .put("speechDownload", role == "controller")
                .put("exportFile", role == "controller")
                .put("showPrompter", role == "controller")
                .put("standalone", role == "controller" && !requestedSharing)
                .put("networkSettings", role == "controller" && requestedSharing)
        val bootstrap =
            JSONObject()
                .put("version", 1)
                .put("platform", "android")
                .put("deviceName", Build.MODEL)
                .put("role", role)
                .put("uiLanguage", strings.language)
                .put("publicOrigin", service?.origin() ?: origin)
                .put("addresses", service?.addresses() ?: org.json.JSONArray())
                .put("capabilities", caps)
        WebViewCompat.addWebMessageListener(view, "EfirBridge", setOf(origin)) {
            _,
            message,
            source,
            mainFrame,
            reply ->
            if (mainFrame && source.toString().trimEnd('/') == origin)
                runCatching { JSONObject(message.data!!) }
                    .getOrNull()
                    ?.let {
                        if (it.optString("action") == "bootstrap")
                            reply.postMessage(
                                JSONObject()
                                    .put("uiLanguage", strings.language)
                                    .put("publicOrigin", service?.origin() ?: origin)
                                    .put("addresses", service?.addresses() ?: org.json.JSONArray())
                                    .toString()
                            )
                        else handle(view, role, it)
                    }
        }
        WebViewCompat.addDocumentStartJavaScript(
            view,
            "window.efirNative=$bootstrap; window.efirNative.postMessage=message=>window.EfirBridge.postMessage(JSON.stringify(message)); window.efirNative.ready=new Promise(done=>{window.EfirBridge.onmessage=event=>{Object.assign(window.efirNative,JSON.parse(event.data));done();};window.efirNative.postMessage({action:'bootstrap'});});",
            setOf(origin),
        )
        view.webViewClient =
            object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    web: WebView,
                    request: WebResourceRequest,
                ): Boolean = !request.url.toString().startsWith("$origin/")

                override fun onPageFinished(web: WebView, url: String) {
                    updateScreen()
                    visible(
                        web,
                        resumed &&
                            (if (role == "controller") prompter == null else prompter === web),
                    )
                }

                override fun onReceivedError(
                    web: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError,
                ) {
                    if (request.isForMainFrame)
                        toast(
                            strings.t(
                                "Сервер недоступен. Проверьте Wi-Fi, адрес и доступ к локальной сети в VPN."
                            )
                        )
                }
            }
        view.webChromeClient =
            object : WebChromeClient() {
                override fun onShowFileChooser(
                    web: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    if (role != "controller") return false
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    val intent =
                        Intent(Intent.ACTION_OPEN_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("*/*")
                            .putExtra(
                                Intent.EXTRA_ALLOW_MULTIPLE,
                                params.mode == FileChooserParams.MODE_OPEN_MULTIPLE,
                            )
                    importFile.launch(intent)
                    return true
                }

                override fun onJsConfirm(
                    web: WebView,
                    url: String,
                    message: String,
                    result: JsResult,
                ): Boolean {
                    AlertDialog.Builder(this@MainActivity)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                        .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
                        .setOnCancelListener { result.cancel() }
                        .show()
                    return true
                }
            }
        return view
    }

    private fun handle(view: WebView, role: String, message: JSONObject) {
        when (message.optString("action")) {
            "fullscreen" -> {
                if (prompter === view) {
                    fullscreen = !fullscreen
                    updateScreen()
                }
            }
            "screenAwake" -> {
                if (prompter === view) {
                    awakeRequested = message.optBoolean("active")
                    updateScreen()
                }
            }
            "back" -> back()
            "language" -> {
                strings.setLanguage(message.optString("language"))
                service?.language(strings.language)
            }
            "selectAddress" ->
                if (role == "controller") service?.selectAddress(message.optString("address"))
            "showPrompter" ->
                if (role == "controller" && prompter == null && service != null) {
                    val origin = "http://localhost:${service!!.port}"
                    val reading = webView(origin, "prompter") ?: return
                    prompter = reading
                    visible(view, false)
                    view.visibility = View.GONE
                    container.addView(reading)
                    reading.loadUrl("$origin/#/p/LOCAL")
                    awakeRequested = true
                    fullscreen = true
                    updateScreen()
                }
            "voiceStop" ->
                if (role == "controller") {
                    speech.stop()
                    voiceEvent("off", null, false)
                }
            "voiceModel" ->
                if (role == "controller") speech.download(message.optString("lang", "ru-RU"))
            "voiceStart" ->
                if (role == "controller" && resumed) {
                    pendingLanguage = message.optString("lang", "ru-RU")
                    if (
                        !speech.supported ||
                            checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
                                PackageManager.PERMISSION_GRANTED
                    )
                        speech.start(pendingLanguage)
                    else microphone.launch(Manifest.permission.RECORD_AUDIO)
                }
            "exportFile" ->
                if (role == "controller") {
                    exportBytes = message.optString("text").toByteArray()
                    exportType = message.optString("type", "text/plain").substringBefore(';')
                    exportFile.launch(
                        Intent(Intent.ACTION_CREATE_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE)
                            .setType(exportType)
                            .putExtra(Intent.EXTRA_TITLE, message.optString("name", "efir.txt"))
                    )
                }
        }
    }

    private fun back() {
        if (prompter != null && controller != null) {
            val old = prompter!!
            prompter = null
            visible(old, false)
            container.removeView(old)
            old.destroy()
            controller!!.visibility = View.VISIBLE
            visible(controller!!, resumed)
            fullscreen = false
            awakeRequested = false
            updateScreen()
        } else if (prompter != null || controller != null)
            AlertDialog.Builder(this)
                .setMessage(
                    strings.t(
                        if (service?.sharing == true)
                            "Закрыть пульт? Сервер продолжит работать. Остановить его можно из уведомления."
                        else "Вернуться к выбору режима?"
                    )
                )
                .setPositiveButton(android.R.string.ok) { _, _ -> showHome() }
                .setNegativeButton(android.R.string.cancel, null)
                .apply {
                    if (service?.sharing == true)
                        setNeutralButton(strings.t("Остановить сервер")) { _, _ ->
                            startService(
                                Intent(this@MainActivity, ServerService::class.java)
                                    .setAction("stop")
                            )
                        }
                }
                .show()
        else finish()
    }

    private fun call(view: WebView, function: String, json: String = "null") {
        view.evaluateJavascript("(($function))($json)", null)
    }

    private fun visible(view: WebView, active: Boolean) =
        call(view, "active => window.efirNative?.onVisible?.(active)", active.toString())

    private fun voiceEvent(kind: String, text: String?, final: Boolean) {
        main.post {
            controller?.let { view ->
                if (kind == "transcript")
                    call(
                        view,
                        "v => window.efirNative?.onTranscript?.(v.text,v.final)",
                        JSONObject().put("text", text).put("final", final).toString(),
                    )
                else if (kind == "notice")
                    call(
                        view,
                        "message => import('./js/ui.js').then(ui=>ui.toast(message))",
                        JSONObject.quote(text.orEmpty()),
                    )
                else
                    call(
                        view,
                        "v => window.efirNative?.onState?.(v.state,v.message)",
                        JSONObject().put("state", kind).put("message", text ?: "").toString(),
                    )
            }
        }
    }

    private fun updateScreen() {
        val awake = resumed && prompter != null && awakeRequested
        if (awake) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val bars = WindowCompat.getInsetsController(window, container)
        if (resumed && fullscreen && prompter != null) {
            bars.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            bars.hide(WindowInsetsCompat.Type.systemBars())
        } else bars.show(WindowInsetsCompat.Type.systemBars())
        ViewCompat.requestApplyInsets(container)
        prompter?.let {
            call(it, "active => window.efirNative?.onAwake?.(active)", awake.toString())
            call(
                it,
                "active => window.efirNative?.onFullscreen?.(active)",
                (fullscreen && resumed).toString(),
            )
        }
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        listOfNotNull(controller, prompter).forEach {
            it.onResume()
            visible(it, if (it === controller) prompter == null else true)
        }
        if (controller == null && prompter == null && !bound) bonjour.discover()
        updateScreen()
    }

    override fun onPause() {
        resumed = false
        bonjour.stopDiscovery()
        speech.stop()
        voiceEvent("off", null, false)
        listOfNotNull(controller, prompter).forEach {
            visible(it, false)
            it.onPause()
        }
        updateScreen()
        super.onPause()
    }

    private fun closeViews() {
        listOfNotNull(controller, prompter).forEach {
            container.removeView(it)
            it.destroy()
        }
        controller = null
        prompter = null
        devices = null
    }

    private fun releaseService() {
        service?.onChanged = null
        if (bound) {
            unbindService(connection)
            bound = false
        }
        if (service?.sharing == false) stopService(Intent(this, ServerService::class.java))
        service = null
    }

    override fun onDestroy() {
        generation++
        speech.stop()
        bonjour.close()
        fileCallback?.onReceiveValue(null)
        closeViews()
        releaseService()
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }
}
