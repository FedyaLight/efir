package app.efir.android

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.runner.AndroidJUnitRunner
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONTokener

// Launch the Android server for the shared tests/relay.mjs contract.
class EfirTestRunner : AndroidJUnitRunner() {
    private var fixture = false

    override fun onCreate(arguments: Bundle?) {
        fixture = arguments?.getString("efirServerFixture") == "true"
        super.onCreate(arguments)
    }

    private fun web(view: View): WebView? =
        if (view is WebView) view
        else if (view is ViewGroup)
            (0 until view.childCount).firstNotNullOfOrNull { web(view.getChildAt(it)) }
        else null

    override fun onStart() {
        if (!fixture) {
            super.onStart()
            return
        }
        val activity =
            startActivitySync(
                Intent(targetContext, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra("resumeServer", true)
            )
        var origin: String? = null
        for (attempt in 0..100) {
            val latch = CountDownLatch(1)
            runOnMainSync {
                web(activity.window.decorView)?.evaluateJavascript("location.origin") { value ->
                    origin = JSONTokener(value).nextValue().toString()
                    latch.countDown()
                } ?: latch.countDown()
            }
            latch.await(1, TimeUnit.SECONDS)
            if (origin?.startsWith("http://localhost:") == true) break
            Thread.sleep(100)
        }
        check(origin?.startsWith("http://localhost:") == true) { "Android server did not start" }
        sendStatus(1, Bundle().apply { putString("efirUrl", origin) })
        runOnMainSync { activity.finish() }
        waitForIdleSync()
        Thread.sleep(180000)
        finish(android.app.Activity.RESULT_OK, Bundle())
    }
}
