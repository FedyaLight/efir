package app.efir.android

import android.content.Context
import java.util.Locale
import org.json.JSONObject

class Localization private constructor(context: Context) {
    companion object {
        private var instance: Localization? = null

        @Synchronized
        fun get(context: Context): Localization =
            instance ?: Localization(context.applicationContext).also { instance = it }
    }

    private val prefs = context.getSharedPreferences("efir", Context.MODE_PRIVATE)
    private val catalogue =
        JSONObject(
            context.assets.open("web/locales/messages.json").bufferedReader().use { it.readText() }
        ).getJSONObject("messages")
    val languages = listOf("ru", "en", "es", "zh", "hi", "ar")
    val names = listOf("Русский", "English", "Español", "简体中文", "हिन्दी", "العربية")
    val language: String
        get() = prefs.getString("language", null)
            ?: Locale.getDefault().language.let { if (it in languages) it else "en" }

    fun setLanguage(value: String) {
        if (value in languages && value != language) prefs.edit().putString("language", value).apply()
    }

    fun t(source: String, values: Map<String, String> = emptyMap()): String {
        var result =
            catalogue
                .optJSONArray(source)
                ?.optString(languages.indexOf(language))
                ?.ifEmpty { source } ?: source
        values.forEach { (key, value) -> result = result.replace("{$key}", value) }
        return result
    }
}
