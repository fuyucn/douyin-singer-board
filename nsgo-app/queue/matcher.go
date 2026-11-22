package queue

import (
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
)

const DefaultTemplate = "点歌[space][song]"
const cancelPrefix = "取消点歌"

type Config struct {
	Template         string
	FansLevel        int
	SingCooldown     time.Duration
	MaxSongsPerUser  int
	BlacklistSongs   []string
	BlacklistSingers []string
}

type ChatMessage struct {
	ID         string
	UserID     string
	Nickname   string
	Content    string
	MedalName  string
	MedalLevel int
}

type Song struct {
	ID         string
	UserID     string
	Nickname   string
	Name       string
	RawMessage string
	MedalName  string
	MedalLevel int
	CreatedAt  time.Time
	Manual     bool
}

type Result struct {
	Added     *Song
	Cancelled int
	Ignored   string
}

type Matcher struct {
	mu               sync.Mutex
	config           Config
	pattern          *regexp.Regexp
	blacklistSongs   map[string]struct{}
	blacklistSingers []string
	lastByUser       map[string]time.Time
	sequence         uint64
	queue            []Song
}

func New(config Config) (*Matcher, error) {
	pattern, err := compileTemplate(config.Template)
	if err != nil {
		return nil, err
	}
	matcher := &Matcher{config: config, pattern: pattern, blacklistSongs: map[string]struct{}{}, blacklistSingers: append([]string(nil), config.BlacklistSingers...), lastByUser: map[string]time.Time{}}
	for _, name := range config.BlacklistSongs {
		matcher.blacklistSongs[normalize(name)] = struct{}{}
	}
	return matcher, nil
}

func compileTemplate(template string) (*regexp.Regexp, error) {
	template = strings.TrimSpace(template)
	if template == "" {
		template = DefaultTemplate
	}
	var pattern strings.Builder
	groupCount, separatorPrevious := 0, false
	for template != "" {
		switch {
		case strings.HasPrefix(template, "[space]") || strings.HasPrefix(template, "[空格]"):
			token := "[space]"
			if strings.HasPrefix(template, "[空格]") {
				token = "[空格]"
			}
			if !separatorPrevious {
				pattern.WriteString("\\s+")
			}
			template = template[len(token):]
			separatorPrevious = true
		case strings.HasPrefix(template, "[song]") || strings.HasPrefix(template, "[歌曲]") || strings.HasPrefix(template, "[歌名]"):
			token := "[song]"
			if strings.HasPrefix(template, "[歌曲]") {
				token = "[歌曲]"
			} else if strings.HasPrefix(template, "[歌名]") {
				token = "[歌名]"
			}
			pattern.WriteString("(.+?)")
			groupCount++
			template = template[len(token):]
			separatorPrevious = false
		default:
			_, size := firstRune(template)
			pattern.WriteString(regexp.QuoteMeta(template[:size]))
			template = template[size:]
			separatorPrevious = false
		}
	}
	if groupCount > 1 {
		return nil, fmt.Errorf("song template may contain only one song placeholder")
	}
	if groupCount == 0 {
		pattern.WriteString(".*")
	}
	return regexp.Compile("^" + pattern.String() + "$")
}

func firstRune(value string) (rune, int) {
	for _, current := range value {
		return current, len(string(current))
	}
	return 0, 0
}

func (m *Matcher) Match(chat ChatMessage) Result {
	m.mu.Lock()
	defer m.mu.Unlock()
	content := strings.TrimSpace(chat.Content)
	if strings.HasPrefix(content, cancelPrefix) {
		removed := m.removeUserLocked(chat.UserID)
		return Result{Cancelled: removed}
	}
	match := m.pattern.FindStringSubmatch(content)
	if match == nil {
		return Result{}
	}
	name := content
	if len(match) > 1 {
		name = strings.TrimSpace(match[1])
	}
	if name == "" {
		return Result{Ignored: "歌名为空"}
	}
	if _, blocked := m.blacklistSongs[normalize(name)]; blocked {
		return Result{Ignored: "歌曲在黑名单中"}
	}
	for _, singer := range m.blacklistSingers {
		if singer != "" && strings.Contains(normalize(name), normalize(singer)) {
			return Result{Ignored: "歌手在黑名单中"}
		}
	}
	if m.config.FansLevel > 0 && chat.MedalLevel < m.config.FansLevel {
		return Result{Ignored: fmt.Sprintf("粉丝团等级不足（当前 %d，要求 %d）", chat.MedalLevel, m.config.FansLevel)}
	}
	m.sequence++
	if chat.ID == "" {
		chat.ID = fmt.Sprintf("%d_%s_%d", time.Now().Unix(), chat.UserID, m.sequence)
	}
	song := Song{ID: chat.ID, UserID: chat.UserID, Nickname: chat.Nickname, Name: name, RawMessage: chat.Content, MedalName: chat.MedalName, MedalLevel: chat.MedalLevel, CreatedAt: time.Now()}
	m.queue = append([]Song{song}, m.queue...)
	return Result{Added: &song}
}

func (m *Matcher) AddManual(name string) (Song, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	name = strings.TrimSpace(name)
	if name == "" {
		return Song{}, fmt.Errorf("enter a song name first")
	}
	if _, blocked := m.blacklistSongs[normalize(name)]; blocked {
		return Song{}, fmt.Errorf("song is blacklisted")
	}
	for _, singer := range m.blacklistSingers {
		if singer != "" && strings.Contains(normalize(name), normalize(singer)) {
			return Song{}, fmt.Errorf("singer is blacklisted")
		}
	}
	m.sequence++
	song := Song{ID: fmt.Sprintf("manual_%d_%d", time.Now().Unix(), m.sequence), UserID: "manual", Nickname: "主播", Name: name, RawMessage: name, CreatedAt: time.Now(), Manual: true}
	m.queue = append([]Song{song}, m.queue...)
	return song, nil
}

func (m *Matcher) RemoveByID(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for index, song := range m.queue {
		if song.ID == id {
			m.queue = append(m.queue[:index], m.queue[index+1:]...)
			return true
		}
	}
	return false
}

func (m *Matcher) Reconfigure(config Config) error {
	pattern, err := compileTemplate(config.Template)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.config = config
	m.pattern = pattern
	m.blacklistSongs = map[string]struct{}{}
	m.blacklistSingers = append([]string(nil), config.BlacklistSingers...)
	for _, name := range config.BlacklistSongs {
		m.blacklistSongs[normalize(name)] = struct{}{}
	}
	return nil
}

func (m *Matcher) Config() Config {
	m.mu.Lock()
	defer m.mu.Unlock()
	config := m.config
	config.BlacklistSongs = append([]string(nil), m.config.BlacklistSongs...)
	config.BlacklistSingers = append([]string(nil), m.config.BlacklistSingers...)
	return config
}

func (m *Matcher) Clear() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := len(m.queue)
	m.queue = nil
	clear(m.lastByUser)
	return count
}

func (m *Matcher) Queue() []Song {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Song(nil), m.queue...)
}

func (m *Matcher) removeUserLocked(userID string) int {
	count := 0
	remaining := m.queue[:0]
	for _, song := range m.queue {
		if song.UserID == userID && !song.Manual {
			count++
			continue
		}
		remaining = append(remaining, song)
	}
	m.queue = remaining
	return count
}

func normalize(value string) string { return strings.ToLower(strings.TrimSpace(value)) }
