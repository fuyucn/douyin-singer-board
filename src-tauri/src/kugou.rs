// KuGou search command. Hits a public KuGou search endpoint server-side
// (avoids browser CORS) and returns the top result as the bag of fields the
// PC client's `kugou://play?p=<base64-json>` deep link expects.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KuGouSong {
    pub filename: String,
    pub hash: String,
    pub size: String,
    pub duration: String,
    pub bitrate: String,
    pub isfilehead: String,
    pub privilege: String,
    pub album_id: String,
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn strip_em(s: &str) -> String {
    s.replace("<em>", "").replace("</em>", "")
}

fn pick(top: &Value, keys: &[&str]) -> String {
    for k in keys {
        if let Some(v) = top.get(*k) {
            let s = value_to_string(v);
            if !s.is_empty() {
                return strip_em(&s);
            }
        }
    }
    String::new()
}

#[tauri::command]
pub async fn kugou_search(keyword: String) -> Result<Option<KuGouSong>, String> {
    let kw = keyword.trim();
    if kw.is_empty() {
        return Ok(None);
    }

    let url = reqwest::Url::parse_with_params(
        "https://songsearch.kugou.com/song_search_v2",
        &[
            ("keyword", kw),
            ("page", "1"),
            ("pagesize", "5"),
            ("userid", "-1"),
            ("clientver", ""),
            ("platform", "WebFilter"),
            ("tag", "em"),
            ("filter", "2"),
            ("iscorrection", "1"),
            ("privilege_filter", "0"),
        ],
    )
    .map_err(|e| format!("url: {e}"))?;

    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("client: {e}"))?;

    let body: Value = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("http: {e}"))?
        .json()
        .await
        .map_err(|e| format!("decode: {e}"))?;

    let lists = body
        .pointer("/data/lists")
        .and_then(|v| v.as_array());
    let Some(lists) = lists else { return Ok(None) };
    let Some(top) = lists.first() else { return Ok(None) };

    let filename_raw = pick(top, &["FileName", "filename"]);
    let hash = pick(top, &["FileHash", "hash"]).to_uppercase();
    let size = pick(top, &["FileSize", "size"]);
    let bitrate = pick(top, &["Bitrate", "bitrate"]);
    let album_id = pick(top, &["AlbumID", "album_id"]);

    let duration_secs: u64 = top
        .get("Duration")
        .or_else(|| top.get("duration"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let duration_us = (duration_secs * 1_000_000).to_string();

    if hash.is_empty() {
        return Ok(None);
    }

    let filename = if filename_raw.ends_with(".mp3") {
        filename_raw
    } else {
        format!("{filename_raw}.mp3")
    };

    Ok(Some(KuGouSong {
        filename,
        hash,
        size,
        duration: duration_us,
        bitrate,
        isfilehead: "100".to_string(),
        privilege: "5".to_string(),
        album_id,
    }))
}
