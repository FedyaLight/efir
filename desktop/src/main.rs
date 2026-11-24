#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use efir_desktop::{
    network::{addresses, Address, Bonjour},
    server::{bind, Hub},
    speech::{Speech, SpeechEvent},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    webview::DownloadEvent,
    Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[derive(Default, Serialize, Deserialize)]
struct Preferences {
    language: String,
    address: String,
    models: HashMap<String, PathBuf>,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum ExitPhase {
    Running,
    Flushing,
    Ready,
}
struct Lifecycle {
    visible: bool,
    speech: Speech,
    exit: ExitPhase,
}
struct State {
    port: u16,
    addresses: Mutex<Vec<Address>>,
    lifecycle: Mutex<Lifecycle>,
    prefs: Mutex<Preferences>,
    path: PathBuf,
    root: PathBuf,
    bonjour: Mutex<Option<Bonjour>>,
}
impl State {
    fn save(&self) {
        let temporary = self.path.with_extension("tmp");
        if std::fs::write(
            &temporary,
            serde_json::to_vec_pretty(&*self.prefs.lock().unwrap()).unwrap(),
        )
        .is_ok()
        {
            let _ = std::fs::rename(temporary, &self.path);
        }
    }
    fn origin(&self) -> String {
        let ip = self.prefs.lock().unwrap().address.clone();
        format!(
            "http://{}:{}",
            if ip.is_empty() { "localhost" } else { &ip },
            self.port
        )
    }
}
fn js(window: &WebviewWindow, script: &str, args: Value) {
    let _ = window.eval(&format!("(({script}))({args})"));
}
fn translate(state: &State, source: &str) -> String {
    let lang = state.prefs.lock().unwrap().language.clone();
    static CATALOGUE: OnceLock<Value> = OnceLock::new();
    let catalogue = CATALOGUE.get_or_init(|| {
        serde_json::from_str(include_str!("../../web/locales/messages.json")).unwrap_or_default()
    });
    let index = catalogue["languages"]
        .as_array()
        .and_then(|list| list.iter().position(|code| code == &lang))
        .unwrap_or(0);
    catalogue["messages"][source][index]
        .as_str()
        .unwrap_or(source)
        .into()
}
fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        report_visibility(app, &w, true);
    }
}
fn report_visibility(app: &tauri::AppHandle, window: &WebviewWindow, active: bool) {
    if let Some(state) = app.try_state::<State>() {
        let mut lifecycle = state.lifecycle.lock().unwrap();
        if lifecycle.exit != ExitPhase::Running || lifecycle.visible == active { return; }
        lifecycle.visible = active;
        if !active { lifecycle.speech.stop(); }
        js(window, "active => { if (window.efirNative) { window.efirNative.visible = active; window.efirNative.onVisible?.(active); } }", json!(active));
    }
}

fn request_exit(app: &tauri::AppHandle, code: i32, api: tauri::ExitRequestApi) {
    let Some(window) = app.get_webview_window("main") else { return; };
    let state = app.state::<State>();
    {
        let mut lifecycle = state.lifecycle.lock().unwrap();
        if lifecycle.exit == ExitPhase::Ready { return; }
        api.prevent_exit();
        if lifecycle.exit == ExitPhase::Flushing { return; }
        lifecycle.exit = ExitPhase::Flushing;
        lifecycle.speech.stop();
    }
    let (done, mut flushed) = tokio::sync::mpsc::channel(1);
    let evaluation = window.eval_with_callback("window.efirNative?.onClose?.(); true", move |_| {
        let _ = done.try_send(());
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // A hung or not-yet-loaded renderer may never invoke the callback.
        // An ordinary exit proceeds as soon as the callback arrives.
        if evaluation.is_ok() {
            let _ = tokio::time::timeout(Duration::from_secs(3), flushed.recv()).await;
        }
        app.state::<State>().lifecycle.lock().unwrap().exit = ExitPhase::Ready;
        app.exit(code);
    });
}

fn update_network(app: &tauri::AppHandle, list: Vec<Address>) {
    let state = app.state::<State>();
    let mut cached = state.addresses.lock().unwrap();
    if *cached == list { return; }
    *cached = list;
    let mut prefs = state.prefs.lock().unwrap();
    let old = prefs.address.clone();
    if !cached.iter().any(|item| item.address == prefs.address) {
        prefs.address = cached.first().map(|a| a.address.clone()).unwrap_or_default();
    }
    let ip = prefs.address.clone();
    drop(prefs);
    if ip != old {
        state.save();
        if let Some(b) = state.bonjour.lock().unwrap().as_mut() {
            let _ = b.publish(&ip, state.port);
        }
    }
    drop(cached);
    notify_network(app, &state);
}

fn notify_network(app: &tauri::AppHandle, state: &State) {
    if let Some(w) = app.get_webview_window("main") {
        js(
            &w,
            "info => { Object.assign(window.efirNative,info); window.dispatchEvent(new Event('efirnetwork')); }",
            json!({"addresses":*state.addresses.lock().unwrap(),"publicOrigin":state.origin()}),
        );
    }
}
#[tauri::command]
async fn native(
    window: WebviewWindow,
    app: tauri::AppHandle,
    message: Value,
) -> Result<Value, String> {
    let state = app.state::<State>();
    let url = window.url().map_err(|e| e.to_string())?;
    if window.label() != "main"
        || url.host_str() != Some("localhost")
        || url.port() != Some(state.port)
        || url.scheme() != "http"
    {
        return Err("Untrusted page".into());
    }
    match message["action"].as_str().unwrap_or("") {
        "bootstrap" => {
            let language = state.prefs.lock().unwrap().language.clone();
            let visible = state.lifecycle.lock().unwrap().visible;
            return Ok(
                json!({"uiLanguage":language,"publicOrigin":state.origin(),"addresses":*state.addresses.lock().unwrap(),"visible":visible}),
            );
        }
        "fullscreen" => {
            let full = !window.is_fullscreen().unwrap_or(false);
            window.set_fullscreen(full).map_err(|e| e.to_string())?;
            js(
                &window,
                "active => window.efirNative?.onFullscreen?.(active)",
                json!(full),
            );
        }
        "language" => {
            let language = message["language"].as_str().unwrap_or("");
            if ["ru", "en", "es", "zh", "hi", "ar"].contains(&language) {
                state.prefs.lock().unwrap().language = language.into();
                state.save();
                rebuild_menu(&app)?;
            }
        }
        "selectAddress" => {
            let ip = message["address"].as_str().unwrap_or("");
            let list = state.addresses.lock().unwrap();
            if !list.iter().any(|a| a.address == ip) {
                return Err("Not a hardware LAN address".into());
            }
            let mut prefs = state.prefs.lock().unwrap();
            if prefs.address == ip { return Ok(Value::Null); }
            prefs.address = ip.into();
            drop(prefs);
            state.save();
            if let Some(b) = state.bonjour.lock().unwrap().as_mut() {
                let _ = b.publish(ip, state.port);
            }
            drop(list);
            notify_network(&app, &state);
        }
        "voiceStop" => {
            let handle = app.clone();
            app.run_on_main_thread(move || handle.state::<State>().lifecycle.lock().unwrap().speech.stop())
                .map_err(|e| e.to_string())?;
        }
        "voiceModel" => {
            let lang = message["lang"].as_str().unwrap_or("ru-RU").to_string();
            if let Some(folder) = rfd::AsyncFileDialog::new()
                .set_title(&translate(&state, "Выберите папку модели Vosk"))
                .pick_folder()
                .await
            {
                let path = folder.path().to_path_buf();
                if path.join("am/final.mdl").is_file() && path.join("conf/model.conf").is_file() {
                    state.prefs.lock().unwrap().models.insert(lang, path);
                    state.save();
                    js(
                        &window,
                        "message => import('./js/ui.js').then(ui=>ui.toast(message,'ok'))",
                        json!(translate(&state, "Модель речи выбрана")),
                    );
                } else {
                    js(
                        &window,
                        "message => import('./js/ui.js').then(ui=>ui.toast(message,'bad'))",
                        json!(translate(
                            &state,
                            "Выберите распакованную папку модели Vosk с каталогами am и conf."
                        )),
                    );
                }
            }
        }
        "voiceStart" => {
            let handle = app.clone();
            app.run_on_main_thread(move || start_voice(&window, &handle, message))
                .map_err(|e| e.to_string())?;
        }
        "sessionActive" => {} // The server tracks clients even with the window closed.
        _ => return Err("Unknown action".into()),
    }
    Ok(Value::Null)
}

fn start_voice(window: &WebviewWindow, app: &tauri::AppHandle, message: Value) {
    let state = app.state::<State>();
    let mut lifecycle = state.lifecycle.lock().unwrap();
    let session = message["session"].as_str().map(str::to_owned);
    if !lifecycle.visible || lifecycle.exit != ExitPhase::Running {
        js(window, "session => window.efirNative?.onState?.('off','',session)", json!(session));
        return;
    }
    let lang = message["lang"].as_str().unwrap_or("ru-RU");
    let model = state.prefs.lock().unwrap().models.get(lang).cloned();
    if let Some(model) = model {
        let window = window.clone();
        let app = app.clone();
        let emit: SpeechEvent = Arc::new(move |kind, text, is_final| {
            if kind == "transcript" {
                js(
                    &window,
                    "v => window.efirNative?.onTranscript?.(v.text,v.final,v.session)",
                    json!({"text":text,"final":is_final,"session":session}),
                );
            } else {
                js(
                    &window,
                    "v => window.efirNative?.onState?.(v.state,v.message,v.session)",
                    json!({"state":kind,"message":translate(&app.state::<State>(),text.unwrap_or("")),"session":session}),
                );
            }
        });
        lifecycle.speech.start(model, state.root.join("speech"), emit);
    } else {
        lifecycle.speech.stop();
        js(
            window,
            "v => window.efirNative?.onState?.('unsupported',v.message,v.session)",
            json!({"session":session,"message":translate(&state,"Выберите офлайн-модель Vosk для языка речи через кнопку в настройках голоса.")}),
        );
    }
}
fn rebuild_menu(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<State>();
    let open = MenuItem::with_id(
        app,
        "open",
        translate(&state, "Открыть пульт"),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        translate(&state, "Завершить Эфир"),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&open, &quit]).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("efir") {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn main() {
    tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app,_,_|show(app))).invoke_handler(tauri::generate_handler![native]).setup(|app| {
        #[cfg(target_os="linux")]
        if let Some(settings)=gtk::Settings::default() {
            use gtk::prelude::GtkSettingsExt;
            // Keep fractional glyph widths consistent with Chromium readers.
            settings.set_gtk_xft_hinting(0); settings.set_gtk_xft_hintstyle(Some("hintnone"));
        }
        let root=app.path().resource_dir()?;
        let root=if root.join("web/index.html").is_file(){root}else{PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")};
        let data=app.path().app_config_dir()?;std::fs::create_dir_all(&data)?;
        let path=data.join("preferences.json");
        let mut prefs:Preferences=std::fs::read(&path).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default();
        if prefs.language.is_empty() { let code=sys_locale::get_locale().unwrap_or("en".into()).split(['-','_']).next().unwrap_or("en").to_string();prefs.language=if ["ru","en","es","zh","hi","ar"].contains(&code.as_str()){code}else{"en".into()}; }
        let (counts, mut client_count) = tokio::sync::watch::channel(0usize);
        let hub = Arc::new(Hub::new(move |_, external| {
            counts.send_if_modified(|previous| {
                if *previous == external { return false; }
                *previous = external;
                true
            });
        }));
        let (port,listener,router)=tauri::async_runtime::block_on(bind(root.join("web"),8765,hub))?;
        let list=addresses();
        if !list.iter().any(|a|a.address==prefs.address) { prefs.address=list.first().map(|a|a.address.clone()).unwrap_or_default(); }
        let mut bonjour=Bonjour::new().ok(); if let Some(b)=bonjour.as_mut() { let _=b.publish(&prefs.address,port); }
        let bootstrap=json!({"version":1,"platform":std::env::consts::OS,"role":"controller","deviceName":if cfg!(target_os="windows"){"Windows"}else{"Linux"},"uiLanguage":prefs.language,"publicOrigin":format!("http://{}:{port}",if prefs.address.is_empty(){"localhost"}else{&prefs.address}),"addresses":list,"capabilities":{"speech":true,"speechModels":true,"speechForeground":true,"fullscreen":true,"sessionAwake":true,"networkSettings":true}});
        app.manage(State {
            port, addresses: Mutex::new(list),
            prefs: Mutex::new(prefs), path, root, bonjour: Mutex::new(bonjour),
            lifecycle: Mutex::new(Lifecycle { visible: true, speech: Speech::default(), exit: ExitPhase::Running }),
        });
        tauri::async_runtime::spawn(async move { if let Err(e)=axum::serve(listener,router.into_make_service_with_connect_info::<std::net::SocketAddr>()).await { eprintln!("Efir server: {e}"); } });
        let window=WebviewWindowBuilder::new(app,"main",WebviewUrl::External(format!("http://localhost:{port}/#/c/LOCAL").parse()?))
            .title("Efir").inner_size(1320.,820.).min_inner_size(680.,500.)
            .initialization_script(format!("if (location.origin === 'http://localhost:{port}') {{ window.efirNative={bootstrap};let voiceQueue=Promise.resolve(); const send=message=>window.__TAURI_INTERNALS__.invoke('native',{{message}}).catch(console.error); window.efirNative.postMessage=message=>['voiceStart','voiceStop'].includes(message.action)?(voiceQueue=voiceQueue.then(()=>send(message))):send(message);window.efirNative.ready=window.efirNative.postMessage({{action:'bootstrap'}}).then(info=>{{if(info){{const visible=window.efirNative.visible ?? info.visible;Object.assign(window.efirNative,info,{{visible}});window.efirNative.onVisible?.(visible);}}}}); }}"))
            .on_navigation(move |url|url.scheme()=="http" && url.host_str()==Some("localhost") && url.port()==Some(port))
            .on_download(|_,event| { if let DownloadEvent::Requested {destination,..}=event { let name=destination.file_name().unwrap_or_default().to_string_lossy().into_owned();if let Some(path)=rfd::FileDialog::new().set_file_name(name).save_file(){*destination=path;}else{return false;} }true })
            .build()?;
        let closed=window.clone(); let app_for_close=app.handle().clone();
        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested {api,..} => {
                api.prevent_close();
                report_visibility(&app_for_close, &closed, false);
                let _=closed.hide();
            }
            WindowEvent::Resized(_) | WindowEvent::Focused(_) => {
                let active = closed.is_visible().unwrap_or(true) && !closed.is_minimized().unwrap_or(false);
                report_visibility(&app_for_close, &closed, active);
            }
            _ => {}
        });
        TrayIconBuilder::with_id("efir").icon(app.default_window_icon().unwrap().clone()).tooltip("Efir").on_menu_event(|app,event|match event.id().as_ref(){"open"=>show(app),"quit"=>app.exit(0),_=>{}}).build(app)?;
        rebuild_menu(app.handle()).map_err(std::io::Error::other)?;
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(3)).await;
                update_network(&handle, addresses());
            }
        });
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let mut awake = None;
            while client_count.changed().await.is_ok() {
                let count = *client_count.borrow_and_update();
                if count > 0 && awake.is_none() {
                    awake = keepawake::Builder::default()
                        .idle(true).display(false)
                        .reason("Efir teleprompter connected").app_name("Efir")
                        .create().ok();
                } else if count == 0 {
                    awake.take();
                }
                if let Some(tray) = handle.tray_by_id("efir") {
                    let _ = tray.set_tooltip(Some(format!("Efir · {count}")));
                }
            }
        });
        Ok(())
    }).build(tauri::generate_context!()).expect("Efir startup").run(|app, event| {
        if let RunEvent::ExitRequested { code, api, .. } = event {
            request_exit(app, code.unwrap_or(0), api);
        }
    });
}
