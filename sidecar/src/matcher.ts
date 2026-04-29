import type { Config, DanmuInfo } from './types.js';
import { DEFAULT_SING_PREFIX } from './types.js';

interface RawDanmu {
  uid: string;
  uname: string;
  content: string;
  medal_level: number;
  medal_name: string;
}

export type MatchResult =
  | { kind: 'song'; danmu: DanmuInfo }
  | { kind: 'cancel'; uid: string }
  | { kind: 'skip'; reason: string };

const CANCEL_PREFIX = '取消点歌';

export class Matcher {
  private config: Config;
  private lastByUid = new Map<string, number>();
  private compiled: RegExp;
  private blacklist: Set<string>;

  constructor(config: Config) {
    this.config = config;
    this.compiled = this.compilePattern(config.sing_prefix);
    this.blacklist = new Set(config.blacklist ?? []);
  }

  reload(config: Config): void {
    this.config = config;
    this.compiled = this.compilePattern(config.sing_prefix);
    this.blacklist = new Set(config.blacklist ?? []);
  }

  // Convert a human-friendly template into a RegExp.
  //   [space]  -> \s+ (one or more whitespace; consecutive [space] collapse)
  //   [song]   -> (.+?) capture group 1 = song name (matcher.match() trims)
  //   anything else -> literal (regex meta-chars auto-escaped)
  // Examples:
  //   "点歌[space][song]"  -> /^点歌\s+(.+?)$/
  //   "点歌:[song]"        -> /^点歌:(.+?)$/
  //   "点歌[space][space][song]" -> /^点歌\s+(.+?)$/  (collapsed)
  // Legacy Chinese placeholders [空格] / [歌曲] / [歌名] are also accepted
  // so existing configs keep working.
  static templateToRegex(template: string): RegExp {
    const tokens = template.split(/(\[space\]|\[song\]|\[空格\]|\[歌曲\]|\[歌名\])/i);
    let pattern = '';
    let lastWasSep = false;
    for (const tok of tokens) {
      if (!tok) continue;
      const lower = tok.toLowerCase();
      if (lower === '[space]' || tok === '[空格]') {
        if (!lastWasSep) {
          pattern += '\\s+';
          lastWasSep = true;
        }
      } else if (lower === '[song]' || tok === '[歌曲]' || tok === '[歌名]') {
        pattern += '(.+?)';
        lastWasSep = false;
      } else {
        pattern += tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        lastWasSep = false;
      }
    }
    if (!pattern.startsWith('^')) pattern = '^' + pattern;
    if (!pattern.endsWith('$')) pattern = pattern + '$';
    return new RegExp(pattern);
  }

  private compilePattern(pattern: string): RegExp {
    const p = pattern && pattern.trim() ? pattern : DEFAULT_SING_PREFIX;
    try {
      return Matcher.templateToRegex(p);
    } catch {
      return Matcher.templateToRegex(DEFAULT_SING_PREFIX);
    }
  }

  match(raw: RawDanmu): MatchResult {
    const { uid, uname, content, medal_level, medal_name } = raw;

    if (content.startsWith(CANCEL_PREFIX)) {
      this.lastByUid.delete(uid);
      return { kind: 'cancel', uid };
    }

    const m = this.compiled.exec(content);
    if (!m) return { kind: 'skip', reason: 'prefix mismatch' };

    let song: string;
    if (m.length > 1 && m[1] !== undefined) {
      song = m[1].trim();
    } else {
      song = content.slice(m.index + m[0].length).trim();
    }
    if (!song) return { kind: 'skip', reason: 'empty song name' };

    if (this.blacklist.has(song)) {
      return { kind: 'skip', reason: 'blacklisted' };
    }

    if (this.config.fans_level > 0 && medal_level < this.config.fans_level) {
      return { kind: 'skip', reason: `fans level too low: ${medal_level}<${this.config.fans_level}` };
    }

    const now = Math.floor(Date.now() / 1000);
    const last = this.lastByUid.get(uid);
    if (this.config.sing_cd > 0 && last !== undefined && now - last < this.config.sing_cd) {
      const remaining = this.config.sing_cd - (now - last);
      return { kind: 'skip', reason: `cooldown active, ${remaining}s left` };
    }
    this.lastByUid.set(uid, now);

    const danmu: DanmuInfo = {
      msg_id: `${now}_${uid}`,
      uid,
      uname,
      song_name: song,
      raw_msg: content,
      medal_level,
      medal_name,
      send_time: now,
    };
    return { kind: 'song', danmu };
  }
}
