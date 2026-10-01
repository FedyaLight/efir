package app.efir.android

import android.content.Context
import android.content.Intent
import android.os.*
import android.speech.*
import java.util.concurrent.Executor

// Use system on-device recognition without cloud fallback.
class NativeSpeech(
    private val context: Context,
    private val strings: Localization,
    private val emit: (String, String?, Boolean) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var active = false
    private var language = "ru-RU"
    private var failures = 0
    private var last = ""
    private val restart = Runnable { if (active) listen() }
    val supported
        get() =
            Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    private fun intent(lang: String) =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }

    fun start(lang: String) {
        stop()
        language = lang
        if (Build.VERSION.SDK_INT < 31 || !supported) {
            emit(
                "unsupported",
                strings.t(
                    "На этом Android нет распознавания на устройстве. Используйте ручную прокрутку или микрофон компьютера."
                ),
                false,
            )
            return
        }
        active = true
        failures = 0
        val device = runCatching {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        }
            .getOrElse {
                active = false
                emit("unsupported", it.localizedMessage, false)
                return
            }
        recognizer = device
        device.setRecognitionListener(
            object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    if (active) emit("listening", null, false)
                }

                override fun onBeginningOfSpeech() {
                    if (active) emit("hearing", null, false)
                }

                override fun onRmsChanged(rms: Float) {}

                override fun onBufferReceived(buffer: ByteArray?) {}

                override fun onEndOfSpeech() {}

                override fun onEvent(type: Int, params: Bundle?) {}

                override fun onPartialResults(results: Bundle?) {
                    transcript(results, false)
                }

                override fun onResults(results: Bundle?) {
                    transcript(results, true)
                    if (active) {
                        failures = 0
                        main.postDelayed(restart, 150)
                    }
                }

                override fun onError(error: Int) {
                    if (!active) return
                    if (
                        error == SpeechRecognizer.ERROR_NO_MATCH ||
                            error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                    ) {
                        emit("listening", null, false)
                        main.postDelayed(restart, 300)
                        return
                    }
                    if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY && ++failures < 3) {
                        main.postDelayed(restart, 800)
                        return
                    }
                    val denied = error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                    stop()
                    emit(
                        if (denied) "denied" else "unsupported",
                        if (denied) strings.t("Нет доступа к микрофону")
                        else
                            strings.t(
                                "Язык не установлен для офлайн-распознавания. Скачайте его кнопкой в настройках голоса; затем можно отключить интернет."
                            ),
                        false,
                    )
                }
            }
        )
        if (Build.VERSION.SDK_INT >= 33) {
            runCatching {
                    device.checkRecognitionSupport(
                        intent(lang),
                        Executor { main.post(it) },
                        object : RecognitionSupportCallback {
                            override fun onSupportResult(support: RecognitionSupport) {
                                if (!active || recognizer !== device) return
                                val available = support.installedOnDeviceLanguages
                                if (
                                    available.any {
                                        val tag = it.replace('_', '-')
                                        tag.equals(lang, true) ||
                                            tag.equals(lang.substringBefore('-'), true)
                                    }
                                )
                                    listen()
                                else {
                                    stop()
                                    emit(
                                        "unsupported",
                                        strings.t(
                                            "Язык не установлен для офлайн-распознавания. Скачайте его кнопкой в настройках голоса; затем можно отключить интернет."
                                        ),
                                        false,
                                    )
                                }
                            }

                            override fun onError(error: Int) {
                                if (active && recognizer === device) listen()
                            }
                        },
                    )
                }
                .onFailure {
                    stop()
                    emit("unsupported", it.localizedMessage, false)
                }
        } else listen()
    }

    private fun listen() {
        if (active) {
            last = ""
            runCatching { recognizer?.startListening(intent(language)) }
                .onFailure {
                    stop()
                    emit("unsupported", it.localizedMessage, false)
                }
        }
    }

    private fun transcript(results: Bundle?, final: Boolean) {
        if (!active) return
        val text =
            results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                .orEmpty()
        if (text.isNotBlank() && (text != last || final)) {
            last = text
            emit("transcript", text, final)
        }
    }

    fun download(lang: String) {
        if (!supported || Build.VERSION.SDK_INT < 33) {
            emit(
                "notice",
                strings.t("Установите офлайн-язык в настройках службы распознавания речи Android."),
                false,
            )
            return
        }
        stop()
        val device = runCatching {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        }
            .getOrElse {
                emit("notice", it.localizedMessage, false)
                return
            }
        recognizer = device
        runCatching {
                if (Build.VERSION.SDK_INT >= 34)
                    device.triggerModelDownload(
                        intent(lang),
                        Executor { main.post(it) },
                        object : ModelDownloadListener {
                            override fun onProgress(progress: Int) {}

                            override fun onSuccess() {
                                emit(
                                    "notice",
                                    strings.t("Язык речи готов к работе без интернета"),
                                    false,
                                )
                                stop()
                            }

                            override fun onScheduled() {
                                emit(
                                    "notice",
                                    strings.t(
                                        "Загрузка языка запланирована системой. Проверьте подключение к интернету."
                                    ),
                                    false,
                                )
                                stop()
                            }

                            override fun onError(error: Int) {
                                emit(
                                    "notice",
                                    strings.t(
                                        "Установите офлайн-язык в настройках службы распознавания речи Android."
                                    ),
                                    false,
                                )
                                stop()
                            }
                        },
                    )
                else {
                    device.triggerModelDownload(intent(lang))
                    emit(
                        "notice",
                        strings.t(
                            "Загрузка языка запланирована системой. Проверьте подключение к интернету."
                        ),
                        false,
                    )
                }
            }
            .onFailure {
                stop()
                emit(
                    "notice",
                    strings.t(
                        "Установите офлайн-язык в настройках службы распознавания речи Android."
                    ),
                    false,
                )
            }
    }

    fun stop() {
        active = false
        main.removeCallbacks(restart)
        runCatching { recognizer?.cancel() }
        runCatching { recognizer?.destroy() }
        recognizer = null
    }
}
