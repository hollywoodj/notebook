use notebook_api::ServerConfig;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    notebook_api::init_tracing();
    notebook_api::run(ServerConfig::default()).await
}
