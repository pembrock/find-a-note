# MAC-00 · Техническое задание на порт Find a Note для macOS

## Исходная точка и границы

Find a Note — настольный тренажёр чтения нот с виртуальным пианино и физическим MIDI-входом. База анализа — публичный [v0.3.0](https://github.com/pembrock/find-a-note/releases/tag/v0.3.0), коммит `852a69714b433ef78911d229c84dd362edce09f7`. Сейчас поддерживается Windows x64. Цель первого порта — нативный Apple Silicon (`darwin/arm64)). Минимальную версию macOS определить по фактическим SDK, зависимостям и проверенной матрице. Intel и универсальная сборка потребуют отдельной приёмки.

MAC-00 поставляет только этот документ. MAC-01 и далее — будущие задачи. Вести их от актуальной публичной `main` в отдельных ветках, учитывая [AGENTS.md](../../AGENTS.md). Беречь пользовательские правки, `promo/`, существующие сборки и конфигурацию Windows, локальные артефакты и ключи. Для публикации, тегов и push требуется отдельное разрешение владельца.

## Архитектура и карта платформенных зависимостей

| Участок | Факт в v0.3.0 | Решение для macOS |
| --- | --- | --- |
| [main.go](../../main.go), [app.go](../../app.go), [version.go](../../version.go), [wails.json](../../wails.json) | Wails встраивает `all:frontend/dist`. Go и React читают версию из `info.productVersion`. До запуска Wails проверяется режим helper. При старте создаются MIDI manager и updater, `OnBeforeClose` защищает установку, `OnShutdown` останавливает сервисы. Windows options задают оформление DWM и профиль WebView2. | Сохранить общий lifecycle, bindings и asset server. Изолировать настройки платформы в узких функциях или файлах с build tags, если это уменьшает связанность. Импорт Wails `pkg/options/windows` сам по себе не доказывает ошибку компиляции Darwin. Проверить Cocoa title bar, меню приложения, перетаскивание, Cmd+Q, закрытие, повторное открытие, сворачивание, zoom и fullscreen. Предпочесть системные кнопки окна на macOS, исключить их дублирование с HTML-кнопками. |
| [frontend/src](../../frontend/src) | Общая React/TypeScript-модель `model.ts` и `learning.ts`, VexFlow, настройки, виртуальная клавиатура, мастер калибровки, Tone.js и двуязычный UI. `main.tsx` вызывает Wails runtime для кнопок окна. `style.css` использует `--wails-draggable`. | Один frontend, общие алгоритмы и ассеты. Если нужен сигнал о платформе, сначала проверить имеющийся Wails runtime Environment. Добавлять узкий флаг для оконных различий только при отсутствии подходящего существующего API. |
| [internal/midi](../../internal/midi) | `manager.go` держит состояние и очереди. `driver_windows.go` загружает `winmm.dll`, вызывает `midiIn*` через `x/sys/windows`. `driver_other.go` с `!windows` возвращает пустой список. `driver_windows_test.go` проверяет перечисление WinMM. | Добавить реализацию `NativeDriver` для Darwin с cgo. Переиспользовать `Driver`, `Input`, очередь и Wails-контракт. Сузить условие заглушки, например до `!windows && (!darwin || !cgo)`, с соответствующими тестами выбора файлов. |
| [internal/update](../../internal/update), [update_bridge.go](../../update_bridge.go) | GitHub provider, манифест и сервис общие. `start_windows.go` работает только на Windows amd64. Используются реестр per-user NSIS, DACL, ожидание процесса, `MoveFileEx`, NSIS stage, код ошибки диска и MessageBox. Заглушка `start_unsupported.go` отключает проверку на прочих целях, включая macOS. | Сохранить заглушку в первых этапах. После решения по обновлениям переиспользовать `UpdateProvider`, `Launcher` и доверенный публичный ключ. Разделить build tags симметрично только при появлении реализации Darwin. |
| [build/windows](../../build/windows), [scripts/build-release.ps1](../../scripts/build-release.ps1), [scripts/write-third-party-notices.ps1](../../scripts/write-third-party-notices.ps1) | PE, WebView2, per-user NSIS, Portable EXE, `npm.cmd`, Windows-теги Go, SHA‑256 и вызов подписчика. В Git отсутствует `.github/workflows`. Релиз выкладывается вручную через GitHub, исходники соответствуют тегу. | Отдельный сценарий Darwin и `build/darwin/` под Wails v2. Не править Windows packaging для первого порта. Использовать существующие version source и правила верификации. |

Зависимости брать из [go.mod](../../go.mod) и [frontend/package-lock.json](../../frontend/package-lock.json). В базе Wails CLI и модуль 2.17.0, директива Go 1.25.0, README требует Node.js 22+. Применить `go version` и `go env GOTOOLCHAIN` для фактических требований модулей. Wails v2 использует системный WKWebView на Darwin, а его исходник `internal/frontend/desktop/darwin/frontend.go` задаёт `wails://wails/`. В проекте отсутствует собственная конфигурация профиля Darwin. Для задач MAC-01–04 достаточно существующих интерфейсов, дополненных узким внутренним cgo-адаптером. Формат транзакции установки понадобится только при разработке автообновлений.

## MIDI через CoreMIDI

Контракт в `internal/midi/manager.go` уже покрывает `Driver.List() ([]Device, error)`, `Driver.Open(Device, func(Packet)) (Input, error)` и `Input.Start/Close/Check() error`. `Device` имеет текущий `ID`, видимое `Name` и сохраняемый `Identity`. `Packet` содержит `Message uint32` и `Closed bool`. Manager владеет одним выбранным входом, периодически обновляет список примерно раз в две секунды, отбрасывает события старой генерации, подавляет повторные Note On и восстанавливает подключение только по единственному совпадению. `midi:state` несёт ревизию и сессию, `midi:note` — тип, MIDI-номер, velocity и канал 1–16. Клиентская логика находится в [useMidi.ts](../../frontend/src/useMidi.ts), [MIDIDeviceMenu.tsx](../../frontend/src/MIDIDeviceMenu.tsx), [calibration.ts](../../frontend/src/calibration.ts) и [useCalibration.ts](../../frontend/src/useCalibration.ts).

### Спецификация адаптера

1. Добавить `internal/midi/driver_darwin.go` и небольшой native bridge внутри того же пакета. Маркировать Darwin+cgo и исходники C/Objective‑C; применить системные CoreMIDI и CoreFoundation. Проверить доступность API в SDK выбранного deployment target. Начать с `MIDIInputPortCreateWithProtocol` для MIDI 1.0, `MIDIPortConnectSource`, перечисления `MIDIGetNumberOfSources` / `MIDIGetSource` и свойств через `MIDIObjectGet*Property`. Разбирать только поддерживаемые MIDI 1.0 Channel Voice UMP и собирать байты в существующий формат `status | data1<<8 | data2<<16`. Если выбран старый API с `MIDIPacketList`, обеспечить корректный потоковый разбор, включая running status и realtime interleave. Выбор API и причину записать в MAC-02. [Core MIDI Services](https://developer.apple.com/documentation/coremidi/midi-services) · [MIDIInputPortCreateWithProtocol](https://developer.apple.com/documentation/coremidi/midiinputportcreatewithprotocol%28_%3A_%3A_%3A_%3A_%3A%29)
2. Читать человекочитаемое имя источника; исключать offline endpoints, если это надёжно определяется. Разделить идентификатор текущего подключения и сохраняемую идентичность. Кандидат для `Identity` — `coremidi:<unique-id>` по `kMIDIPropertyUniqueID`, с проверкой уникальности и стабильности на переподключении, повторном входе и другом USB-порту. Порядковый номер и имя непригодны как долговременные ключи. При отсутствии надёжного ID разрешить ручной вход с временной идентичностью и запретить автоматическое применение долгоживущих профилей. Если текущего поля `Identity` недостаточно для различения временного и постоянного ID, добавить только явно необходимый признак с совместимым Windows default. Не переносить WinMM ID на macOS и не угадывать совпадение по имени.
3. При `Open` повторно проверить соответствие выбранному endpoint, создать ресурсы и установить callback. `Start` подключает исходный endpoint, `Check` обнаруживает исчезновение или устаревший handle. Для первой версии использовать имеющийся polling. Callback уведомлений CoreMIDI имеет смысл только после измерения задержки hotplug или если этого требует корректность проверки. Не создавать ещё один механизм восстановления выбора.
4. В callback передавать только скопированные значения. Использовать безопасный числовой дескриптор, например `runtime/cgo.Handle` с контролируемым временем жизни, без передачи Go-указателя для хранения в C. Callback краткий, без блокирующего I/O, вызовов UI и закрытия порта. `Close` идемпотентен, отключает источник, освобождает порт и клиент, предотвращает доступ к освобождённому контексту при гонке callback; удалять handle после гарантии отсутствия обращений. Разобрать partial failure в Open/Start, повторный Close, quit, sleep/wake и быстрые переключения. Освобождать полученные CF-объекты по правилам владения. Если teardown нельзя гарантировать при выбранной модели, отработать его отдельным native-тестом до интеграции.
5. Поддержать Note On/Off, Note On с velocity 0, каналы, velocity 1–127, аккорды и CC120/123. Оставить полифонию, подавление повторов, сброс аудио при смене MIDI-сессии и калибровку у существующих компонентов. Не трактовать педаль CC64, SysEx или MIDI 2.0 как ноты. Проверить гонки, насыщение очереди, снятие удержания при unplug/mute и stale callback после смены источника. Сообщения backend отдавать существующими кодами, новые пользовательские коды переводить в обоих словарях, числовой OSStatus оставлять в диагностике.

### Аппаратная проверка

- Yamaha P‑45 имеет USB TO HOST для MIDI. На Mac подключить USB с кабелем передачи данных, открыть Audio MIDI Setup → MIDI Studio, проверить источник и события в Find a Note. Выключить транспонирование и octave shift; ожидаемые границы стандартной клавиатуры A0–C8 (21–108). Проверить аккорд и отключение при удержании. Не делать общего вывода о драйвере Yamaha без проверки конкретных macOS, подключения и модели. [Характеристики Yamaha P-45](https://jp.yamaha.com/products/musical_instruments/pianos/p_series/p-45/specs.html) · [Проверка MIDI Apple](https://support.apple.com/en-euro/102047)
- Для Nektar SE25 производитель заявляет class-compliant USB и поддержку Mac. Проверить источник, крайние клавиши с указанием octave shift, кнопки octave shift, velocity, аккорды и reconnect. Сравнить `Identity` до и после перезапуска и unplug. Тест обычных нот не должен требовать DAW-расширений. [Характеристики Nektar SE25](https://nektartech.com/se25-midi-controller/)
- Для обоих записать модель, macOS, прямое подключение или USB-хаб, увиденное имя, шаги и наблюдения. Проверки виртуальным MIDI или mock не заменяют физического устройства. Совместимость обеих моделей с портом сейчас **NOT TESTED**.

## Audio и WKWebView

[audio.ts](../../frontend/src/audio.ts) создаёт один Tone.Context и Tone.Sampler. 30 локальных MP3 Salamander Grand Piano загружаются через asset server по `/audio/salamander/` и декодируются Web Audio. Нет сетевого источника банка. [useAudio.tsx](../../frontend/src/useAudio.tsx) хранит уровень и режим звука по источнику, очищает удержание при смене устройства/сессии, калибровке, blur и pagehide. MIDI Note On не заменяет жест разблокировки Web Audio. Пианино работает в поддержанном звуковом диапазоне A0–C8; калибровка может видеть MIDI 0–127.

В нативном WKWebView проверить первую загрузку через `wails://wails/`, успешное чтение/декодирование MP3 и первую слышимую ноту после клика или клавиатурной активации «Включить звук». Вызов `resume()` должен начинаться в обработчике жеста, до длительного асинхронного ожидания. Проверить состояния running/suspended и восстановление после фона, minimize и sleep/wake. Даже running не считать доказательством слышимого звука. Если WebKit требует доработки, локализовать её на границе запуска контекста или asset delivery. Не заменять Tone.js и не ослаблять политики воспроизведения глобально. Playwright WebKit полезен для регрессий; обязательна проверка внутри сборки Wails. [WebKit, возобновление AudioContext в WKWebView](https://bugs.webkit.org/show_bug.cgi?id=240646)

Приёмка включает одиночные ноты с разной velocity, аккорд с независимым отпусканием, удержание до естественного затухания и Note Off, mute/громкость, отключение удерживаемой клавиши, смену входа и языка без создания второго контекста, тихую калибровку, выход и повторный запуск без сети. Сохранить файлы, контрольные суммы и условия [Salamander](../../frontend/public/audio/salamander/ATTRIBUTION.txt) (Alexander Holm, CC BY 3.0) и [Tone.js](../../frontend/public/audio/TONE-LICENSE.md) (MIT).

## Настройки, локализация и жизненный цикл

Windows явно использует `%APPDATA%\Sonari.exe` и origin `http://wails.localhost/` — профиль legacy Sonari указан в `main.go`. Данные — WebView localStorage, а не файлы настроек Go. Ключи:

| Ключ | Смысл |
| --- | --- |
| `sonari.language.v1` | Явное `ru` / `en`, строка. |
| `sonari.settings.v2`, чтение legacy `sonari.settings.v1` | Диапазон, ключ, альтерации, количество заданий, проверка и показ обозначений. |
| `sonari.training.v1` | Режим тренировки и расширение набора. |
| `sonari.keyboard.labels.v1`, `sonari.keyboard.hint.v1` | Подписи и подсветка виртуальной клавиатуры. |
| `sonari.settings.sections.v1` | Раскрытые секции настроек. |
| `sonari.audio.v1` | Уровень и предпочтения по источнику, включая явный mute. |
| `sonari.midi.input.v1` | JSON identity или `null` для виртуального входа. |
| `sonari.midi.calibration.v1` | Профили границ по identity и список уже предложенных калибровок. |

Сохранить storage schema. В MAC-01 выбрать стабильный bundle identifier (предложение `io.github.pembrock.findanote`, проверить итоговый Info.plist), а в MAC-03 зафиксировать реально наблюдаемые origin, механизм WKWebsiteDataStore и путь данных этого bundle на тестовой macOS. Исходник Wails задаёт custom scheme, но фактический каталог WebKit и работоспособность localStorage после выхода/перемещения .app требуют теста. Не закладывать жёстко предполагаемые пути `~/Library/WebKit` или `~/Library/Application Support`. Данные разработки и production могут жить раздельно. Проверить чистый профиль, сохранение каждого ключа, quit Cmd+Q, запуск из Finder и из нового пути, обновление с тем же bundle ID, повреждённые значения, запрет записи и перезапуск с подключённым и отключённым MIDI. Если стандартный WKWebView не даёт устойчивого origin, сначала проверить настройку Wails/WebKit. Только при подтверждённом блокере проектировать узкий Darwin persistence adapter с миграцией, атомарной записью и каталогом пользователя.

Локализация в [i18n.tsx](../../frontend/src/i18n.tsx) и `locales/{ru,en}.json`. Явный выбор выше `navigator.language`, `ru-*` выбирает русский, прочие локали — английский. Автовыбор не записывается как явный. Проверить в WKWebView системный русский, английский и третью локаль, ручное переключение, сохранение и переоткрытие. Проверить меню, ошибки MIDI, диалоги, нативные подписи при наличии, accessibility labels и длинные строки. Смена языка не сбрасывает упражнение, устройство или звук; буквенные обозначения, до–ре–ми и названия октав остаются независимо управляемыми. Для двуязычных заметок сохранять формат `English` и `Русский` в одном `notes`, с fallback на обычный текст. [I18N-01](../I18N-01.md)

## Сборка и распространение без платных инструментов

На Apple Silicon использовать нативное окружение и бесплатные Xcode Command Line Tools, Go и Node.js. Команды ниже выполняются на Mac в последующих этапах. Сверить `wails build -help` с закреплённой версией, так как онлайн-справка Wails v2 может показывать другой минорный релиз.

```sh
xcode-select --install                    # только если CLT отсутствуют
xcode-select -p
xcrun --sdk macosx --show-sdk-version
uname -m
go version
go env GOOS GOARCH CGO_ENABLED GOTOOLCHAIN
node --version
npm --version
go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.0
export PATH="$(go env GOPATH)/bin:$PATH"
wails doctor
wails dev                                 # dev, из корня. Завершить перед сборкой
CGO_ENABLED=1 wails build -platform darwin/arm64
find build/bin -maxdepth 2 -name '*.app' -print
```

Wails v2 документирует цель `darwin/arm64` и требует Xcode CLI. Заявленный Wails минимум платформы не является минимумом Find a Note. Для релиза записать версии Go, Node, Wails, macOS и SDK, проверить `LSMinimumSystemVersion` в plist и `LC_BUILD_VERSION` (или `LC_VERSION_MIN_MACOSX`) у всех Mach-O, реально запустить на минимальной заявленной версии. Команды ниже используют обнаруженный `APP`; сравнить `CFBundleShortVersionString` с `wails.json`, зафиксировать политику `CFBundleVersion` для новых релизов и отсечь шаблонные значения и неподходящий bundle ID. [Установка Wails v2](https://v2.wails.io/docs/v2.15.0/gettingstarted/installation/) · [CLI Wails v2](https://v2.wails.io/docs/reference/cli/)

```sh
APP='build/bin/Find a Note.app'             # уточнить путь по find
plutil -lint "$APP/Contents/Info.plist"
plutil -p "$APP/Contents/Info.plist"
EXE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")
file "$APP/Contents/MacOS/$EXE"
lipo -archs "$APP/Contents/MacOS/$EXE"
otool -l "$APP/Contents/MacOS/$EXE"
otool -L "$APP/Contents/MacOS/$EXE"
find "$APP/Contents" -type f -print
open "$APP"
```

Проверить icon, целостность bundle, ресурсы в `Contents/Resources` и в Go embed, включая локализацию, все 30 MP3 и third-party notices. Создать отдельный скрипт в MAC-04, собирающий по lockfile и вычисляющий notice из фактических Darwin production-зависимостей Go и npm. Сохранить GPL-3.0-only, тексты лицензий, атрибуцию и соответствующий исходный код с инструкциями сборки и необходимыми материалами по GPLv3. Свериться со [скриптом Windows](../../scripts/write-third-party-notices.ps1), [LICENSE](../../LICENSE) и [RELEASE-01](../RELEASE-01.md).

Создать новый staging-каталог с единственным проверенным `.app` и по необходимости ссылкой на `/Applications` для Finder. Для чистой сборки, если нужна локальная подпись, проверить Wails output и подписать ad hoc (`codesign --sign -`) после финальной сборки, изнутри наружу для вложенных исполняемых компонентов. `codesign --verify --strict --deep --verbose=2 "$APP"` проверяет структуру подписи. Создать DMG бесплатным системным `hdiutil`:

```sh
VERSION='<info.productVersion из wails.json>'
STAGE=$(mktemp -d)
ditto "$APP" "$STAGE/Find a Note.app"
ln -s /Applications "$STAGE/Applications"
mkdir -p "artifacts/macos-$VERSION"
DMG="artifacts/macos-$VERSION/Find-a-Note-$VERSION-macOS-arm64.dmg"
hdiutil create -srcfolder "$STAGE" -volname 'Find a Note' -format UDZO "$DMG"
hdiutil verify "$DMG"
shasum -a 256 "$DMG"
hdiutil attach -readonly -nobrowse "$DMG"
# Скопировать .app в отдельный тестовый каталог, затем проверить запуск и подпись.
# Отмонтировать по фактическому устройству/точке монтирования из вывода attach.
```

Для приёмки установить перетаскиванием в отдельную тестовую папку приложений под пользователем, проверить первый запуск из Finder после скачивания через браузер в чистый профиль, сохранить результат `xattr -p com.apple.quarantine` и `spctl --assess --type execute --verbose=4 "$APP"`, повторить запуск после отключения DMG. Проверить удаление только тестовой копии приложения через Finder и сохранение профиля при повторной установке. Документация об удалении пользовательских данных должна показывать только фактически подтверждённый путь и требовать осознанного выбора пользователя.

Gatekeeper оценивает скачанное приложение с учётом quarantine и политики системы. Ad hoc не удостоверяет издателя и не заменяет Developer ID или notarization. По правилам владельца Developer ID и платные сервисы не подключать. Без Developer ID и нотариального штампа возможны блокировка на первом запуске, ручное подтверждение через Privacy & Security → Open Anyway, если разрешено, или полный отказ на управляемых Mac. У Apple обычный внешний канал использует Developer ID, hardened runtime и нотариальное заверение. Результат обычного запуска локальной сборки не заменяет проверку скачанного артефакта. Не отключать Gatekeeper, не удалять quarantine и не обещать автоматическое прохождение. Если политика запрещает запуск, записать **FAIL** для сценария и предложить исходную сборку или согласовать условия распространения с владельцем. [Безопасный запуск приложений Apple](https://support.apple.com/en-us/102445) · [Developer ID](https://developer.apple.com/developer-id/) · [Нотаризация](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

## Стратегия автообновлений и безопасность

### Реализация Windows

[github.go](../../internal/update/github.go) открывает GitHub `releases/latest`, принимает стабильный `vX.Y.Z`, ограничивает HTTPS-редиректы и имена файлов. [service.go](../../internal/update/service.go) проверяет новизну версии, размер ассета по метаданным, подпись Ed25519 на исходных байтах и каноничность манифеста. Загрузка ограничена размером и контекстом и сверяется по SHA‑256. В production проверка запускается сразу и затем раз в час. Фоновый сбой сохраняет уже найденный выпуск. Закрытие отменяет запросы. [manifest.go](../../internal/update/manifest.go) фиксирует schema 1, product `find-a-note`, version, notes и packages. У пакета поля `os, arch, kind, name, size, sha256, method`. Лимиты 32 КиБ для манифеста, до 4096 байт для notes, до 16 пакетов, до 256 МиБ для пакета. Подпись занимает 64 байта. Поля и порядок канонических структур не менять.

Выбор Windows строгий по `windows/amd64`, kind/method/имени. NSIS использует `/UPDATESTAGE`, а извлечённый EXE сравнивается с подписанным Portable. [start_windows.go](../../internal/update/start_windows.go) повторно проверяет данные в helper, готовит резервную копию, ждёт выхода родителя, заменяет EXE, перезапускает и ждёт сигнала готовности React. При ошибке восстанавливает прошлый EXE; профиль WebView2 остаётся вне операции. Успех и откат отображаются через `FrontendReady`. См. [UPDATE-01](../UPDATE-01.md) и [UPDATE-04](../UPDATE-04.md).

### Предложение для macOS

1. **Первый порт** использует `unsupported` и инструкцию ручной установки из GitHub Release. UI должен показывать поддержку честно. Если понадобится проверка доступности обновления до готовности native installer, добавить режим «проверка и ручная установка» после согласования. Имеющийся `Launcher.Supported()` управляет всем сервисом, поэтому одного no-op `Start` недостаточно для режима только проверки. Не показывать «готово к перезапуску», если установка недоступна.
2. **Совместимый канал.** Для стабильных релизов с Darwin сохранить общий тег и один подписанный манифест, включающий оба прежних пакета Windows. Windows клиенты смотрят только `latest`, поэтому отдельный стабильный macOS-only latest может сломать обнаружение подходящего Windows-пакета. В MAC-05 подтвердить старым Windows клиентом принятие schema 1 с дополнительной записью того же формата. Проектный пример `darwin/arm64/dmg`, имя `Find-a-Note-X.Y.Z-macOS-arm64.dmg`. `method` должен отделять ручной DMG от будущего механизма замены bundle; согласовать литералы до выпуска и принимать только строгие сочетания. `cmd/update-manifest` сегодня подписывает только Windows, потребуется расширение будущего релизного инструмента без удаления стандартных Windows entries. Для Intel/universal заранее решить, как валидировать и выбирать архитектуру. SHA256SUMS нужен для ручной сверки; updater доверяет хешу из подписанного манифеста.
3. **Транзакция bundle.** Допускать только локальный, записываемый каталог назначения вне DMG/карантинной трансляции, без повышения прав. Сначала проверить подпись, версию, архитектуру, имя и размер пакета, затем скачанные байты. Helper получает пакет в защищённом каталоге текущего пользователя, повторяет проверки перед обработкой и запускается вне заменяемого .app. Монтировать DMG только для чтения. Разрешить ровно ожидаемый bundle и проверять разрешённое дерево, реальные пути, symlinks и владельца без обхода пути и произвольного исполнения. Скопировать полный bundle с metadata, ресурсами и атрибутами; проверить bundle ID, версию, Mach-O, подпись/политику macOS и отсутствие несовместимых файлов. Не изменять карантинные атрибуты в обход системной политики. Подготовить sibling на том же томе, сериализовать установку, проверить свободное место и права до выхода приложения.
4. **Атомарность, перезапуск, восстановление.** Документировать транзакцию и fsync/запись состояния там, где поддерживается. Проверить возможность атомарного обмена двух соседних bundle на целевой FS средствами macOS. Если нужен двухшаговый rename, зафиксировать промежуточное окно и обеспечить журнал/восстановление после прерывания каждого шага. Не заменять отдельный Mach-O внутри установленного bundle. После подтверждения пользователя ждать корректного выхода, сохранить предыдущий bundle, запустить через стандартный механизм macOS, подтвердить готовность с одноразовой меткой, тайм-аутом и проверкой ожидаемого процесса. При ошибке восстановить и запустить старый bundle. Предусмотреть отказ записи, App Translocation, app running, read-only/другой том, конкурентное обновление, interruption/power loss и неисправный новый запуск. Профиль пользователя сохранить отдельно от bundle. Если Gatekeeper блокирует безопасный перезапуск, оставить ручное обновление.
5. **Доверие.** Сохранить публичный trust anchor из `internal/update/service.go`. SHA‑256 публичного ключа `86a0fddb3a48dff12a62bea92e1efe46d8a97bdf7a0921f47aa827e8be9f11bb`. Ed25519 подтверждает происхождение манифеста и хеш пакета, а Gatekeeper принимает собственное решение о запуске. Закрытый ключ хранится у владельца вне Git и артефактов. Не переносить его на Mac, не запрашивать его содержимое, не генерировать новый production key, не менять trust anchor. Для тестов использовать существующий тестовый контур или отдельные тестовые данные, а production signing выполняет владелец существующим процессом. Проверенные подписанные файлы публикуются только по явному разрешению.

## План работ и критерии этапов

| Этап и зависимости | Изменения | Команды и критерий готовности | Артефакт и границы |
| --- | --- | --- | --- |
| **MAC-01 · Первый .app**. Актуальная `main`, CLT, Go, Node и Wails v2 | Проверить baseline `main.go`, `wails.json`, bundle templates, окно и общий React. Добавить Darwin plist и узкую настройку платформы по фактической необходимости. Сохранить виртуальное пианино и UI. | `wails doctor`, `wails dev`, `wails build -platform darwin/arm64`, команды проверки Mach-O и plist выше. В нативном .app без MIDI выполнить тренировку в двух языках и закрыть/открыть окно. | Локальный arm64 .app, минимальный коммит, журнал build и скриншоты. Поддержку устройства и Gatekeeper не заявлять до проверок. |
| **MAC-02 · CoreMIDI** после MAC-01 | `internal/midi/driver_darwin*`, build tags заглушки, тесты разбора, teardown, ID, hotplug; сохранить manager и Wails события. | `go test ./internal/midi`, `go test -race ./internal/midi`, нативная сборка и матрица MIDI ниже. Подключение, полифония, калибровка, unplug и восстановление без зависших нот. | .app с CoreMIDI, тесты, журнал mock и отдельные результаты P‑45 и SE25. Невыполненные аппаратные тесты отметить. |
| **MAC-03 · WebKit, профиль, локализация** после MAC-01/02 | Проверить `audio.ts`, `useAudio.tsx`, `useCalibration.ts`, `i18n.tsx`, `main.go`, Playwright config. Исправлять подтверждённые платформенные отличия точечно. | Полная базовая матрица ниже, нативный повторный запуск, смена системной локали, ручной выбор, тест без сети и с зафиксированным профилем. | Доказательства сохранения ключей, проверенные параметры WKWebView и результаты матрицы. Без переезда Windows-профиля. |
| **MAC-04 · Подготовка DMG** после MAC-03 | Darwin packaging script и docs, Info.plist, GPL/notice, стабильный version source. | Чистая production-сборка, `plutil`, `file`, `lipo`, `codesign`, `hdiutil`, `shasum`, установка/удаление, проверка quarantine на отдельном тестовом Mac. | .app, DMG, SHA256SUMS, текст лицензий и отчёт Gatekeeper. Без платных сертификатов и публикации. |
| **MAC-05 · Совместимый канал обновления** после MAC-04 и согласования политики релиза | В `internal/update/manifest.go`, `cmd/update-manifest`, тестах и `update_bridge.go` специфицировать выбор macOS, проверку и ручной сценарий. | `go test ./internal/update ./cmd/update-manifest`, локальный GitHub-like feed, Windows regression с прежним клиентом, tamper/версия/архитектура/неподходящий пакет. | Тестовый манифест, fixture пакеты и отчёт совместимости. Производственный ключ остаётся вне Mac. |
| **MAC-06 · Опциональный Darwin updater** после MAC-05 и подтверждения владельцем | Только при безопасном запуске и доказуемом восстановлении добавить native launcher/helper, разделение build tags и тесты транзакции. | `go test -race ./internal/update`, нативные сценарии с тестовыми профилями и томами, update/restart/rollback и инъекции отказов. Windows suite без регрессий. | Протокол транзакции, helper, журнал отказов и итоговый отчёт. До выполнения критериев использовать ручную установку. |

## Программа тестирования и приёмка

Из корня Mac checkout подготовить frontend для `go:embed`. Текущий Playwright config использует Chromium с каналом `msedge` и ru-RU. Для parity на Mac установить Edge, или добавить совместимый opt-in проект/переменную для bundled Chromium и отдельного Playwright WebKit, оставив Windows default и сохраняемые fixtures. Для WebKit явно указать `browserName: "webkit"` без `msedge`. Playwright WebKit не заменяет системный WKWebView.

```sh
(cd frontend && npm ci && npm run build && npm test && npm run test:ui)
go test ./...
go vet ./...
go test -race ./internal/midi ./internal/update
wails build -platform darwin/arm64
```

| Область | PASS при | FAIL при |
| --- | --- | --- |
| Автоматические проверки | Команды возвращают 0, проверены общие fixtures, Darwin-адаптер под cgo и Windows-регрессии на Windows. | Любое воспроизводимое падение, неверный выбор build tags. |
| Нативный GUI | Реальный .app тренирует без MIDI; обе локализации проходят при 760×560, 900×600 и на большом экране, эквивалентном 1920×1032, с учётом HiDPI и доступной области. Проверены меню, Tab/клавиши, zoom, Cmd+Q и повторный запуск. | Пустой WebView, нерабочий lifecycle, обрезка текста или недоступные кнопки. |
| MIDI и калибровка | Отдельный отчёт на каждую модель. Без MIDI доступна виртуальная клавиатура. После unplug при удержании нота прекращается, выбранный уникальный источник восстанавливается, ambiguous выбирается вручную, профили и границы сохраняются. | Зависшая нота, неправильный порт/канал, пропуск Note Off, потеря профиля или зависание. |
| Аудио | Реально слышен банк офлайн, одна нота и аккорд, удержание и независимое отпускание работают, переключения входа и языка не ломают звук. | Пустой банк, активированный контекст без звука, утечка голосов, калибровка с нежелательным звуком. |
| Профиль/локаль | До и после реального quit/relaunch и замены .app значения совпадают. Новая установка корректно выбирает ru/en, явный выбор сильнее системного, режим до–ре–ми независим. | Язык/настройки теряются или калибровка переносится на другое устройство. |
| Пакет и security | arm64, версия, bundle ID, заметки, ресурсы, лицензии и сумма совпадают. DMG монтируется, установка/удаление проверены. Зафиксировано реальное поведение Gatekeeper. | Неверный Mach-O, отсутствующий ресурс, нарушение целостности или блокировка в заявленном сценарии. |
| Обновления | На MAC-05 старый Windows клиент видит свои пакеты, отказ на подмене. На MAC-06 оба жизненных цикла проходят с сохранением профиля в изолированном сценарии. | Ослаблена проверка или невозможно восстановить запуск после неуспешной замены. |

Для отчёта каждого этапа использовать PASS / FAIL / NOT TESTED с причиной и отдельными строками для симуляции и реальных устройств. Первую версию допускать к заявленному каналу распространения после MAC-01–04 и фиксации всех обязательных ограничений. На MAC-00 проверки ограничены статическим анализом исходников, сверкой внешних требований, ссылками и Git diff. Реальный arm64 build, WKWebView persistence/autoplay, Gatekeeper, USB и работу helper оценит Mac исполнитель.

## Известные риски и решения

- **WKWebView** — custom scheme, профили dev/prod, autoplay и sleep могут вести себя иначе. Проверять чистый профиль, копию bundle, сохранение и звук в первую очередь.
- **CoreMIDI ID и время жизни callback** — несколько источников, изменение ID, hotplug и поздние события. Проверить с обеими моделями, отсекать старые сессии, гарантировать освобождение ресурсов и запретить неоднозначное автоподключение.
- **Apple Silicon / минимум macOS** — версия CLT/SDK, доступность CoreMIDI API, deployment target и архитектуры зависимостей. Документировать фактически проверенные версии.
- **Gatekeeper** — бесплатный канал может требовать подтверждения или блокироваться управляемой политикой. Проверять скачанный DMG, явно описать ограничения и держать исходную сборку доступной.
- **Обновление .app** — App Translocation, read-only том, частичный rename и риск раскола GitHub latest. Сначала ручное обновление. Нативную транзакцию включать после испытаний и согласования.

## START HERE — Instructions for Codex on macOS

Скопируй весь следующий промпт в новый сеанс Codex на MacBook. Передай вместе с ним этот документ или путь к нему в доступном checkout.

```text
Работаем над портом Find a Note для Apple Silicon в pembrock/find-a-note.
Прочитай AGENTS.md и docs/macos/MAC-00-PORTING-PLAN.md целиком.
Начни с MAC-01. Не принимай успех сборки за доказательство работы MIDI,
Web Audio, хранения профиля или Gatekeeper. Отвечай по-русски.

1. Проверь git status --short --branch, HEAD и origin/main. Если план
   передан отдельным файлом, используй его с актуальной публичной main.
   Создай отдельную локальную feature/mac-01-app от актуальной main.
   Сохрани локальные правки, promo/, существующие сборки и ключи.
   Не публикуй ветку, теги или релизы без разрешения владельца.
2. Проверь uname -m, xcode-select -p, SDK, go version, go env
   GOOS GOARCH CGO_ENABLED GOTOOLCHAIN, Node и npm. Установи бесплатные
   CLT и Wails CLI 2.17.0 при необходимости. Сверь wails doctor и wails
   build -help. Не обновляй Go-модуль Wails, фронтенд-зависимости или
   lockfile без подтверждённого блокера. Используй нативный arm64.
3. Изучи main.go, app.go, version.go, wails.json, update_bridge.go,
   internal/midi/{manager,driver_other,driver_windows}.go,
   internal/update/{service,manifest,start_unsupported,start_windows}.go,
   frontend/src/{main.tsx,style.css,i18n.tsx,model.ts,learning.ts,audio.ts}.
   Проверь Wails Darwin templates и runtime в закреплённом модуле.
   Сначала попробуй baseline. Сохрани единый React/TypeScript frontend,
   общие MIDI события и lifecycle. Выбери стабильный bundle identifier,
   проверь Info.plist, version metadata и нативные оконные операции.
   Изолируй platform options. Проверь, нужно ли условное отображение
   оконных кнопок в общем frontend.
   Сохрани Windows DWM, профиль WebView2 и поведение обновлений.
4. Запусти npm ci, npm run build и npm test в frontend, go test ./...,
   go vet ./..., wails dev, затем CGO_ENABLED=1 wails build -platform
   darwin/arm64. Проверь .app через plutil, file, lipo и otool. Открой
   Finder-ом; проверь виртуальное пианино, упражнение, два языка, размеры
   и Cmd+Q. Запиши фактические версии macOS/SDK, результат и путь к .app.
5. Закрой MAC-01 отдельным локальным коммитом и отчётом. Для MAC-02
   реализуй Darwin+cgo NativeDriver поверх CoreMIDI, сохрани Driver/Input
   и Packet manager. Не копируй WinMM и не переписывай тренировку.
   Проверь endpoint identity, lifecycle callback, MIDI 1.0, velocity,
   полифонию, устройство после unplug, калибровку и сброс удерживаемых нот.
   Отдельно проверь реальный Yamaha P-45 и Nektar SE25, если доступны.
6. MAC-03 фиксирует origin и профиль WKWebView, Web Audio unlock,
   повторный запуск, оба языка и тесты. MAC-04 добавляет бесплатную
   упаковку .app/DMG и проверяет Gatekeeper на скачанной копии.
   На этих этапах оставь автоустановку Mac отключённой. MAC-05/06
   выполняй отдельно по плану после согласования канала релизов.
   Не меняй schema 1 или production trust anchor. Не генерируй и не
   переноси production-ключ. Не отключай Gatekeeper или quarantine.
7. Для каждого этапа укажи PASS / FAIL / NOT TESTED, причины,
   параметры профиля и окружения без секретов, отдельно hardware/mock,
   пути артефактов, ветку, HEAD и Git status. Сверь Windows-регрессии
   по AGENTS.md на Windows при изменении общего кода; без доступного
   Windows запуска отметь NOT TESTED. Остановись перед публикацией.
```
