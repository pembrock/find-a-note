# MAC-04 — упаковка Find a Note для Apple Silicon

Сборка 0.3.0 использует общий Go/Wails/React-проект. Bundle ID
`io.github.pembrock.findanote` и origin `wails://wails/` удерживают
существующий профиль WKWebView при переносе и ручном обновлении.

## Среда и повторение

Проверено на arm64, macOS 27.2.1 (26B131), Xcode 27.2 (27B52),
CLT 27.2.0.0.1792721180, macOS SDK 27.2, Apple clang 21.0.0.
Хостовый Go 1.25.0, сценарий выбирает Go 1.26.11,
Node 24.2.0, npm 11.3.0, Wails CLI и модуль 2.17.0.
Сценарий требует нативного Apple Silicon, Xcode или CLT с актуальным SDK,
Go с поддержкой выбора toolchain, Node 22+ и npm. Сеть может понадобиться
для получения закреплённых зависимостей и инструментов. Wails указывает
macOS 11.0+ для arm64. Здесь 11.0 проверяется в Mach-O и Info.plist как
deployment target. Старые версии macOS требуют отдельного запуска и приёмки.
[Wails CLI](https://v2.wails.io/docs/reference/cli/)

Из корня чистого checkout MAC-04:

```sh
GOTOOLCHAIN=go1.26.11 go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.0
./scripts/build-macos.sh
```

Сценарий использует `npm ci`, проверяет frontend и Go, строит release bundle
без devtools, добавляет лицензии, подписывает приложение ad hoc, валидирует
DMG и повторно проверяет приложение после монтирования. Встроенные файлы
frontend сравниваются побайтово с выходом Vite при production build tags.
Файловый образ создаётся стандартным `hdiutil` как сжатый HFS+ UDZO. Для
повторной сборки передайте новый каталог первым аргументом. Сборка
воспроизводима по шагам и версиям инструментов. Временные метаданные образа
могут менять его двоичный хеш.

`artifacts/mac-04/` содержит `Find a Note.app`,
`Find-a-Note-0.3.0-macOS-arm64.dmg`, `SHA256SUMS.txt`, `build.log`,
`logs/` и `screenshots/`. Контрольные суммы охватывают DMG и каждый обычный
файл внутри .app. В образ входят .app и ссылка на `/Applications`.

```sh
(cd artifacts/mac-04 && shasum -a 256 -c SHA256SUMS.txt)
```

## Установка, обновление и удаление

Используйте [короткую инструкцию](MAC-04-INSTALL.md). При обновлении завершите
работу приложения перед заменой bundle. Finder копирует bundle, а WKWebView
читает существующий профиль пользователя по стабильным bundle ID и origin.
При удалении bundle профиль остаётся на диске. Ручное обновление через DMG
используется для этой сборки.

## Gatekeeper

`codesign --verify --deep --strict` проверяет целостность ad hoc подписи.
Developer ID и нотариальное заверение требуют соответствующей программы Apple.
Проверяйте политику отдельно через `spctl --assess --type execute --verbose=4`
и `syspolicy_check distribution`. При проверке скачанного образа фиксируйте
`com.apple.quarantine` на DMG и на копии приложения. Системные исключения
зависят от версии macOS и политики администратора.
[Apple Developer ID](https://developer.apple.com/developer-id/)
[Сценарий открытия Apple](https://support.apple.com/guide/mac-help/mh40617/mac)

## Лицензии и исходники

Find a Note распространяется под GPL-3.0-only, Copyright (C) 2026 Kirill
Pasikuta. В `Contents/Resources/Licenses/` находятся GPL, лицензия Tone.js,
тексты CC BY 3.0 и атрибуция Salamander Grand Piano (Alexander Holm), а также
лицензии и уведомления модулей, выбранных Go для production Darwin arm64,
и production-зависимостей npm вместе с runtime Vite. Системные фреймворки
поставляются в macOS.

Распакуйте архив исходников MAC-04 и запустите команды сборки из
корня распакованного проекта. В checkout значение Git-ревизии записывается
в `build.log`. Для архива ревизия указана рядом в `SOURCE-REVISION.txt`. Для передачи сборки
подготовьте архив исходников с этого коммита и предоставьте соответствующие
исходники вместе с бинарным архивом. Публичный репозиторий служит адресом
проекта. Для текущей локальной сборки исходники берутся из локальной ветки.
[Репозиторий Find a Note](https://github.com/pembrock/find-a-note)

```sh
git archive --format=tar.gz --prefix=find-a-note-0.3.0/ \
  -o artifacts/mac-04/Find-a-Note-0.3.0-source.tar.gz HEAD
```

## Регрессии

```sh
cd frontend
npx playwright install chromium webkit
PLAYWRIGHT_BROWSER=chromium npm run test:ui
PLAYWRIGHT_BROWSER=webkit npm run test:ui
cd ..
```

Повторение CoreMIDI fixture и race описано в [MAC-02A](MAC-02A-LIFECYCLE.md).

## Результаты 20 ноября 2026

| Проверка | Итог |
| --- | --- |
| `npm ci`, frontend production, unit tests | **PASS**, 13/13. Vite выдал обычные предупреждения о размере chunk и директивах Radix. |
| Playwright Chromium | **PASS** в полном повторе, 62/62. Первоначальный прогон — **FAIL** (61/62): тест серии ответов не дождался итогового заголовка. Тест и приложение не менялись. |
| Playwright WebKit | **PASS**, 62/62. Оба браузерных набора проверяют виртуальное пианино и локализацию. |
| `go test ./...`, `go vet ./...`, `go test -race -count=2 ./...` | **PASS**, Go 1.26.11. |
| CoreMIDI lifecycle | **PASS**, нативный lifecycle fixture и 10 повторов Go suite с виртуальным источником; также оба прогона с race detector. |
| Production arm64 и лицензии | **PASS**. Mach-O arm64, deployment target 11.0, обе версии 0.3.0, прежний ID, ICNS, embedded frontend, проверенная ad hoc подпись, лицензии и атрибуция. |
| DMG и установка | **PASS**. Finder показал .app и ярлык Applications. Запуск из локального образа прошёл; копия через Finder (⌘C/⌘V по ярлыку) запустилась из `/Applications` после извлечения тома. Сам жест перетаскивания копию не создал, успешное перетаскивание не подтверждено. |
| Нативный интерфейс | **PASS**. Локальная .app, копия из образа и установленное приложение показали WKWebView, тренировку и виртуальную клавиатуру; системные меню Find a Note, Edit и Window доступны. |
| Профиль WKWebView | **PASS**. До установки, после запуска установленной копии и после замены bundle той же версии с запуском из Finder совпали хеши всех девяти существующих ключей `sonari.*`. В том числе язык, выбранная тренировка и настройки упражнения, звук, MIDI-вход и калибровка. Текущая серия ответов сбрасывается при новом запуске по существующим правилам приложения. База читалась в режиме read-only. |
| Gatekeeper для распространения | **FAIL**. На macOS 27.2.1 с активной политикой `spctl` отклонил .app во всех четырёх местах (код 3); `syspolicy_check distribution` указал ad hoc и отсутствие notary ticket (код 70). |
| Quarantine | **PASS** для воспроизведения проверки. Тестовая .app с вручную добавленным quarantine и .app из отдельно помеченного DMG вызвали системный prompt, а Launch Services сообщил о карантинном запуске и App Translocation. Помеченный DMG смонтировался без ручного исключения. |
| Точный текст системного prompt, скачивание браузером, «Открыть всё равно» | **NOT TESTED**. Системный агент не предоставил доступ к тексту диалога. Карантин был тестовым, исключение не применялось. |
| Windows / Edge / WinMM | **NOT TESTED**, Windows-хост отсутствует. |
| Физический MIDI, слуховая проверка аудио, Intel и более ранние macOS | **NOT TESTED**, только виртуальный источник и локальный Apple Silicon с указанной ОС. |

Журналы `build.log`, `logs/{webkit,chromium,chromium-repeat,race,coremidi,lifecycle}.log`
и `logs/gatekeeper*.log` хранят результаты. В `screenshots/dmg-finder.jpg`
виден установочный образ, в `screenshots/installed.jpg` — установленная копия.
Политика Gatekeeper и quarantine оригинальных артефактов не менялись.

Первый запуск целевого Go-теста потребовал явной линковки системного
UniformTypeIdentifiers. Wails уже добавляет этот фреймворк в production.
Сборку также временно остановила проверка отсутствующего MIT-текста в npm
архиве `react-remove-scroll-bar@2.3.8`. Сценарий использует существующую копию
лицензии в `licenses/`, которая совпадает с текстом автора.
[Источник MIT-лицензии](https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE)
