//! GitHub download route selection.
//!
//! Release assets redirect to `release-assets.githubusercontent.com`, which is
//! often throttled or unreachable from mainland China. Before a large download
//! we probe the direct URL with a small ranged request; if it fails or is too
//! slow, the gh-proxy.com mirror is tried first. The other route always stays
//! as a fallback, so a broken mirror never blocks users who can reach GitHub.

use std::time::{Duration, Instant};

pub const PROXY_PREFIX: &str = "https://gh-proxy.com/";

/// Size of the ranged probe request.
const PROBE_BYTES: u64 = 512 * 1024;
/// The direct probe must finish within this window, i.e. roughly >= 128 KiB/s
/// including connection setup and the github.com -> CDN redirect.
const PROBE_BUDGET: Duration = Duration::from_secs(4);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    Direct,
    Proxy,
}

impl Route {
    pub fn label(self) -> &'static str {
        match self {
            Route::Direct => "direct",
            Route::Proxy => "gh-proxy",
        }
    }

    pub fn apply(self, url: &str) -> String {
        match self {
            Route::Direct => url.to_string(),
            Route::Proxy => proxied(url),
        }
    }
}

fn is_github_url(url: &str) -> bool {
    url.starts_with("https://github.com/") || url.starts_with("https://api.github.com/")
}

/// Prefix a GitHub URL with the mirror. Non-GitHub URLs are returned unchanged.
pub fn proxied(url: &str) -> String {
    if is_github_url(url) {
        format!("{PROXY_PREFIX}{url}")
    } else {
        url.to_string()
    }
}

/// True when the first `PROBE_BYTES` of `url` download directly within budget.
async fn direct_is_fast(url: &str) -> bool {
    let Ok(client) = reqwest::Client::builder().timeout(PROBE_BUDGET).build() else {
        return false;
    };
    let started = Instant::now();
    let res = client
        .get(url)
        .header(
            reqwest::header::RANGE,
            format!("bytes=0-{}", PROBE_BYTES - 1),
        )
        .send()
        .await;
    let ok = match res {
        Ok(r) if r.status().is_success() => r.bytes().await.is_ok(),
        _ => false,
    };
    ok && started.elapsed() <= PROBE_BUDGET
}

/// Routes to try for `url`, best first.
pub async fn ordered_routes(url: &str) -> Vec<Route> {
    if !is_github_url(url) {
        return vec![Route::Direct];
    }
    if direct_is_fast(url).await {
        vec![Route::Direct, Route::Proxy]
    } else {
        vec![Route::Proxy, Route::Direct]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxies_only_github_urls() {
        assert_eq!(
            proxied("https://github.com/o/r/releases/download/v1/a.exe"),
            "https://gh-proxy.com/https://github.com/o/r/releases/download/v1/a.exe"
        );
        assert_eq!(proxied("https://example.com/a"), "https://example.com/a");
    }
}
