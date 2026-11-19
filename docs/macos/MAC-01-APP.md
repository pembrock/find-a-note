# MAC-01 — локальное приложение Apple Silicon

Проверка: 20 ноября 2026. База — актуальная публичная `origin/main`,
`703b4752c092bb9a5a460be0939ee22d7a2e542e`. Ветка `feature/mac-01-app`.
Только MAC-01; MAC-02–06 не реализованы. Push, теги и релизы не выполнялись.

## Изменения

- Платформенные параметры вынесены в `platform_windows.go`,
  `platform_darwin.go`, `platform_other.go`. Windows сохраняет прежние DWM
  параметры и `%APPDATA%/Sonari.exe`; общий lifecycle и bindings сохранены.
- На Darwin используется системная рамка Cocoa и стандартные меню Wails
  Application/Edit/Window. Общий React скрывает HTML-кнопки окна только при
  `runtime.Environment().platform === "darwin"`.
- Production/dev plist закрепляют `io.github.pembrock.findanote`, ru/en,
  Retina и версию из `info.productVersion` в `wails.json` (оба поля bundle
  version равны `0.3.0`). Dev разрешает только local networking штатным ATS key.
- Deployment target plist/Mach-O — 11.0. Это техническая цель, а не проверенный
  минимум поддержки. Нативно проверена только указанная ниже macOS.
- Модель тренировок, MIDI, аудиодвижок, storage keys, updater schema и trust
  anchor не изменены. Автоустановка и физический MIDI на Darwin недоступны.

## Окружение

Apple M2, arm64; macOS 27.2.1 (26B131), Xcode 27.2 (27B52), SDK 27.2,
CLT 2418. Node 24.2.0, npm 11.3.0. Go приложения — 1.25.0,
`GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 GOTOOLCHAIN=auto`.
Wails CLI/module — 2.17.0. Установка CLI автоматически выбрала toolchain
Go 1.26.11; `wails doctor` показывает версию, которой собран CLI.
Зависимости и lockfiles не обновлялись.

Наблюдаемый production URL — `wails://wails/`. Проверялись локальные
production bundle и копия с тем же ID, без очистки профиля. Язык первого
запуска — русский; вручную выбран английский, который восстановился после
перезапуска. Полная инвентаризация профиля и его каталога оставлена MAC-03.

## Результаты

| Проверка | Результат и свидетельство |
| --- | --- |
| Baseline без изменений | **PASS**: arm64 .app собрался, WKWebView открыл упражнение, G4 дал «Верно», прогресс 1/20. Копия в `artifacts/mac-01/baseline/`. |
| `wails doctor`, `wails build -help` | **PASS**: окружение готово, CLI 2.17.0, цель darwin/arm64 поддержана. |
| `npm ci`, `npm run build` | **PASS**: lockfile сохранён; прежние предупреждения Radix `use client` и большого JS chunk. |
| `npm test` | **PASS**, 13/13. Первый sandbox-запуск не смог открыть IPC tsx; вне sandbox прошёл. |
| `go test ./...`, `go vet ./...` | **PASS**, в том числе после финальных изменений. |
| `go test -race ./internal/midi ./internal/update` | **FAIL** на Go 1.25.0: `runtime/race: package testmain: cannot find package`. **PASS** при явном `GOTOOLCHAIN=go1.26.11`, оба пакета. Это проверка общего кода, не CoreMIDI. |
| `npm run test:ui` | **NOT TESTED** по поведению: запуск команды завершился **FAIL**, все 62 сценария заблокированы до открытия страницы отсутствующим `/Applications/Microsoft Edge.app`. Edge и новые browser projects не добавлялись. |
| `wails dev` | **PASS**: dev frontend и нативное приложение собраны, Vite 5173 и Wails server 34115 запущены; `logs/dev.log`. Wails предупреждает о private API в debug/dev; это не production build. Остаточный dev-процесс завершён отдельно. |
| Production arm64 build | **PASS**, `CGO_ENABLED=1 wails build -platform darwin/arm64`; финальная сборка с `-skipbindings` исключает несвязанный generated diff. |
| plist, file, lipo, otool | **PASS**: plist валиден; ID `io.github.pembrock.findanote`; 0.3.0; только arm64; LC_BUILD_VERSION minos 11.0, SDK 27.2; системные Cocoa/WebKit dependencies. |
| Ad hoc signature | **PASS**, `codesign --verify --strict --deep --verbose=2`. Не доказывает доверие Gatekeeper. |
| Нативная русская тренировка | **PASS**: D4 → «Верно!», прогресс 1/20, ошибок 0; `screenshots/ru.png`. |
| Английская тренировка | **PASS**: смена языка не сбросила прогресс; E4 → “Correct!”, прогресс 2/20; `screenshots/en.png`. Финальный bundle также принял C4. |
| Окно и версия | **PASS**: системная рамка и три кнопки без HTML-дублей, меню Application/Edit/Window; fullscreen и Escape; About 0.3.0; закрытие/повторный запуск с восстановлением English. Cmd+Q использован для production-копии; отдельный dev-процесс потребовал cleanup. |
| Размеры | **PASS** для стартовой области контента 900×600 на Retina и визуальной проверки zoom/fullscreen. **NOT TESTED** точная полная матрица 760×560 / 1920×1032 и обоих языков во всех размерах; сохранены фактические снимки. |
| Minimize, Tab и drag | **NOT TESTED** полностью: minimize/Tab действия выполнены, но AX не дал достаточного подтверждения; drag и полная клавиатурная навигация отдельно не проверены. |
| Ассеты | **PASS**: frontend содержит 30 MP3 и существующие тексты Salamander/Tone; ассеты встраиваются в Go. Их наличие не доказывает слышимый звук. |
| Web Audio | **NOT TESTED** слуховая проверка, полифония, sleep/wake, физическое отсутствие сети — матрица MAC-03. |
| Профиль/локаль | **PASS** узкая проверка ручного English после перезапуска. **NOT TESTED** все storage keys, чистый профиль, системные локали и замена/перенос bundle — MAC-03. |
| Симулированный MIDI | **PASS** существующие manager Go tests и race на Go 1.26.11; нативная доставка виртуального MIDI не проверена. |
| Yamaha P-45 / Nektar SE25 | **NOT TESTED**: MAC-02 исключён, CoreMIDI не реализован; аппаратных проверок не было. |
| Windows checks | **NOT TESTED**: Windows host отсутствует. DWM/profile перенесены без изменения значений; Windows build/UI/WinMM аппаратно не заявляются. |
| Gatekeeper / DMG / notarization | **NOT TESTED**, MAC-04 исключён; карантин и системная защита не изменялись. |

## Локальные артефакты

Из корня checkout (игнорируемая Git директория `artifacts/`):

- `build/bin/find-a-note.app` — финальный production bundle.
- `artifacts/mac-01/native/Find a Note.app` — его локальная копия.
- `artifacts/mac-01/logs/` — build, dev, tests, race, plist, otool.
- `artifacts/mac-01/screenshots/` — ru.png, en.png, zoom.png,
  fullscreen.png, dev.png, about.png. Скриншоты показывают реальные нативные окна,
  не браузерные макеты. Dev и production используют один bundle ID.

SHA-256 финального Mach-O `Contents/MacOS/Find a Note`:
`da0f02d3845235fedda703aa46068d0bad09b8a603f34d486a3d25475292d61f`.
Это сумма исполняемого файла, не каталога `.app` и не релизного пакета.

## Ограничения

Это локальный первый порт, не готовый канал распространения. Слышимый звук,
физический MIDI, полная WebKit/profile матрица, минимальная macOS, Intel,
DMG, Gatekeeper и обновления не заявляются. Полная UI-матрица и Windows
regression требуют отдельного окружения. Ни production-ключи, ни `promo/`
не изменялись. Для следующего этапа нужна отдельная задача MAC-02.
