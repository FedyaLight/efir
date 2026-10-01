use efir_desktop::server::{bind, Hub};
use std::{path::PathBuf, sync::Arc};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let root = PathBuf::from(args.next().unwrap_or("web".into()));
    let first = args.next().unwrap_or("8765".into()).parse()?;
    let (port, listener, router) = bind(root, first, Arc::new(Hub::new(|_, _| {}))).await?;
    println!("http://localhost:{port}");
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}
