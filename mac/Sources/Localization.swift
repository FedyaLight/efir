import Combine
import Foundation

@MainActor
final class Localization: ObservableObject {
    static let shared = Localization()
    static let languages = [
        ("ru", "Русский"), ("en", "English"), ("es", "Español"), ("zh", "简体中文"), ("hi", "हिन्दी"),
        ("ar", "العربية"),
    ]
    @Published private(set) var language: String
    private var messages: [String: [String]] = [:]
    private var codes: [String] = []

    private init() {
        let choices =
            [UserDefaults.standard.string(forKey: "efir.uiLanguage")].compactMap { $0 }
            + Locale.preferredLanguages
        language =
            choices.map {
                $0.lowercased().components(separatedBy: CharacterSet(charactersIn: "-_"))[0]
            }
            .first { code in Self.languages.contains { $0.0 == code } } ?? "en"
        if let url = Bundle.main.resourceURL?.appendingPathComponent("web/locales/messages.json"),
            let data = try? Data(contentsOf: url),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
            messages = json["messages"] as? [String: [String]] ?? [:]
            codes = json["languages"] as? [String] ?? []
        }
    }

    func select(_ value: String) {
        guard Self.languages.contains(where: { $0.0 == value }), value != language else { return }
        language = value
        UserDefaults.standard.set(value, forKey: "efir.uiLanguage")
    }

    func text(_ source: String, _ values: [String: String] = [:]) -> String {
        var result = source
        if let index = codes.firstIndex(of: language), let row = messages[source],
            row.indices.contains(index)
        {
            result = row[index]
        }
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{\(key)}", with: value)
        }
        return result
    }
}

@MainActor
func l(_ source: String, _ values: [String: String] = [:]) -> String {
    Localization.shared.text(source, values)
}
