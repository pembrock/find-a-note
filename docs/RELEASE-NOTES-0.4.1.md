# Find a Note 0.4.1

## English

- **Apple Silicon:** Find a Note can now download, verify and install later macOS updates from **Settings → About → Check for updates**. Confirm installation and restart. The updater keeps a backup until the new copy starts and offers restoration if it fails to launch.
- **Upgrading from macOS 0.4.0:** This first version with automatic installation must be installed manually. Download and verify the 0.4.1 arm64 DMG, quit Find a Note and replace the app in Applications. Later in-app installation requires a supported writable location. If you launch from a DMG or use an unsupported location, the update dialog offers a verified manual DMG.
- **Gatekeeper:** The Mac build uses an ad hoc signature and ships without Apple notarization. If macOS blocks the new copy, verify the source and the DMG's SHA-256. Try opening the app, then approve it in **System Settings → Privacy & Security → Open Anyway** if your Mac's policy allows it. Gatekeeper can request approval again after an update.
- **Windows:** Automatic updates still use the same Installer and Portable paths. Windows 10/11 x64 with Microsoft Edge WebView2 Runtime is required.
- The macOS update dialog now explains why a manual DMG is offered and shows when an automatic update is being prepared.

[macOS installation guide](https://github.com/pembrock/find-a-note/blob/v0.4.1/docs/INSTALL-EN.md) · [Corresponding source](https://github.com/pembrock/find-a-note/tree/v0.4.1)

## Русский

- **Apple Silicon.** Find a Note теперь может загружать, проверять и устанавливать следующие обновления macOS через **Настройки → О программе → Проверить обновления**. Подтвердите установку и перезапуск. Помощник сохраняет предыдущую копию до запуска новой и предлагает восстановление, если запуск не удался.
- **Переход с macOS 0.4.0.** Первую версию с автоматической установкой нужно установить вручную. Скачайте и проверьте arm64 DMG версии 0.4.1, завершите Find a Note и замените приложение в папке «Программы». Для следующих обновлений из приложения нужен поддерживаемый каталог с правом записи. При запуске с DMG или из неподдерживаемого каталога диалог предложит проверенный DMG для ручной установки.
- **Gatekeeper.** Сборка подписана ad hoc и распространяется без нотарификации Apple. Если macOS блокирует новую копию, проверьте источник и SHA-256 DMG. Попробуйте открыть приложение, затем разрешите запуск через **Системные настройки → Конфиденциальность и безопасность → Всё равно открыть**, если это позволяет политика Mac. После обновления macOS может запросить разрешение снова.
- **Windows.** Автообновление Installer и Portable работает по-прежнему. Требуется Windows 10/11 x64 с Microsoft Edge WebView2 Runtime.
- Диалог macOS теперь объясняет, почему предлагается ручной DMG, и показывает этап подготовки автоматического обновления.

[Инструкция по установке](https://github.com/pembrock/find-a-note/blob/v0.4.1/docs/INSTALL-RU.md) · [Исходный код выпуска](https://github.com/pembrock/find-a-note/tree/v0.4.1)
