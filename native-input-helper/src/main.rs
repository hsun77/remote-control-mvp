#[cfg(not(target_os = "macos"))]
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
    buttons: Option<u16>,
    #[serde(rename = "deltaY")]
    delta_y: Option<f64>,
    key: Option<String>,
    code: Option<String>,
    #[serde(rename = "sourcePlatform")]
    source_platform: Option<String>,
    #[serde(rename = "translateShortcuts")]
    translate_shortcuts: Option<bool>,
    display: DisplayBounds,
}

#[cfg(target_os = "macos")]
mod mac_input {
    use super::{DisplayBounds, InputEvent};
    use core_graphics::event::{
        CGEvent, CGEventTapLocation, CGEventType, CGMouseButton, ScrollEventUnit,
    };
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::geometry::CGPoint;

    fn event_position(
        display: &DisplayBounds,
        nx: Option<f64>,
        ny: Option<f64>,
    ) -> Option<CGPoint> {
        let x = nx?;
        let y = ny?;
        Some(CGPoint::new(
            f64::from(display.x) + x.clamp(0.0, 1.0) * f64::from(display.width),
            f64::from(display.y) + y.clamp(0.0, 1.0) * f64::from(display.height),
        ))
    }

    fn source() -> Option<CGEventSource> {
        CGEventSource::new(CGEventSourceStateID::HIDSystemState).ok()
    }

    fn post_mouse(event_type: CGEventType, point: CGPoint, button: CGMouseButton) {
        let Some(source) = source() else {
            eprintln!("could not create macOS event source");
            return;
        };
        match CGEvent::new_mouse_event(source, event_type, point, button) {
            Ok(event) => event.post(CGEventTapLocation::HID),
            Err(_) => eprintln!("could not create macOS mouse event"),
        }
    }

    fn button_from_browser(button: Option<u8>) -> CGMouseButton {
        match button.unwrap_or(0) {
            1 => CGMouseButton::Center,
            2 => CGMouseButton::Right,
            _ => CGMouseButton::Left,
        }
    }

    fn down_event_type(button: CGMouseButton) -> CGEventType {
        match button {
            CGMouseButton::Right => CGEventType::RightMouseDown,
            CGMouseButton::Center => CGEventType::OtherMouseDown,
            CGMouseButton::Left => CGEventType::LeftMouseDown,
        }
    }

    fn up_event_type(button: CGMouseButton) -> CGEventType {
        match button {
            CGMouseButton::Right => CGEventType::RightMouseUp,
            CGMouseButton::Center => CGEventType::OtherMouseUp,
            CGMouseButton::Left => CGEventType::LeftMouseUp,
        }
    }

    fn key_code_from_event(event: &InputEvent) -> Option<u16> {
        let translated_code = translated_code_for_macos(event);
        match translated_code.as_str() {
            "KeyA" => Some(0),
            "KeyS" => Some(1),
            "KeyD" => Some(2),
            "KeyF" => Some(3),
            "KeyH" => Some(4),
            "KeyG" => Some(5),
            "KeyZ" => Some(6),
            "KeyX" => Some(7),
            "KeyC" => Some(8),
            "KeyV" => Some(9),
            "KeyB" => Some(11),
            "KeyQ" => Some(12),
            "KeyW" => Some(13),
            "KeyE" => Some(14),
            "KeyR" => Some(15),
            "KeyY" => Some(16),
            "KeyT" => Some(17),
            "Digit1" => Some(18),
            "Digit2" => Some(19),
            "Digit3" => Some(20),
            "Digit4" => Some(21),
            "Digit6" => Some(22),
            "Digit5" => Some(23),
            "Equal" => Some(24),
            "Digit9" => Some(25),
            "Digit7" => Some(26),
            "Minus" => Some(27),
            "Digit8" => Some(28),
            "Digit0" => Some(29),
            "BracketRight" => Some(30),
            "KeyO" => Some(31),
            "KeyU" => Some(32),
            "BracketLeft" => Some(33),
            "KeyI" => Some(34),
            "KeyP" => Some(35),
            "Enter" => Some(36),
            "KeyL" => Some(37),
            "KeyJ" => Some(38),
            "Quote" => Some(39),
            "KeyK" => Some(40),
            "Semicolon" => Some(41),
            "Backslash" => Some(42),
            "Comma" => Some(43),
            "Slash" => Some(44),
            "KeyN" => Some(45),
            "KeyM" => Some(46),
            "Period" => Some(47),
            "Tab" => Some(48),
            "Space" => Some(49),
            "Backquote" => Some(50),
            "Backspace" => Some(51),
            "Escape" => Some(53),
            "MetaLeft" | "MetaRight" => Some(55),
            "ShiftLeft" => Some(56),
            "CapsLock" => Some(57),
            "AltLeft" | "AltRight" => Some(58),
            "ControlLeft" | "ControlRight" => Some(59),
            "ShiftRight" => Some(60),
            "ArrowLeft" => Some(123),
            "ArrowRight" => Some(124),
            "ArrowDown" => Some(125),
            "ArrowUp" => Some(126),
            "F1" => Some(122),
            "F2" => Some(120),
            "F3" => Some(99),
            "F4" => Some(118),
            "F5" => Some(96),
            "F6" => Some(97),
            "F7" => Some(98),
            "F8" => Some(100),
            "F9" => Some(101),
            "F10" => Some(109),
            "F11" => Some(103),
            "F12" => Some(111),
            _ => match event.key.as_deref().unwrap_or("") {
                "Enter" => Some(36),
                "Tab" => Some(48),
                " " | "Spacebar" => Some(49),
                "Backspace" => Some(51),
                "Escape" => Some(53),
                "ArrowLeft" => Some(123),
                "ArrowRight" => Some(124),
                "ArrowDown" => Some(125),
                "ArrowUp" => Some(126),
                _ => None,
            },
        }
    }

    fn translated_code_for_macos(event: &InputEvent) -> String {
        let code = event.code.as_deref().unwrap_or("").to_string();
        if event.translate_shortcuts == Some(false)
            || event.source_platform.as_deref() == Some("darwin")
        {
            return code;
        }

        match code.as_str() {
            "ControlLeft" => "MetaLeft".to_string(),
            "ControlRight" => "MetaRight".to_string(),
            "MetaLeft" => "ControlLeft".to_string(),
            "MetaRight" => "ControlRight".to_string(),
            _ => code,
        }
    }

    fn post_key(event: &InputEvent, keydown: bool) {
        let Some(source) = source() else {
            eprintln!("could not create macOS event source");
            return;
        };
        let Some(key_code) = key_code_from_event(event) else {
            return;
        };
        match CGEvent::new_keyboard_event(source, key_code, keydown) {
            Ok(event) => event.post(CGEventTapLocation::HID),
            Err(_) => eprintln!("could not create macOS keyboard event"),
        }
    }

    pub fn handle_event(event: &InputEvent) {
        match event.kind.as_str() {
            "mouseMove" => {
                if let Some(point) = event_position(&event.display, event.x, event.y) {
                    let event_type = if event.buttons.unwrap_or(0) & 1 == 1 {
                        CGEventType::LeftMouseDragged
                    } else {
                        CGEventType::MouseMoved
                    };
                    post_mouse(event_type, point, CGMouseButton::Left);
                }
            }
            "mouseDown" => {
                if let Some(point) = event_position(&event.display, event.x, event.y) {
                    let button = button_from_browser(event.button);
                    post_mouse(down_event_type(button), point, button);
                }
            }
            "mouseUp" => {
                if let Some(point) = event_position(&event.display, event.x, event.y) {
                    let button = button_from_browser(event.button);
                    post_mouse(up_event_type(button), point, button);
                }
            }
            "wheel" => {
                let Some(source) = source() else {
                    eprintln!("could not create macOS event source");
                    return;
                };
                let wheel_y = (-event.delta_y.unwrap_or(0.0)).round() as i32;
                let wheel_x = 0;
                if let Ok(event) = CGEvent::new_scroll_event(
                    source,
                    ScrollEventUnit::PIXEL,
                    2,
                    wheel_y,
                    wheel_x,
                    0,
                ) {
                    event.post(CGEventTapLocation::HID);
                }
            }
            "keyDown" => post_key(event, true),
            "keyUp" => post_key(event, false),
            _ => {}
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn button_from_browser(button: Option<u8>) -> MouseButton {
    match button.unwrap_or(0) {
        1 => MouseButton::Middle,
        2 => MouseButton::Right,
        _ => MouseButton::Left,
    }
}

#[cfg(not(target_os = "macos"))]
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

#[cfg(not(target_os = "macos"))]
fn key_from_event(event: &InputEvent) -> Option<Key> {
    let key = event.key.as_deref().unwrap_or("");
    let code = event.code.as_deref().unwrap_or("");

    if event.translate_shortcuts != Some(false)
        && event.source_platform.as_deref() == Some("darwin")
    {
        match code {
            "MetaLeft" | "MetaRight" => return Some(Key::Control),
            "ControlLeft" | "ControlRight" => return Some(Key::Meta),
            _ => {}
        }

        match key {
            "Meta" => return Some(Key::Control),
            "Control" => return Some(Key::Meta),
            _ => {}
        }
    }

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

#[cfg(not(target_os = "macos"))]
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

#[cfg(not(target_os = "macos"))]
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
        if accessibility::is_trusted() {
            println!("accessibility-ok");
            std::process::exit(0);
        }

        eprintln!(
            "macOS Accessibility permission is required. Enable Remote Control MVP and native-input-helper in System Settings > Privacy & Security > Accessibility, then restart Remote Control MVP."
        );
        std::process::exit(2);
    }

    if std::env::args().any(|arg| arg == "--request-accessibility") {
        if accessibility::request_if_needed() {
            println!("accessibility-ok");
            std::process::exit(0);
        }

        eprintln!(
            "macOS Accessibility permission is required. Enable Remote Control MVP and native-input-helper in System Settings > Privacy & Security > Accessibility, then restart Remote Control MVP."
        );
        std::process::exit(2);
    }

    if !accessibility::is_trusted() {
        eprintln!(
            "macOS Accessibility permission is required. Enable Remote Control MVP and native-input-helper in System Settings > Privacy & Security > Accessibility, then restart Remote Control MVP."
        );
        std::process::exit(2);
    }

    let stdin = io::stdin();
    #[cfg(not(target_os = "macos"))]
    let mut enigo = Enigo::new();

    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<InputEvent>(&line) {
            Ok(event) => {
                #[cfg(target_os = "macos")]
                mac_input::handle_event(&event);
                #[cfg(not(target_os = "macos"))]
                handle_event(&mut enigo, &event);
            }
            Err(error) => eprintln!("invalid input event: {error}"),
        }
    }
}
