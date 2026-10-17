// Oculta la consola en Windows en la versión final.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Captura de pantalla sin diálogo: fija el idioma del WebView en inglés para
    // que la fuente «Entire screen» tenga un nombre predecible y se auto-seleccione.
    // Así el agente puede compartir la pantalla sin que nadie elija nada.
    if std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_err() {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--lang=en-US --auto-select-desktop-capture-source=Entire screen",
        );
    }
    soporty_agent_lib::run()
}
