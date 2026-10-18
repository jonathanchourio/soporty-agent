//! Soporty Agente — parte nativa (equipos administrados, soporte desatendido).
//!
//! Igual que la app de Windows, el video/voz/señalización/chat viven en el WebView
//! (reusan el motor de Soporty). Rust hace lo que el navegador no puede:
//!   - control remoto: mover el mouse y teclear (enigo), con barra de aviso visible;
//!   - guardar en disco el registro del equipo (id + token) para que sobreviva reinicios;
//!   - arranque automático con el sistema (plugin autostart).
//!
//! El control se aplica solo si CONTROLLING es true. En este agente el equipo
//! acepta automáticamente las conexiones del técnico (ya validadas con el PIN del
//! equipo en el panel), pero mientras se controla SIEMPRE se ve la barra roja con
//! «Detener», de modo que quien esté frente al equipo puede cortar al instante.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use enigo::{
    Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings,
};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

static CONTROLLING: AtomicBool = AtomicBool::new(false);

struct EnigoState(Mutex<Enigo>);

#[derive(Deserialize)]
struct Ev {
    t: String,
    #[serde(default)]
    x: i32,
    #[serde(default)]
    y: i32,
    #[serde(default)]
    b: String,
    #[serde(default)]
    amount: i32,
    #[serde(default)]
    k: String,
    #[serde(default)]
    text: String,
}

/* ------------------------------------------------------------- configuración */

fn cfg_file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("agent.json"))
}

/// Lee el registro guardado del equipo (JSON como texto). "" si no hay.
#[tauri::command]
fn cfg_get(app: AppHandle) -> String {
    if let Some(p) = cfg_file(&app) {
        if let Ok(s) = fs::read_to_string(p) {
            return s;
        }
    }
    String::new()
}

/// Guarda el registro del equipo en disco.
#[tauri::command]
fn cfg_set(app: AppHandle, data: String) -> bool {
    if let Some(p) = cfg_file(&app) {
        return fs::write(p, data).is_ok();
    }
    false
}

/* -------------------------------------------------------------- control remoto */

#[tauri::command]
fn rc_screen(app: AppHandle) -> (u32, u32) {
    if let Ok(Some(mon)) = app.primary_monitor() {
        let s = mon.size();
        return (s.width, s.height);
    }
    (1920, 1080)
}

#[tauri::command]
fn rc_start(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window("overlay").is_none() {
        WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("overlay.html".into()))
            .title("Soporty")
            .inner_size(380.0, 54.0)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .shadow(true)
            .build()
            .map_err(|e| format!("No se pudo mostrar la barra de aviso: {e}"))?;
    }
    CONTROLLING.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn rc_stop(app: AppHandle) {
    CONTROLLING.store(false, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.close();
    }
    let _ = app.emit("rc-stopped", ());
}

#[tauri::command]
fn rc_apply(state: State<EnigoState>, events: Vec<Ev>) {
    if !CONTROLLING.load(Ordering::SeqCst) {
        return;
    }
    let mut enigo = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    for ev in events {
        match ev.t.as_str() {
            "move" => {
                let _ = enigo.move_mouse(ev.x, ev.y, Coordinate::Abs);
            }
            "down" | "up" | "click" => {
                let btn = match ev.b.as_str() {
                    "right" => Button::Right,
                    "middle" => Button::Middle,
                    _ => Button::Left,
                };
                let dir = match ev.t.as_str() {
                    "down" => Direction::Press,
                    "up" => Direction::Release,
                    _ => Direction::Click,
                };
                let _ = enigo.button(btn, dir);
            }
            "wheel" => {
                if ev.amount != 0 {
                    let _ = enigo.scroll(ev.amount, Axis::Vertical);
                }
            }
            "text" => {
                if !ev.text.is_empty() {
                    let _ = enigo.text(&ev.text);
                }
            }
            "key" => {
                if let Some(key) = map_key(&ev.k) {
                    let _ = enigo.key(key, Direction::Click);
                }
            }
            "keydown" | "keyup" => {
                let dir = if ev.t == "keydown" {
                    Direction::Press
                } else {
                    Direction::Release
                };
                if let Some(key) = map_key(&ev.k) {
                    let _ = enigo.key(key, dir);
                }
            }
            _ => {}
        }
    }
}

fn map_key(name: &str) -> Option<Key> {
    let k = match name {
        "Enter" => Key::Return,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Escape" | "Esc" => Key::Escape,
        "Delete" | "Del" => Key::Delete,
        " " | "Spacebar" | "Space" => Key::Space,
        "ArrowUp" | "Up" => Key::UpArrow,
        "ArrowDown" | "Down" => Key::DownArrow,
        "ArrowLeft" | "Left" => Key::LeftArrow,
        "ArrowRight" | "Right" => Key::RightArrow,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "Control" => Key::Control,
        "Alt" => Key::Alt,
        "Shift" => Key::Shift,
        "Meta" | "OS" | "Win" => Key::Meta,
        "CapsLock" => Key::CapsLock,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        other => {
            let mut chars = other.chars();
            if let (Some(c), None) = (chars.next(), chars.next()) {
                return Some(Key::Unicode(c.to_ascii_lowercase()));
            }
            return None;
        }
    };
    Some(k)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .setup(|app| {
            let enigo = Enigo::new(&Settings::default())
                .map_err(|e| format!("No se pudo iniciar el control de entrada: {e}"))?;
            app.manage(EnigoState(Mutex::new(enigo)));
            // Arranque con el sistema (si el plugin está disponible).
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::ManagerExt;
                let _ = app.autolaunch().enable();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cfg_get, cfg_set, rc_screen, rc_start, rc_stop, rc_apply
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Soporty Agente");
}
