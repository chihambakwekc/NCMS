import React from "react"
import ReactDOM from "react-dom/client"
import "@fontsource-variable/geist"
import "./styles.css"
import { App } from "./App"

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => void registration.unregister())
  })
}

if ("caches" in window) {
  void caches.keys().then((keys) => {
    keys.forEach((key) => void caches.delete(key))
  })
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
