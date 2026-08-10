// Fetch Douyin live room metadata (nickname + title + id_str) by web_rid.
// Used by the frontend to preview the streamer name as the user types the
// room ID — no live connection needed.

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct DouyinRoomInfo {
    pub id_str: String,
    pub nickname: String,
    pub title: String,
    pub status: u32, // 2 = live, 4 = offline (per Douyin convention)
}

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/// Extract a value from escaped-JSON HTML payload, e.g.
/// `roomId\":\"7300000000000000000\"` → `7300000000000000000`.
/// Returns the FIRST non-placeholder occurrence — Next.js streaming SSR
/// fills some fields with `$undefined` initially and the real value
/// later in the same chunk.
fn extract_field(html: &str, key: &str) -> Option<String> {
    let needle = format!("{key}\\\":\\\"");
    let mut search_start = 0;
    while let Some(rel) = html[search_start..].find(&needle) {
        let value_start = search_start + rel + needle.len();
        let rest = &html[value_start..];
        if let Some(end) = rest.find("\\\"") {
            let value = &rest[..end];
            // Skip Next.js streaming placeholders ($undefined, $L1, etc.)
            // and any empty match.
            if !value.is_empty() && !value.starts_with('$') {
                return Some(value.to_string());
            }
            search_start = value_start + end;
        } else {
            return None;
        }
    }
    None
}

fn extract_status(html: &str) -> Option<u32> {
    // Pattern: "status\":4" (number, not string)
    let needle = "status\\\":";
    let start = html.find(needle)? + needle.len();
    let rest = &html[start..];
    let end = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    rest[..end].parse().ok()
}

#[tauri::command]
pub async fn douyin_room_info(web_rid: String) -> Result<Option<DouyinRoomInfo>, String> {
    let trimmed = web_rid.trim().to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }

    // First request to get ttwid cookie
    let client = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(10))
        .cookie_store(true)
        .build()
        .map_err(|e| format!("client: {e}"))?;

    // Visit homepage to get ttwid
    let _ = client
        .get("https://live.douyin.com/")
        .send()
        .await
        .map_err(|e| format!("ttwid fetch: {e}"))?;

    // Room IDs are digits only — no encoding needed.
    if !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("room id must be digits only".to_string());
    }
    let url = format!("https://live.douyin.com/{}", &trimmed);
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("room fetch: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("HTTP {} {}", res.status(), url));
    }
    let html = res
        .text()
        .await
        .map_err(|e| format!("body decode: {e}"))?;

    let id_str = extract_field(&html, "roomId").unwrap_or_else(|| trimmed.clone());
    let nickname = extract_field(&html, "nickname").unwrap_or_default();
    let title = extract_field(&html, "title").unwrap_or_default();
    let status = extract_status(&html).unwrap_or(0);

    if nickname.is_empty() && id_str == trimmed {
        // Couldn't extract anything useful — likely room not found
        return Ok(None);
    }

    Ok(Some(DouyinRoomInfo {
        id_str,
        nickname,
        title,
        status,
    }))
}
