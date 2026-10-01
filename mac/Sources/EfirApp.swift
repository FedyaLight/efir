import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI

@main
struct EfirApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        Settings {
            ConnectionSettingsView(model: delegate.model)
        }
        MenuBarExtra {
            MenuView(model: delegate.model)
        } label: {
            ServerMenuLabel(model: delegate.model)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel()
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { model.shutdown() }
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Open the controller at launch; network settings stay closed.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool)
        -> Bool
    {
        model.openController()
        return false
    }
}

struct ServerMenuLabel: View {
    @ObservedObject var model: AppModel
    @ObservedObject private var localization = Localization.shared
    var body: some View {
        Label(
            model.running ? "\(l("ЭФИР")) · \(model.prompterClients)" : l("Эфир · нет сервера"),
            systemImage: model.running
                ? "dot.radiowaves.left.and.right" : "exclamationmark.triangle")
    }
}

struct MenuView: View {
    @ObservedObject var model: AppModel
    @ObservedObject private var localization = Localization.shared
    @Environment(\.openSettings) private var openSettings
    var body: some View {
        Text(l(model.status, ["error": model.statusError]))
        Text(l("Суфлёров: {count}", ["count": String(model.prompterClients)]))
        Button(l("Открыть пульт")) { model.openController() }.disabled(!model.running)
        Button(l("Настройки подключения…")) {
            openSettings()
            NSApp.activate(ignoringOtherApps: true)
        }
        Divider()
        Button(l("Завершить Эфир")) { NSApp.terminate(nil) }
    }
}

struct ConnectionSettingsView: View {
    @ObservedObject var model: AppModel
    @ObservedObject private var localization = Localization.shared
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text(l("ЭФИР")).font(.largeTitle.bold())
                    Spacer()
                    Label(
                        l(model.status, ["error": model.statusError]),
                        systemImage: model.running ? "checkmark.circle.fill" : "clock"
                    ).foregroundStyle(model.running ? .green : .secondary)
                }
                Text(l("Суфлёр по Wi‑Fi · без интернета")).font(.title3)
                Picker(
                    l("Язык интерфейса"),
                    selection: Binding(get: { localization.language }, set: model.setLanguage)
                ) {
                    ForEach(Localization.languages, id: \.0) { code, name in Text(name).tag(code) }
                }
                if model.addresses.isEmpty {
                    Text(
                        l(
                            "Нет адреса Wi‑Fi или Ethernet. Подключите Mac к локальной сети; окна на этом Mac уже могут работать через localhost."
                        )
                    ).foregroundStyle(.orange)
                } else {
                    Picker(l("Адрес для телефона"), selection: $model.selectedAddress) {
                        ForEach(model.addresses) { item in Text(item.label).tag(item.address) }
                    }.onChange(of: model.selectedAddress) { _, _ in model.refreshNetwork() }
                }
                Text(model.origin).font(.system(.title3, design: .monospaced)).textSelection(
                    .enabled)
                Text(l("Суфлёров: {count}", ["count": String(model.prompterClients)]))
                    .foregroundStyle(.secondary)
                if model.running, let origin = model.publicOrigin {
                    QRCard(title: l("Подключить суфлёр"), url: "\(origin)/#/p/LOCAL").frame(
                        maxWidth: .infinity)
                }
                Divider()
                Button(l("Открыть пульт")) { model.openController() }.buttonStyle(
                    .borderedProminent
                ).disabled(!model.running)
                Text(
                    l(
                        "Mac и телефон должны быть в одной сети Wi‑Fi. При включённом VPN разрешите «Доступ к локальной сети / Allow LAN» или исключите браузер телефона из туннеля. Гостевая сеть с изоляцией устройств не подойдёт."
                    )
                ).font(.callout).foregroundStyle(.secondary)
                Text(
                    l(
                        "Закрытие окна не выключает сервер. Пока суфлёр подключён, Mac не засыпает от бездействия; экран Mac может погаснуть. Статус и завершение приложения доступны в строке меню."
                    )
                ).font(.callout).foregroundStyle(.secondary)
            }.padding(24)
        }.frame(minWidth: 620, minHeight: 580)
            .environment(
                \.locale,
                Locale(
                    identifier: localization.language == "zh" ? "zh-Hans" : localization.language)
            )
            .environment(
                \.layoutDirection, localization.language == "ar" ? .rightToLeft : .leftToRight)
    }
}

struct QRCard: View {
    let title: String
    let url: String
    private var image: NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(url.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
            let cg = CIContext().createCGImage(output, from: output.extent)
        else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: 180, height: 180))
    }
    var body: some View {
        VStack(spacing: 8) {
            if let image {
                Image(nsImage: image).interpolation(.none).resizable().scaledToFit().frame(
                    width: 180, height: 180
                ).padding(12).background(.white)
            }
            Text(title).font(.headline)
            Button(l("Скопировать ссылку")) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(url, forType: .string)
            }
        }
    }
}
