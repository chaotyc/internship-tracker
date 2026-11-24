import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { APP_VERSION } from './version'

const REPO = 'https://github.com/chaotyc/internship-tracker'

/**
 * The app's own menu in place of Electron's default, whose Help menu links to electronjs.org.
 * macOS gets the usual app, Edit, View and Window menus (Edit is what makes copy and paste
 * work there). Windows and Linux get the same menus, hidden until Alt is pressed.
 */
export function installMenu(): void {
  const mac = process.platform === 'darwin'
  app.setAboutPanelOptions({
    applicationName: 'Internship Tracker',
    applicationVersion: APP_VERSION,
    version: '',
    copyright: 'MIT License',
    website: REPO,
  })
  const view: MenuItemConstructorOptions[] = [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ]
  // Reload and developer tools only while developing.
  if (!app.isPackaged) view.unshift({ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' })

  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : [{ label: 'File', submenu: [{ role: 'quit' }] } satisfies MenuItemConstructorOptions]),
    { role: 'editMenu' },
    { label: 'View', submenu: view },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Internship Tracker on GitHub', click: () => void shell.openExternal(REPO) },
        { label: 'Report a problem', click: () => void shell.openExternal(`${REPO}/issues/new/choose`) },
        { label: 'Check for new versions', click: () => void shell.openExternal(`${REPO}/releases`) },
        ...(mac ? [] : ([{ type: 'separator' }, { role: 'about' }] satisfies MenuItemConstructorOptions[])),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
