import AVFoundation
import Foundation
import Speech
import WebKit

@MainActor
final class NativeSpeech {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private weak var webView: WKWebView?
    private var generation = UUID()
    private var active = false
    private var hasTap = false
    private var timer: Timer?
    private var retry: Task<Void, Never>?
    private var lang = "ru-RU"
    private var lastHeard = Date.distantPast

    func start(lang: String, in webView: WKWebView) {
        stop()
        self.webView = webView
        self.lang = lang
        active = true
        let session = generation
        Task {
            let speech = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
            }
            let mic = await AVCaptureDevice.requestAccess(for: .audio)
            guard active, session == generation else { return }
            guard speech == .authorized, mic else {
                state(
                    "denied",
                    "Разрешите Эфиру микрофон и распознавание речи в Системных настройках → Конфиденциальность и безопасность."
                )
                active = false
                return
            }
            begin(session: session)
        }
    }

    private func begin(session: UUID) {
        guard active, session == generation else { return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)),
            recognizer.supportsOnDeviceRecognition
        else {
            state(
                "unsupported",
                "Для {lang} нет распознавания на устройстве. Системные настройки → Клавиатура → Диктовка: выберите язык и дождитесь его загрузки. Если язык не поддерживается, выберите другой.",
                ["lang": lang])
            active = false
            return
        }
        self.recognizer = recognizer
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        self.request = request
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            state(
                "unsupported",
                "Mac не видит рабочий микрофон. Выберите устройство ввода в Системных настройках → Звук."
            )
            active = false
            return
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        hasTap = true
        engine.prepare()
        do { try engine.start() } catch {
            finishAudio()
            state(
                "unsupported", "Не удалось включить микрофон: {error}",
                ["error": error.localizedDescription])
            active = false
            return
        }
        let utterance = UUID()
        recognitionGeneration = utterance
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self, self.active, session == self.generation,
                    utterance == self.recognitionGeneration
                else { return }
                if let result {
                    self.failures = 0
                    self.lastHeard = Date()
                    self.webView?.callAsyncJavaScript(
                        "window.efirNative?.onTranscript(text, isFinal)",
                        arguments: [
                            "text": result.bestTranscription.formattedString,
                            "isFinal": result.isFinal,
                        ], in: nil, in: .page, completionHandler: nil)
                    self.state("hearing")
                }
                if result?.isFinal == true || error != nil {
                    self.restart(session: session, delay: error == nil ? 0.15 : 1)
                }
            }
        }
        state("listening")
        // Restart bounded recognition sessions while JS retains the script position.
        let started = Date()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.active, self.generation == session else { return }
                if Date().timeIntervalSince(started) > 50 {
                    self.restart(session: session, delay: 0.15)
                } else if Date().timeIntervalSince(self.lastHeard) > 1.5 {
                    self.state("listening")
                }
            }
        }
    }

    private var recognitionGeneration = UUID()
    private var failures = 0

    private func restart(session: UUID, delay: Double) {
        recognitionGeneration = UUID()
        finishAudio()
        failures = delay >= 1 ? failures + 1 : 0
        if failures >= 3 {
            active = false
            state(
                "unsupported",
                "Распознавание на Mac не запускается. Проверьте микрофон и загрузку языка в Системных настройках → Клавиатура → Диктовка, затем включите голос снова."
            )
            return
        }
        retry = Task {
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, active, session == generation else { return }
            begin(session: session)
        }
    }

    private func finishAudio() {
        timer?.invalidate()
        timer = nil
        engine.stop()
        if hasTap {
            engine.inputNode.removeTap(onBus: 0)
            hasTap = false
        }
        request?.endAudio()
        request = nil
        task?.cancel()
        task = nil
    }

    func stop(owner: WKWebView? = nil) {
        if let owner, webView !== owner { return }
        state("off")
        active = false
        generation = UUID()
        recognitionGeneration = UUID()
        failures = 0
        retry?.cancel()
        retry = nil
        finishAudio()
        webView = nil
    }

    private func state(_ value: String, _ message: String = "", _ values: [String: String] = [:]) {
        webView?.callAsyncJavaScript(
            "window.efirNative?.onState(state, message)",
            arguments: ["state": value, "message": l(message, values)], in: nil, in: .page,
            completionHandler: nil)
    }
}
