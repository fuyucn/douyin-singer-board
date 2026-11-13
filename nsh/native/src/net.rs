//! HTTP with response headers for TSX.
//!
//! NSH's TSX `fetch` hides `Set-Cookie` (a browser rule), so a plugin cannot
//! keep a server session even when it can log in. Rust's `fetch` returns the
//! whole response, headers included; this module hands the headers to the app.
use nsh_core::prelude::*;

/// One HTTP request with response headers, for plugins that keep a session.
#[module]
pub struct Net;

#[module]
impl Net {
    /// Performs one request and returns `{status, body, setCookie}` as JSON.
    /// `headersJson` is an object of string headers; an empty body sends none.
    pub async fn fetch_raw(
        method: String,
        url: String,
        headers_json: String,
        body: String,
    ) -> Result<String, String> {
        let mut request = HttpRequest::new(method, url);
        let parsed: serde_json::Value =
            serde_json::from_str(&headers_json).map_err(|e| e.to_string())?;
        if let Some(object) = parsed.as_object() {
            for (name, value) in object {
                if let Some(text) = value.as_str() {
                    request = request.header(name.clone(), text.to_string());
                }
            }
        }
        if !body.is_empty() {
            request = request.body(body);
        }
        let response = fetch(request).await.map_err(|e| e.to_string())?;
        let status = response.status();
        // Every Set-Cookie line: Windows/Linux yield one per header, macOS
        // joins them. Join with ", " so the plugin can search all of them.
        let cookies: Vec<&str> = response
            .head
            .headers
            .iter()
            .filter(|(name, _)| name.eq_ignore_ascii_case("set-cookie"))
            .map(|(_, value)| value.as_str())
            .collect();
        let set_cookie = if cookies.is_empty() {
            None
        } else {
            Some(cookies.join(", "))
        };
        let text = response.text();
        Ok(serde_json::json!({
            "status": status,
            "body": text,
            "setCookie": set_cookie,
        })
        .to_string())
    }
}

