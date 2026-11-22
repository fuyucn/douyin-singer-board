# SUSUSongBoard

SongBoard is a native NSGo desktop app for collecting Douyin live song requests and syncing them to KuGou or NetEase Cloud Music playlists. `nsgo-app/` is the only maintained implementation and the source of new packages built from this repository.

## Develop and build

From the repository root:

~~~sh
cd nsgo-app
go tool nsgo dev
go test ./... -skip '^TestLiveDouyinConnection$'
go tool nsgo check
go tool nsgo build -target macos_arm64
go tool nsgo build -target windows_x64 -installers=false
~~~

- [Application guide](nsgo-app/README.md): workbench, platform login, data and tests.
- [Signed updates](nsgo-app/UPDATES.md): stable and preview signed installers, GH Proxy, appcasts, and the 0.43.3 stable update channel.
- [Migration contract](nsgo-app/PARITY.md): UI and behavior references, versioning and remaining acceptance gates.
- [Agent acceptance](docs/ACCEPTANCE.md): the required Functional AND Visual gates and their evidence standard.

The retired implementations are no longer built from this repository. Existing installations, data and releases are not removed by the source migration. NSGo reads and writes settings in SQLite. When adopting an existing database, it backs up the database before adding its own settings table and leaves the legacy tables intact.
