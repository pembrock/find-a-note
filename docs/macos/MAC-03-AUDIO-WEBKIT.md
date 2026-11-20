# MAC-03 · Аудио, WKWebView, настройки и интерфейс

Проверка: 20 ноября 2026. База `feature/mac-02-coremidi`,
`cf2432d5eb1e46b537677fc34000df535d1bdfcc`.
Рабочая ветка `feature/mac-03-audio-webkit`. Только MAC-03.
MAC-04–06, push, публикации и работа с production keys не выполнялись.

## Реализация и изменения

`audio.ts` создаёт один Tone.Context с `latencyHint: interactive`,
`lookAhead: 0`, один Tone.Sampler и Gain. Закреплённый Tone.js 15.1.22
передаёт `resume()` нативному AudioContext. `activate()` начинает resume
синхронно в обработчике пользовательского действия, до await. MIDI сам по
себе не является жестом разблокировки. Первая виртуальная нота инициирует
resume, но `noteOn` до состояния ready может быть пропущен: при locked
нужно сначала нажать «Включить звук» либо повторить ноту после разблокировки.
Это не обещание слышимого первого MIDI Note On сразу после запуска.

Банк — 30 MP3 `/audio/salamander/*.mp3`, загружаемые через локальный Wails
asset server и `go:embed all:frontend/dist`. Внешнего URL банка нет.
Salamander, Alexander Holm, CC BY 3.0, Tone.js MIT и GPL проекта сохранены;
сэмплы, лицензии и зависимости не изменялись. Локальный список SHA-256:
`artifacts/mac-03/samples.sha256`.

Голоса учитываются по source/key; velocity преобразуется в gain.
Note Off освобождает высоту после отпускания последнего её владельца;
release sampler 0.65 секунды. `useMidi` отсекает старые сессии, переключение
входа немедленно вызывает stop, `useAudio` сбрасывает голоса при смене
источника/сессии, mute, калибровке, blur и скрытии страницы. При pagehide
движок освобождается. При состоянии контекста, отличном от running,
снимаются голоса; возвращение из suspended требует доступного resume.
Смена языка не пересоздаёт движок и не меняет звуковые предпочтения.
Tone.js и training/MIDI алгоритмы не переписаны.

Подтверждённая причина переноса «Первые ноты · 5 нот»: ширина 193 px
ограничивалась унаследованным `max-width: 165px`. Только для training trigger
ограничение снято и добавлен nowrap. На узком окне остаётся ширина 177 px.
Добавлена проверка одной строки и отсутствия внутреннего overflow в обеих
локализациях на всех трёх размерах.

WebKit не наследует вычисленное `user-select` так, как Chromium. Запрет
выделения задан элементам явно, существующие исключения для input,
textarea/contenteditable/textbox сохранены. На Darwin включён штатный
`mac.Preferences.TabFocusesLinks`: без него Tab пропускал кнопки/переключатели.
Autoplay policy не ослаблялась. Windows platform options не менялись.

## Реально слышимый звук

Следующие результаты сообщил владелец приложения: он лично прослушал
нативную macOS-версию на MacBook Apple Silicon. Это **не автоматические
тесты Codex** и не результаты физического MIDI-контроллера.

| Сценарий виртуальной клавиатуры | Итог |
| --- | --- |
| Одиночные ноты | **USER-VERIFIED PASS** |
| Одновременные ноты / аккорды | **USER-VERIFIED PASS** |
| Удержание нот | **USER-VERIFIED PASS** |
| Прекращение звучания после отпускания | **USER-VERIFIED PASS** |

Codex не слушал аудиовыход и не выполнял loopback capture. Статус running,
вызов start/stop и доставка MIDI не считаются доказательством слышимого звука.
Подтверждение владельца не привязано к SHA-256 финального MAC-03 bundle;
аудиодвижок и банк в MAC-03 не менялись.

## WKWebView и профиль

Production URL реально показан AX нативного приложения: `wails://wails/`.
Закреплённый Wails 2.17.0 (`internal/frontend/desktop/darwin/WailsContext.m`)
создаёт WKWebViewConfiguration, регистрирует scheme handler `wails` и не
подменяет websiteDataStore на nonPersistent. Используется стандартное
persistent хранилище WebKit. Приложение не задаёт свой каталог Darwin.

Фактически обнаруженные файлы этой машины:

```text
~/Library/WebKit/io.github.pembrock.findanote/WebsiteData/Default/
  IvmfgDu54eb_AMwCTAo-_MPS60Dd9DSy6nK89k_y2yc/
  IvmfgDu54eb_AMwCTAo-_MPS60Dd9DSy6nK89k_y2yc/origin
  IvmfgDu54eb_AMwCTAo-_MPS60Dd9DSy6nK89k_y2yc/LocalStorage/localstorage.sqlite3
```

`origin` содержит scheme/host wails/wails; SQLite `ItemTable` содержит
`sonari.*`, значения представлены UTF-16LE. Файлы читались read-only,
напрямую БД не редактировалась. Это наблюдаемый путь, не контракт для
hardcode и не инструкция удаления пользовательских данных.

Соседний hash-каталог `PxLzH5T83Sa-mkpm9nl--j__jfC-tAmmzUNdE125uUs`
содержит отдельный origin `wails://wails.localhost:34115` и отдельные значения.
Это соответствует dev-преобразованию Wails frontend.go; Vite-тесты используют
ещё один origin `http://127.0.0.1:5173`, не production профиль.
Bundle ID `io.github.pembrock.findanote` стабилен в обоих plist. Смена ID
может отделить профиль; она не является миграцией и в MAC-03 не выполнялась.
Изоляция новым ID и чистый системный профиль **NOT TESTED**.

| Проверка production storage | Итог |
| --- | --- |
| Язык, training, settings v2 (включая октавы и независимые названия), labels, hint, audio, MIDI identity, calibration, sections | **PASS**, все 9 фактически сохранённых ключей прочитаны и сравнены |
| Ручное ru → en во время тренировки | **PASS**, текущая нота и прогресс сохранены; остальные storage values не изменились |
| Cmd+Q и запуск новой production сборки из другого пути | **PASS**, значения совпали, язык en восстановился |
| Перемещение тестовой `.app` с прежним ID и повторный запуск | **PASS**, интерфейс загрузился с прежними настройками |
| Замена старого тестового bundle новым с прежним ID | **PASS**, после запуска и выхода все значения совпали с исходным снимком |
| Возврат исходных ru и custom training после проверки | **PASS**, итоговый снимок полностью равен исходному |
| Повреждённые/старые данные и disjoint octaves | Проверяются существующим браузерным набором; это не native filesystem fault injection |
| Запрет записи, новый bundle ID, чистый OS user | **NOT TESTED**, пользовательский профиль не очищался и не повреждался |

Снимки значений (локально, без включения в Git):
`artifacts/mac-03/profile-{before,after-move,restored,after-replacement}.json`.
Снимок `profile-final.json` после финального нативного UI-прогона также
полностью совпал с исходным.
Сохранённые MIDI identity и калибровка не доказывают physical USB reconnect.
В окне наблюдалось восстановленное `SE25 MIDI1 / Connected`, но физические
сценарии переключения/отключения этим не подтверждаются.

## Локализация и UI

`i18n.tsx`: сохранённые ru/en сильнее navigator.language; ru-* → ru,
остальные → en. Автовыбор не записывается. Обозначения нот и название
октавы хранятся независимо от языка. Схема storage не менялась.
Браузерные проверки охватывают ru-RU/en-US/fr-FR, ручной выбор, reload,
сохранение упражнения, динамическую калибровку и два словаря. Настоящая
смена системного языка macOS **NOT TESTED**: системные настройки не менялись.

Нативно проверены Cocoa frame без HTML-дублей, Application/Edit/Window,
Cmd+Q, повторный запуск, русский и английский интерфейс, fullscreen/возврат,
доступная панель настроек и виртуальное пианино. Реальные снимки:
`artifacts/mac-03/screenshots/native-{ru,fullscreen-ru,first-notes-ru}.png`.
Стартовое окно — 900×600 content с системной рамкой; Retina screenshot
включает title bar. Fullscreen проверен на встроенном экране; точные
760×560 и 1920×1032 **нативно NOT TESTED**, эти размеры проверяются
автоматически в Chromium/WebKit. В финальной сборке **PASS**: Tab последовательно фокусирует закрытие
настроек, секцию Общие, язык, секцию Звук и sound switch. Полный traversal
всех контролов и диалогов остаётся **NOT TESTED**.

## Playwright и повторение

Default `msedge` сохранён, включая Windows, locale ru-RU, один worker,
весь прежний набор assertions и Vite server. `PLAYWRIGHT_BROWSER` принимает
только `msedge`, `chromium`, `webkit`; неверное значение завершает config
ошибкой. Chromium и WebKit используют браузеры закреплённой версии
Playwright; Edge на Mac не обязателен. Ни один тест не удалён/пропущен.
WebKit Playwright не равен системному WKWebView.

```sh
cd frontend
PLAYWRIGHT_BROWSERS_PATH="$PWD/../artifacts/mac-03/browsers" npx playwright install chromium webkit
PLAYWRIGHT_BROWSERS_PATH="$PWD/../artifacts/mac-03/browsers" PLAYWRIGHT_BROWSER=chromium npm run test:ui
PLAYWRIGHT_BROWSERS_PATH="$PWD/../artifacts/mac-03/browsers" PLAYWRIGHT_BROWSER=webkit npm run test:ui
# Windows default остаётся: npm.cmd run test:ui
```

Первый Chromium: 61/62, гонка теста клика вне меню Radix. После повторного
открытия теперь ожидается focus выбранной option до внешнего клика;
проверка фактического закрытия не ослаблена. Принудительный клик по inert
body-потомку заменён обычным hit-tested кликом по html в координатах brand;
Playwright снова ожидает стабильность цели. Первый WebKit: 44 PASS,
18 FAIL, включая 11 невозможных запусков после исчезновения пользовательского
browser cache. Изолированный cache исключает эту внешнюю зависимость.
Аудиотесты используют настоящие декодированные MP3, AudioParam и source
start/stop, но симулированный Wails MIDI bridge. Внешние запросы блокируются
с первой загрузки. Добавлена диагностика AudioContext при сбое и быстрые
повторные нажатия. Причина аудиосбоев WebKit доказана логом:
первоначальный test route блокировал локальные blob workers Tone clock
(два `blob:http://127.0.0.1:5173/...`). Route теперь разрешает только
origin `http://127.0.0.1:5173`, включая его blob; внешние origin по-прежнему
заблокированы. Без изменения движка WebKit audio suite прошёл 7/7. Это проверка Web Audio, не слуховая приёмка.

Дополнительный полный WebKit прогон после починки worker: 55 PASS / 7 FAIL.
Он выявил разницу фокуса кнопок при клике: диалог запоминал body вместо
вызвавшей его кнопки. Обе кнопки открытия теперь явно получают focus до
открытия, и существующий dialog cleanup возвращает его корректно. Изменены
только обработчики UI, не updater protocol или Darwin update support;
MAC-05/06 не реализуются. Пять целевых focus/selection сценариев прошли.

Тесты macOS используют Command-Left / Command-Shift-Right вместо
Windows Home/Shift-End для реального выделения того же текста.
В Playwright WebKit на Darwin для обхода controls используется Option-Tab
([сочетание Apple Safari](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac));
в Chromium и Windows остаётся Tab. Assertions порядка фокуса, outline,
закрытия и возврата фокуса не изменены. Нативный WKWebView отдельно прошёл
обычный Tab с Preferences.TabFocusesLinks; browser shortcut не подменяет
нативную проверку. Целевые 2/2 keyboard scenarios прошли.

## Оставшаяся ручная проверка

Базовые четыре USER-VERIFIED сценария повторять без причины не нужно.
Для остальных сценариев владелец может выполнить короткую последовательность:

1. Запустить финальную `.app`, при необходимости «Включить звук». Проверить
   первую ноту и быстрый повтор; повторить запуск с отключённой сетью.
2. Подключить физический MIDI, включить его звук; удержать аккорд, отпустить
   по одной, сменить ru/en. Удерживая ноту, сменить физический вход и вынуть
   USB. Отдельно подтвердить MIDI-индикатор и прекращение слышимого звука.
3. После blur/minimize вернуть окно; затем выполнить реальный sleep/wake
   Mac, при необходимости разблокировать звук и проверить новое нажатие.
   Записать running/locked UI отдельно от слышимого результата.
4. Проверить Tab/Shift+Tab, Enter/Space/Escape по настройкам и меню в
   финальном bundle. В мастере калибровки переключить язык на каждом шаге,
   убедиться, что границы и этап сохранены, а ноты калибровки беззвучны.

Sleep/wake, физические unplug/смена входа, звук после blur/языка/нового
запуска и физическое отключение сети **NOT TESTED** с прослушиванием:
эти сценарии владелец не подтверждал, аудиовыход Codex не измерял.
Windows suite/build/WinMM **NOT TESTED**, Windows runner отсутствует.
macOS minimum/Intel, Gatekeeper, DMG и updater — вне MAC-03.


## Итоговые проверки и артефакты

Окружение: arm64, macOS 27.2.1 (26B131), SDK 27.2, Node 24.2.0,
npm 11.3.0, Wails CLI/module 2.17.0, Tone.js 15.1.22,
Playwright 1.65.0 (Chromium 158 / WebKit 27.2).

| Проверка | Итог |
| --- | --- |
| Frontend production build | **PASS**, стандартные предупреждения Radix use client / chunk size |
| Frontend unit tests | **PASS**, 13/13 |
| Полный Playwright Chromium | **PASS**, 62/62, финальный `chromium-final.log` |
| Быстрые повторные нажатия и outside dismissal Chromium | **PASS**, отдельный финальный 2/2 и полный набор |
| WebKit Web Audio | **PASS**, 7/7, реальные MP3/source start-stop, симулированный MIDI |
| Полный Playwright WebKit | **PASS**, 62/62, `webkit-final.log` |
| Go test ./... и go vet ./... | **PASS**, итоговый Go 1.26.11 вне sandbox |
| CoreMIDI MAC-02A regression | **PASS**, virtual source, count=10; UMP, lifecycle, shutdown/token cleanup, reconnect и stale events |
| Race | **PASS**, Go 1.26.11, count=2 internal/midi + internal/update, с CoreMIDI fixture |
| Production darwin/arm64 | **PASS**, final build, file/lipo arm64, plist 0.3.0 / стабильный ID, strict ad hoc verify |
| Native GUI/profile | **PASS** в описанных выше границах; native-final-ax.txt и screenshots |
| Default test config / Windows build tags | **PASS**, 62 tests listed; windows/amd64 выбирает driver_windows.go (статический анализ) |
| Windows Edge/UI/build/WinMM | **NOT TESTED**, нет Windows runner |
| Native sleep/wake, физический MIDI audio unplug/switch | **NOT TESTED**, эти физические сценарии не упражнялись с измерением/прослушиванием |

Первый Go test/vet на Go 1.25 прошёл. Поздний sandbox-прогон Go 1.25
дал `package testmain: cannot find package`; Go 1.26.11 в sandbox сообщил
`operation not permitted` на cache. Итоговые test/vet вне sandbox прошли.
Первый sandbox Wails build дал exit 1, итоговая сборка вне sandbox прошла.
Это ограничения окружения; они не скрыты как PASS исходных запусков.
Диагностическая попытка передать AppleKeyboardUIMode через WebKit launch args
была отклонена Playwright; config от неё очищен, OS defaults не менялись.

Финальная проверенная копия:
`artifacts/mac-03/Find-a-Note-Final.app`.
Также результат сборщика: `build/bin/find-a-note.app`.
SHA-256 Mach-O `Contents/MacOS/Find a Note`:
`fea185ac1c9577088d0ddb919ef6a29d3b5a229dc684dfe12c3ef03f2b8a7779`.
Это хеш файла, не каталога .app и не релизного пакета.
Предыдущий bundle сохранён в `artifacts/mac-03/baseline-find-a-note.app`.
Логи: `artifacts/mac-03/logs/`, скриншоты: `artifacts/mac-03/screenshots/`.
Артефакты и снимки пользовательского профиля не включены в коммит.

Ветка `feature/mac-03-audio-webkit`. HEAD — локальный коммит с этим отчётом
(полный hash в итоговом ответе / `git log -1 --format=%H`). После коммита
tracked tree чист; исходные `.DS_Store`, `build/.DS_Store`, `docs/.DS_Store`
сохранены untracked. Push и публикаций нет; production keys и promo/ не менялись.
