use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, Method, StatusCode, Uri},
    response::Response,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, UNIX_EPOCH},
};
use tokio::{
    net::TcpListener,
    sync::{mpsc, watch},
};

#[derive(Clone)]
struct Client {
    sender: mpsc::Sender<Message>,
    cancel: watch::Sender<bool>,
    buffered: Arc<AtomicUsize>,
    external: bool,
}
fn message_size(message: &Message) -> usize {
    match message {
        Message::Text(text) => text.len(),
        Message::Binary(bytes) | Message::Ping(bytes) | Message::Pong(bytes) => bytes.len(),
        Message::Close(_) => 128,
    }
}
impl Client {
    fn enqueue(&self, message: Message) -> bool {
        let size = message_size(&message);
        if self.buffered.fetch_add(size, Ordering::Relaxed) + size > 32 * 1024 * 1024
            || self.sender.try_send(message).is_err()
        {
            self.buffered.fetch_sub(size, Ordering::Relaxed);
            let _ = self.cancel.send(true);
            false
        } else {
            true
        }
    }
}

pub struct Hub {
    clients: Mutex<HashMap<u64, Client>>,
    next: AtomicU64,
    changed: Arc<dyn Fn(usize, usize) + Send + Sync>,
}
impl Hub {
    pub fn new(changed: impl Fn(usize, usize) + Send + Sync + 'static) -> Self {
        Self {
            clients: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            changed: Arc::new(changed),
        }
    }
    fn notify(&self, clients: &HashMap<u64, Client>) {
        (self.changed)(
            clients.len(),
            clients.values().filter(|client| client.external).count(),
        );
    }
    fn remove(&self, id: u64) {
        let mut clients = self.clients.lock().unwrap();
        if clients.remove(&id).is_some() {
            self.notify(&clients);
        }
    }
    fn relay(&self, id: u64, message: Message) {
        let mut clients = self.clients.lock().unwrap();
        let slow: Vec<_> = clients
            .iter()
            .filter_map(|(&other, client)| {
                (other != id && !client.enqueue(message.clone())).then_some(other)
            })
            .collect();
        if !slow.is_empty() {
            for id in slow {
                if let Some(client) = clients.remove(&id) {
                    let _ = client.cancel.send(true);
                }
            }
            self.notify(&clients);
        }
    }
}
#[derive(Clone)]
struct Site {
    root: PathBuf,
    hub: Arc<Hub>,
}

pub async fn bind(
    root: PathBuf,
    first: u16,
    hub: Arc<Hub>,
) -> std::io::Result<(u16, TcpListener, Router)> {
    let root = root.canonicalize()?;
    if !root.join("index.html").is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "web/index.html",
        ));
    }
    for port in first..=first.saturating_add(100) {
        match TcpListener::bind(("0.0.0.0", port)).await {
            Ok(listener) => {
                let router = Router::new()
                    .route("/ws", get(ws))
                    .fallback(site)
                    .with_state(Site { root, hub });
                return Ok((port, listener, router));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => continue,
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AddrInUse,
        "Efir ports are busy",
    ))
}
async fn ws(
    State(site): State<Site>,
    ConnectInfo(address): ConnectInfo<std::net::SocketAddr>,
    upgrade: WebSocketUpgrade,
) -> Response {
    upgrade
        .max_message_size(16 * 1024 * 1024)
        .max_frame_size(16 * 1024 * 1024)
        .on_upgrade(move |socket| connection(socket, site.hub, !address.ip().is_loopback()))
}
async fn connection(socket: WebSocket, hub: Arc<Hub>, external: bool) {
    let id = hub.next.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx) = mpsc::channel(256);
    let (cancel, mut cancelled) = watch::channel(false);
    let buffered = Arc::new(AtomicUsize::new(0));
    let client = Client {
        sender: tx.clone(),
        cancel,
        buffered: buffered.clone(),
        external,
    };
    {
        let mut clients = hub.clients.lock().unwrap();
        if clients.len() >= 32 {
            return;
        }
        clients.insert(id, client.clone());
        hub.notify(&clients);
    }
    let (mut output, mut input) = socket.split();
    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            buffered.fetch_sub(message_size(&message), Ordering::Relaxed);
            if !matches!(
                tokio::time::timeout(Duration::from_secs(5), output.send(message)).await,
                Ok(Ok(()))
            ) {
                break;
            }
        }
        let _ = output.close().await;
    });
    loop {
        tokio::select! {
            message = tokio::time::timeout(Duration::from_secs(45), input.next()) => match message {
                Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) | Err(_) => break,
                Ok(Some(Ok(Message::Ping(bytes)))) => { client.enqueue(Message::Pong(bytes)); },
                Ok(Some(Ok(Message::Pong(_)))) => {},
                Ok(Some(Ok(message))) => {
                    if let Message::Text(text) = &message {
                        if text.contains("__efir_ping") {
                            if let Ok(value) = serde_json::from_str::<Value>(text) {
                                if value["t"] == "__efir_ping" && value.get("from").is_none() && value["ts"].is_number() {
                                    client.enqueue(Message::Text(json!({"t":"__efir_pong","ts":value["ts"]}).to_string().into())); continue;
                                }
                            }
                        }
                    }
                    hub.relay(id, message);
                },
            },
            _ = tx.closed() => break,
            _ = cancelled.changed() => break,
        }
    }
    hub.remove(id);
    writer.abort();
}
fn response(status: StatusCode, mime: &str, length: usize, body: Body, cache: &str) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, length)
        .header(header::CACHE_CONTROL, cache)
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .body(body)
        .unwrap()
}
async fn site(State(site): State<Site>, method: Method, uri: Uri, headers: HeaderMap) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return response(
            StatusCode::METHOD_NOT_ALLOWED,
            "text/plain",
            0,
            Body::empty(),
            "no-store",
        );
    }
    if uri.path() == "/efir-local.json" {
        let data = json!({"local":true,"version":env!("CARGO_PKG_VERSION"),"hostName":if cfg!(target_os="windows") {"Windows"} else if cfg!(target_os="linux") {"Linux"} else {"Desktop"},"platform":std::env::consts::OS}).to_string();
        return response(
            StatusCode::OK,
            "application/json",
            data.len(),
            if method == Method::HEAD {
                Body::empty()
            } else {
                Body::from(data)
            },
            "no-store",
        );
    }
    let Ok(path) = percent_encoding::percent_decode_str(uri.path()).decode_utf8() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if path
        .split('/')
        .any(|part| part.starts_with('.') || part.contains('\\') || part.contains('\0'))
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    let relative = if path == "/" {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };
    let Ok(file) = tokio::fs::canonicalize(site.root.join(relative)).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !file.starts_with(&site.root) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(meta) = tokio::fs::metadata(&file).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !meta.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let etag = format!(
        "W/\"{}-{}\"",
        meta.len(),
        meta.modified()
            .unwrap_or(UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let ext = file.extension().and_then(|x| x.to_str()).unwrap_or("");
    let mime = match ext {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    };
    let cache = if ext == "woff2" {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|x| x.to_str().ok())
        .is_some_and(|h| h.split(',').any(|v| v.trim() == etag || v.trim() == "*"))
    {
        return Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .header(header::ETAG, etag)
            .header(header::CACHE_CONTROL, cache)
            .body(Body::empty())
            .unwrap();
    }
    let mut start = 0;
    let mut end = meta.len().saturating_sub(1);
    let mut partial = false;
    if let Some(range) = headers
        .get(header::RANGE)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("bytes="))
    {
        let values = range.split_once('-');
        match values {
            Some((a, b)) if !a.is_empty() => {
                start = a.parse().unwrap_or(u64::MAX);
                end = if b.is_empty() {
                    end
                } else {
                    b.parse().unwrap_or(0).min(end)
                };
                partial = true;
            }
            Some(("", b)) => {
                start = meta.len().saturating_sub(b.parse().unwrap_or(0));
                partial = true;
            }
            _ => start = u64::MAX,
        }
        if meta.len() == 0 || start > end {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{}", meta.len()))
                .body(Body::empty())
                .unwrap();
        }
    }
    let len = if meta.len() == 0 { 0 } else { end - start + 1 };
    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        match tokio::fs::read(file).await {
            Ok(bytes) => Body::from(bytes[start as usize..(start + len) as usize].to_vec()),
            Err(_) => return StatusCode::NOT_FOUND.into_response(),
        }
    };
    let mut result = response(
        if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        },
        mime,
        len as usize,
        body,
        cache,
    );
    result
        .headers_mut()
        .insert(header::ETAG, etag.parse().unwrap());
    result
        .headers_mut()
        .insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    if partial {
        result.headers_mut().insert(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{}", meta.len())
                .parse()
                .unwrap(),
        );
    }
    result
}
use axum::response::IntoResponse;
