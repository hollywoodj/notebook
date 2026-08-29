mod api_client;
mod backend;
mod cli;
mod commands;
#[cfg(test)]
mod fake;
mod local;

use anyhow::Result;
use clap::Parser;
use notebook_core::{Database, NotebookService};

use crate::api_client::ApiClient;
use crate::backend::NotebookBackend;
use crate::cli::Cli;
use crate::local::LocalBackend;

fn main() -> Result<()> {
    let cli = Cli::parse();
    let json_out = cli.output.eq_ignore_ascii_case("json");

    let backend: Box<dyn NotebookBackend> = if !cli.api.is_empty() {
        Box::new(ApiClient::new(&cli.api)?)
    } else {
        let db = match &cli.db {
            Some(path) => Database::open(path)?,
            None => Database::open_default()?,
        };
        Box::new(LocalBackend::new(NotebookService::new(db)))
    };

    commands::run(
        backend.as_ref(),
        &cli.command,
        json_out,
        &mut std::io::stdout().lock(),
    )
}
