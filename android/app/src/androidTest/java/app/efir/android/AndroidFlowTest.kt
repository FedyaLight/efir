package app.efir.android

import android.Manifest
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.SystemClock
import android.speech.SpeechRecognizer
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.webkit.WebView
import android.widget.Button
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
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

    private fun until(label: String, timeoutMs: Long = 15_000, check: () -> Boolean) {
        val end = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < end) {
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

    private fun microphoneDialogButton(id: String): AccessibilityNodeInfo? {
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return null
        val resources = "com.android.permissioncontroller:id"
        return root.findAccessibilityNodeInfosByViewId("$resources/$id").firstOrNull()
    }

    private fun observeVoice(view: WebView) {
        js(view, """
            window.states = [];
            window.voiceStarts = [];
            const bridge = window.efirNative;
            const onState = bridge.onState;
            const post = bridge.postMessage;
            bridge.onState = (state, message, session) => {
                states.push({state,session});
                onState(state,message,session);
            };
            bridge.postMessage = message => {
                if (message.action === 'voiceStart') voiceStarts.push(message.session);
                post(message);
            };
        """.trimIndent())
    }

    @Test
    fun microphonePermissionTracksCurrentVoiceRequest() {
        assumeTrue("Requires an Android recognizer and a fresh microphone permission",
            android.os.Build.VERSION.SDK_INT >= 31 &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(context) &&
                context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
        prepare()
        val automation = instrumentation.uiAutomation
        automation.serviceInfo = automation.serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
        }
        val outcome = InstrumentationRegistry.getArguments().getString("efirPermissionOutcome", "start")
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var controller = openController(scenario, "Read on this device")
            lateinit var activity: MainActivity
            scenario.onActivity { activity = it }
            observeVoice(controller)
            js(controller, """
                document.querySelector('[data-view=live]').click();
                document.querySelector('[data-a=voice]').click();
            """.trimIndent())
            val deny = "permission_deny_button"
            val allow = "permission_allow_foreground_only_button"
            until("system microphone dialog") { microphoneDialogButton(deny) != null }
            assertTrue(microphoneDialogButton(deny)?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true)
            until("permission result reaches the controller") {
                js(controller, "states.some(e=>e.state==='denied')") == true
            }
            assertEquals("denied", js(controller, "states.map(e=>e.state).join(',')"))
            until("denial reaches the active tracker") {
                js(controller, "document.querySelector('.voice-status').dataset.s === 'denied'") == true
            }

            js(controller, """
                states.length = 0;
                document.querySelector('[data-a=manual]').click();
                document.querySelector('[data-a=voice]').click();
            """.trimIndent())
            until("second microphone dialog") { microphoneDialogButton(allow) != null }
            when (outcome) {
                "stop" -> js(controller, "document.querySelector('[data-a=manual]').click()")
                "replace" -> js(controller, """
                    document.querySelector('[data-a=manual]').click();
                    document.querySelector('[data-a=voice]').click();
                """.trimIndent())
                "hide" -> {
                    val appTask = context.getSystemService(ActivityManager::class.java).appTasks
                        .first { it.taskInfo.taskId == activity.taskId }
                    scenario.moveToState(Lifecycle.State.CREATED)
                    until("backgrounding cancels the pending request") {
                        js(controller, "states.some(e=>e.state==='off')") == true
                    }
                    appTask.moveToFront()
                    until("permission dialog returns") { microphoneDialogButton(allow) != null }
                }
                "reload" -> {
                    val startingPage = js(controller, "performance.timeOrigin")
                    js(controller, "location.reload()")
                    until("new controller document") {
                        js(controller, "document.querySelector('.ctl') ? performance.timeOrigin : 0")
                            .let { it != 0 && it != startingPage }
                    }
                    observeVoice(controller)
                }
                "reopen" -> {
                    val previous = controller
                    instrumentation.runOnMainSync { activity.recreate() }
                    until("new Activity owns the controller") {
                        val next = runCatching { views(scenario).singleOrNull() }.getOrNull()
                        if (next == null || next === previous ||
                            js(next, "!!window.efirNative?.onState && !!document.querySelector('.ctl')") != true
                        ) return@until false
                        controller = next
                        true
                    }
                    scenario.onActivity { activity = it }
                    observeVoice(controller)
                }
            }
            assertTrue(microphoneDialogButton(allow)?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true)
            until("granted permission and resumed Activity") {
                var resumed = false
                instrumentation.runOnMainSync { resumed = activity.lifecycle.currentState == Lifecycle.State.RESUMED }
                resumed && context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            }
            if (outcome == "start") {
                // An emulator may expose an on-device service but have no installed speech model.
                until("the granted request reaches the native recognizer") {
                    js(controller, """
                        ['listening','hearing','unsupported'].includes(document.querySelector('.voice-status').dataset.s)
                    """.trimIndent()) == true
                }
                assertTrue(js(controller, "states.every(e=>e.session && !['denied','off'].includes(e.state))") == true)
            } else {
                val expected = if (outcome == "replace" || outcome == "hide") {
                    "states.length===1 && states[0].state==='off' && states[0].session===voiceStarts.at(-1)"
                } else "states.length===0"
                assertTrue("A canceled request must not start after permission is granted", js(controller, expected) == true)
            }
            js(controller, "document.querySelector('[data-a=manual]').click()")

            // A delayed bridge message after the Activity is stopped gets a terminal response.
            scenario.moveToState(Lifecycle.State.CREATED)
            js(controller, "window.efirNative.postMessage({action:'voiceStart',session:'hidden'})")
            until("hidden start is acknowledged without recognition") {
                js(controller, "states.some(e=>e.session==='hidden' && e.state==='off')") == true
            }
            scenario.moveToState(Lifecycle.State.RESUMED)
            js(controller, "states.length=0; document.querySelector('[data-a=voice]').click()")
            until("a new visible request uses the existing grant") {
                js(controller, """
                    states.some(e=>e.session && ['listening','hearing','unsupported'].includes(e.state))
                """.trimIndent()) == true
            }
            println("Microphone $outcome with existing grant: ${js(controller, "states.map(e=>e.state).join(',')")}")
        }
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
            val screenId = js(prompter, "new URL(location.href).searchParams.get('screen')") as String
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
            val mirror = "new DOMMatrix(getComputedStyle(document.querySelector('.stage-inner')).transform).a < 0"
            val expectedMirror = !(js(prompter, mirror) as Boolean)
            tap(prompter, "[data-a=mirror]")
            until("mirror is changed on the reading screen") {
                js(prompter, mirror) == expectedMirror
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
            until("controller receives leave before heartbeat expiry", 3_000) {
                js(controller, "!document.querySelector('.ctl').classList.contains('has-prompter')") == true
            }
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
            js(
                controller,
                "[...document.querySelectorAll('[data-a=read]')].find(el=>el.getBoundingClientRect().width>=44).click(); true",
            )
            until("reading view reopens") { views(scenario).size == 2 }
            val reopened = views(scenario).last()
            until("reopened screen connects") {
                js(reopened, "!!document.querySelector('.prompter.has-ctl.has-script')") == true
            }
            assertEquals(screenId, js(reopened, "new URL(location.href).searchParams.get('screen')"))
            until("reading screen restores its mirror profile") {
                js(reopened, mirror) == expectedMirror
            }
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
