import { useState, useEffect } from 'react';
import { isElectron, getAppSettings, setAppSettings, getAppVersion } from '../lib/electron';

export default function DesktopSettings() {
  const [settings, setSettings] = useState({
    autoLaunch: false,
    autoLaunchMinimized: false,
    minimizeToTray: true,
    closeToTray: true
  });
  const [version, setVersion] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isElectron()) {
      loadSettings();
      loadVersion();
    }
  }, []);

  const loadSettings = async () => {
    try {
      const appSettings = await getAppSettings();
      if (appSettings) {
        setSettings(appSettings);
      }
    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadVersion = async () => {
    try {
      const appVersion = await getAppVersion();
      if (appVersion) {
        setVersion(appVersion);
      }
    } catch (error) {
      console.error('Ошибка загрузки версии:', error);
    }
  };

  const handleSettingChange = async (key: string, value: boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    
    try {
      await setAppSettings({ [key]: value });
    } catch (error) {
      console.error('Ошибка сохранения настроек:', error);
      // Откатываем изменения при ошибке
      setSettings(settings);
    }
  };

  if (!isElectron()) {
    return null;
  }

  if (loading) {
    return (
      <div className="p-4">
        <div className="animate-pulse">Загрузка настроек...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Настройки приложения</h2>
        
        <div className="space-y-4">
          {/* Автозапуск */}
          <div className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <div>
              <div className="font-medium">Автозапуск</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Запускать приложение при старте системы
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoLaunch}
                onChange={(e) => handleSettingChange('autoLaunch', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* Автозапуск свернутым */}
          {settings.autoLaunch && (
            <div className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-800 rounded-lg ml-4">
              <div>
                <div className="font-medium">Запускать свернутым</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Запускать приложение в трее
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoLaunchMinimized}
                  onChange={(e) => handleSettingChange('autoLaunchMinimized', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>
          )}

          {/* Сворачивать в трей */}
          <div className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <div>
              <div className="font-medium">Сворачивать в трей</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Сворачивать окно в системный трей вместо панели задач
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.minimizeToTray}
                onChange={(e) => handleSettingChange('minimizeToTray', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* Закрывать в трей */}
          <div className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <div>
              <div className="font-medium">Закрывать в трей</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Сворачивать в трей при закрытии окна вместо выхода
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.closeToTray}
                onChange={(e) => handleSettingChange('closeToTray', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>
      </div>

      {/* Информация о версии */}
      {version && (
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <div>SAVA Messenger Desktop</div>
            <div>Версия: {version}</div>
          </div>
        </div>
      )}
    </div>
  );
}
