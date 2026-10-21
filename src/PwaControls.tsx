import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
let pendingInstall: InstallEvent | null = null;
export default function PwaControls() {
  const [install, setInstall] = useState<InstallEvent | null>(pendingInstall);
  const [failed, setFailed] = useState(false);
  const {
    needRefresh: [refresh, setRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError() {
      setFailed(true);
    },
  });
  useEffect(() => {
    const ready = (event: Event) => {
      event.preventDefault();
      pendingInstall = event as InstallEvent;
      setInstall(pendingInstall);
    };
    const installed = () => {
      pendingInstall = null;
      setInstall(null);
    };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  async function installApp() {
    if (!install) return;
    await install.prompt();
    await install.userChoice;
    pendingInstall = null;
    setInstall(null);
  }
  return (
    <>
      {install && (
        <button
          className="install-button"
          aria-label="Установить приложение"
          title="Установить приложение"
          onClick={installApp}
        >
          <span aria-hidden="true">↓</span>
          <span className="install-label"> Установить</span>
        </button>
      )}
      {refresh && (
        <div className="pwa-notice" role="status">
          <span>Доступна новая версия. Партия сохранена.</span>
          <button onClick={() => updateServiceWorker(true)}>Обновить</button>
          <button aria-label="Позже" onClick={() => setRefresh(false)}>
            ×
          </button>
        </div>
      )}
      {failed && (
        <span
          className="offline-error"
          title="Обновите страницу при подключении к интернету"
        >
          Офлайн-режим недоступен
        </span>
      )}
    </>
  );
}
