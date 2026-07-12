use enigo::{Enigo, Key, KeyboardControllable, MouseButton, MouseControllable};
use serde::Deserialize;
use std::io::{self, BufRead};

#[cfg(target_os = "macos")]
mod accessibility {
    use core_foundation::base::{CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
    }

    pub fn is_trusted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    pub fn request_if_needed() -> bool {
        if is_trusted() {
            return true;
        }

        let prompt_key = CFString::new("AXTrustedCheckOptionPrompt");
        let prompt_value = CFBoolean::true_value();
        let options: CFDictionary<CFString, CFBoolean> =
            CFDictionary::from_CFType_pairs(&[(prompt_key, prompt_value)]);

        unsafe { AXIsProcessTrustedWithOptions(options.as_CFTypeRef()) }
    }
}

#[cfg(not(target_os = "macos"))]
mod accessibility {
    pub fn is_trusted() -> bool {
        true
    }

    pub fn request_if_needed() -> bool {
        true
    }
}

#[derive(Debug, Deserialize)]
struct DisplayBounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Debug, Deserialize)]
struct InputEvent {
    #[serde(rename = "type")]
    kind: String,
    x: Option<f64>,
    y: Option<f64>,
    button: Option<u8>,
    #[serde(rename = "deltaY")]
    delta_y: Option<f64>,
    key: Option<String>,
    code: Option<String>,
    display: DisplayBounds,
}

fn button_from_browser(button: Option<u8>) -> MouseButton {
    match button.unwrap_or(0) {
        1 => MouseButton::Middle,
        2 => MouseButton::Right,
        _ => MouseButton::Left,
    }
}

fn move_to_event_position(enigo: &mut Enigo, event: &InputEvent) {
    let Some(nx) = event.x else {
        return;
    };
    let Some(ny) = event.y else {
        return;
    };

    let x = event.display.x + (nx.clamp(0.0, 1.0) * f64::from(event.display.width)).round() as i32;
    let y = event.display.y + (ny.clamp(0.0, 1.0) * f64::from(event.display.height)).round() as i32;
    enigo.mouse_move_to(x, y);
}

fn key_from_event(event: &InputEvent) -> Option<Key> {
    let key = event.key.as_deref().unwrap_or("");

    match key {
        "Alt" => Some(Key::Alt),
        "Backspace" => Some(Key::Backspace),
        "Control" => Some(Key::Control),
        "Delete" => Some(Key::Delete),
        "Enter" => Some(Key::Return),
        "Escape" => Some(Key::Escape),
        "Meta" => Some(Key::Meta),
        "Shift" => Some(Key::Shift),
        " " | "Spacebar" => Some(Key::Space),
        "Tab" => Some(Key::Tab),
        "ArrowDown" => Some(Key::DownArrow),
        "ArrowLeft" => Some(Key::LeftArrow),
        "ArrowRight" => Some(Key::RightArrow),
        "ArrowUp" => Some(Key::UpArrow),
        _ => {
            if key.chars().count() == 1 {
                key.chars().next().map(Key::Layout)
            } else {
                function_key_from_code(event.code.as_deref())
            }
        }
    }
}

fn function_key_from_code(code: Option<&str>) -> Option<Key> {
    match code.unwrap_or("") {
        "F1" => Some(Key::F1),
        "F2" => Some(Key::F2),
        "F3" => Some(Key::F3),
        "F4" => Some(Key::F4),
        "F5" => Some(Key::F5),
        "F6" => Some(Key::F6),
        "F7" => Some(Key::F7),
        "F8" => Some(Key::F8),
        "F9" => Some(Key::F9),
        "F10" => Some(Key::F10),
        "F11" => Some(Key::F11),
        "F12" => Some(Key::F12),
        _ => None,
    }
}

fn handle_event(enigo: &mut Enigo, event: &InputEvent) {
    match event.kind.as_str() {
        "mouseMove" => move_to_event_position(enigo, event),
        "mouseDown" => {
            move_to_event_position(enigo, event);
            enigo.mouse_down(button_from_browser(event.button));
        }
        "mouseUp" => {
            move_to_event_position(enigo, event);
            enigo.mouse_up(button_from_browser(event.button));
        }
        "wheel" => {
            let delta = event.delta_y.unwrap_or(0.0);
            if delta.abs() >= 1.0 {
                enigo.mouse_scroll_y((-delta / 80.0).round() as i32);
            }
        }
        "keyDown" => {
            if let Some(key) = key_from_event(event) {
                enigo.key_down(key);
            }
        }
        "keyUp" => {
            if let Some(key) = key_from_event(event) {
                enigo.key_up(key);
            }
        }
        _ => {}
    }
}

fn main() {
    if std::env::args().any(|arg| arg == "--check-accessibility") {
        if accessibility::request_if_needed() {
            println!("accessibility-ok");
            std::process::exit(0);
        }

        eprintln!(
            "macOS Accessibility permission is required. Enable Remote Control MVP and native-input-helper in System Settings > Privacy & Security > Accessibility, then restart Remote Control MVP."
        );
        std::process::exit(2);
    }

    if !accessibility::request_if_needed() {
        eprintln!(
            "macOS Accessibility permission is required. Enable Remote Control MVP and native-input-helper in System Settings > Privacy & Security > Accessibility, then restart Remote Control MVP."
        );
    }

    let stdin = io::stdin();
    let mut enigo = Enigo::new();

    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<InputEvent>(&line) {
            Ok(event) => handle_event(&mut enigo, &event),
            Err(error) => eprintln!("invalid input event: {error}"),
        }
    }
}
