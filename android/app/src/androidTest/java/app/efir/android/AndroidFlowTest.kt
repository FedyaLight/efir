package app.efir.android

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import android.widget.Button
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test

// Exercise actual Activity, WebView and service lifecycles,
// which shared browser tests cannot reach.
class AndroidFlowTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    private fun prepare() {
        context.stopService(Intent(context, ServerService::class.java))
        context
            .getSharedPreferences("efir", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .putString("language", "en")
            .commit()
    }

    private fun descendants(view: View): List<View> =
        listOf(view) +
            if (view is ViewGroup)
                (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) }
            else emptyList()

    private fun views(scenario: ActivityScenario<MainActivity>): List<WebView> {
        var result = emptyList<WebView>()
        scenario.onActivity {
            result = descendants(it.window.decorView).filterIsInstance<WebView>()
        }
        return result
    }

    private fun until(label: String, check: () -> Boolean) {
        val end = System.currentTimeMillis() + 15000
        while (System.currentTimeMillis() < end) {
            if (check()) return
            Thread.sleep(80)
        }
        fail("Timeout: $label")
    }

    private fun js(view: WebView, source: String): Any? {
        val latch = CountDownLatch(1)
        var result: Any? = null
        instrumentation.runOnMainSync {
            view.evaluateJavascript(source) { value ->
                result = JSONTokener(value).nextValue()
                latch.countDown()
            }
        }
        assertTrue("WebView callback", latch.await(4, TimeUnit.SECONDS))
        return result
    }

    private fun click(scenario: ActivityScenario<MainActivity>, label: String) {
        scenario.onActivity { activity ->
            descendants(activity.window.decorView)
                .filterIsInstance<Button>()
                .first { it.text.toString() == label }
                .performClick()
        }
    }

    private fun tap(view: WebView, selector: String? = null) {
        if (selector != null) {
            until("reading control is visible") {
                js(
                    view,
                    "(()=>{const el=document.querySelector('$selector'),ui=el?.closest('.p-ui');return !!el && (!ui || (!ui.inert && Number(getComputedStyle(ui).opacity)===1))})()",
                ) == true
            }
        }
        val point =
            selector?.let {
                val bounds =
                    js(
                        view,
                        "(()=>{const r=document.querySelector('$it').getBoundingClientRect();return [r.x,r.y,r.width,r.height,innerWidth,innerHeight]})()",
                    )
                        as JSONArray
                assertTrue(
                    "Touch target fits the viewport",
                    bounds.getDouble(0) >= 0 &&
                        bounds.getDouble(1) >= 0 &&
                        bounds.getDouble(2) >= 44 &&
                        bounds.getDouble(3) >= 44 &&
                        bounds.getDouble(0) + bounds.getDouble(2) <= bounds.getDouble(4) &&
                        bounds.getDouble(1) + bounds.getDouble(3) <= bounds.getDouble(5),
                )
                Pair(
                    ((bounds.getDouble(0) + bounds.getDouble(2) / 2) * view.width /
                            bounds.getDouble(4))
                        .toFloat(),
                    ((bounds.getDouble(1) + bounds.getDouble(3) / 2) * view.height /
                            bounds.getDouble(5))
                        .toFloat(),
                )
            } ?: Pair(view.width / 2f, view.height / 2f)
        instrumentation.runOnMainSync {
            val now = SystemClock.uptimeMillis()
            for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                val event =
                    MotionEvent.obtain(
                        now,
                        now + action * 40L,
                        action,
                        point.first,
                        point.second,
                        0,
                    )
                view.dispatchTouchEvent(event)
                event.recycle()
            }
        }
    }

    private fun openController(scenario: ActivityScenario<MainActivity>, button: String): WebView {
        click(scenario, button)
        until("controller created") { views(scenario).isNotEmpty() }
        val controller = views(scenario).first()
        until("controller loaded") { js(controller, "!!document.querySelector('.ctl')") == true }
        return controller
    }

    @Test
    fun standaloneKeepsScreenOnAndStopsHiddenPreview() {
        prepare()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val controller = openController(scenario, "Read on this device")
            js(
                controller,
                "window.flowReloadToken=true;const select=document.querySelector('.ui-language');select.value='es';select.dispatchEvent(new Event('change',{bubbles:true}));true",
            )
            instrumentation.runOnMainSync { controller.reload() }
            until("native language after reload") {
                js(
                    controller,
                    "window.flowReloadToken !== true && document.querySelector('.ui-language')?.value === 'es'",
                ) == true
            }
            js(
                controller,
                "document.querySelector('[data-view=edit]').click(); document.querySelector('.ed-text').value='# Native test\\n'+('The quick brown fox reads without a computer. '.repeat(90)); document.querySelector('.ed-text').dispatchEvent(new Event('input')); document.querySelector('[data-view=live]').click(); true",
            )
            assertTrue(
                "Read here is visible and has a touch-sized target",
                js(
                    controller,
                    "[...document.querySelectorAll('[data-a=read]')].some(el=>{const r=el.getBoundingClientRect();return r.width>=44 && r.height>=44 && r.top>=0 && r.bottom<=innerHeight})",
                ) == true,
            )
            Thread.sleep(700)
            js(
                controller,
                "[...document.querySelectorAll('[data-a=read]')].find(el=>el.getBoundingClientRect().width>=44).click(); true",
            )
            until("reading view") { views(scenario).size == 2 }
            val prompter = views(scenario).last()
            until("text sync") {
                js(
                    prompter,
                    "!!document.querySelector('.prompter.has-ctl.has-script') && document.querySelector('.text').textContent.includes('quick brown fox')",
                ) == true
            }
            assertEquals(
                "native wake does not create a video",
                0,
                js(prompter, "document.querySelectorAll('video').length"),
            )
            scenario.onActivity {
                assertTrue(
                    "screen held",
                    it.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON !=
                        0,
                )
                assertEquals(View.GONE, controller.visibility)
            }
            js(
                controller,
                "window.drawCount=0; const request=window.requestAnimationFrame.bind(window); window.requestAnimationFrame=fn=>request(t=>{window.drawCount++;fn(t)}); true",
            )
            tap(prompter)
            until("tap starts reading and hides controls") {
                js(prompter, "!!document.querySelector('.prompter.playing.ui-hidden')") == true
            }
            Thread.sleep(1500)
            assertTrue(
                "hidden preview has no drawing loop",
                (js(controller, "window.drawCount") as Number).toInt() < 3,
            )
            assertEquals(
                "playing icon has no text",
                "",
                js(prompter, "document.querySelector('.p-fullscreen').textContent"),
            )
            tap(prompter)
            until("tap pauses and reveals controls") {
                js(
                    prompter,
                    "!!document.querySelector('.prompter:not(.playing):not(.ui-hidden)')",
                ) == true
            }
            tap(prompter, "[data-a=mirror]")
            until("mirror is applied to reading screen") {
                js(
                    prompter,
                    "new DOMMatrix(getComputedStyle(document.querySelector('.stage-inner')).transform).a < 0",
                ) == true
            }
            tap(prompter, "[data-a=fs]")
            until("leave native fullscreen") {
                js(
                    prompter,
                    "!document.querySelector('.prompter').classList.contains('is-fullscreen')",
                ) == true
            }
            tap(prompter, "[data-a=fs]")
            until("enter native fullscreen") {
                js(
                    prompter,
                    "document.querySelector('.prompter').classList.contains('is-fullscreen')",
                ) == true
            }
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            until("back to editor") { views(scenario).size == 1 }
            scenario.onActivity {
                assertEquals(View.VISIBLE, controller.visibility)
                assertEquals(
                    0,
                    it.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                )
            }
            assertTrue(
                js(
                    controller,
                    "document.querySelector('.ed-text').value.includes('quick brown fox')",
                ) == true
            )
        }
    }

    @Test
    fun serverSurvivesClosedControllerAndCanBeStopped() {
        prepare()
        if (android.os.Build.VERSION.SDK_INT >= 33)
            instrumentation.uiAutomation.grantRuntimePermission(
                context.packageName,
                Manifest.permission.POST_NOTIFICATIONS,
            )
        var port = 0
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val controller = openController(scenario, "Start server")
            port = URL(js(controller, "location.origin").toString()).port
            assertTrue(
                js(controller, "window.efirNative.publicOrigin.startsWith('http://10.')") == true
            )
        }
        val marker =
            (URL("http://localhost:$port/efir-local.json").openConnection() as HttpURLConnection)
                .apply {
                    connectTimeout = 1500
                    readTimeout = 1500
                }
        try {
            assertEquals(200, marker.responseCode)
            assertTrue(
                marker.inputStream.bufferedReader().use { it.readText() }.contains("\"local\":true")
            )
        } finally {
            marker.disconnect()
        }
        context.startService(Intent(context, ServerService::class.java).setAction("stop"))
        until("server socket closed") {
            runCatching {
                URL("http://localhost:$port/efir-local.json")
                    .openConnection()
                    .apply {
                        connectTimeout = 300
                        readTimeout = 300
                    }
                    .getInputStream()
                    .close()
            }
                .isFailure
        }
    }

    @Test
    fun standaloneStopsPreviousPublicServer() {
        prepare()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            openController(scenario, "Start server")
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            until("mode dialog") {
                val ok =
                    instrumentation.uiAutomation.rootInActiveWindow
                        ?.findAccessibilityNodeInfosByText("OK")
                        ?.firstOrNull()
                ok?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK) ==
                    true
            }
            until("home") { views(scenario).isEmpty() }
            val controller = openController(scenario, "Read on this device")
            val public = js(controller, "window.efirNative.publicOrigin").toString()
            val request =
                (URL("$public/efir-local.json").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 500
                    readTimeout = 500
                }
            try {
                assertTrue(
                    "standalone has no public listener",
                    runCatching { request.inputStream.close() }.isFailure,
                )
            } finally {
                request.disconnect()
            }
        }
    }
}
